import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Env} from '../../config.js';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ManagerEnrollmentStore,ManagerEnrollmentRecord} from './manager-store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const version=z.number().int().min(1).max(2147483647);
const mode=z.enum(['manual','email']).optional();
const create=z.strictObject({rosterVersion:version,confirmed:z.literal(true),delivery:mode});
const renew=z.strictObject({rosterVersion:version,version,confirmed:z.literal(true),delivery:mode});
const cancel=z.strictObject({rosterVersion:version,version,confirmed:z.literal(true)});
function invalid():never{throw new HttpError(400,'INVALID_ENROLLMENT_FIELDS',
  'Review and confirm the current employee enrollment fields.');}
function unavailable():never{throw new HttpError(503,'ENROLLMENT_RECOVERY_REQUIRED',
  'Employee account setup is incomplete. Review recovery or reissue options.');}
function decode(value:unknown):ManagerEnrollmentRecord|{id:string;replayed:true}{
 if(!value||typeof value!=='object'||Array.isArray(value))return unavailable();
 const row=value as Record<string,unknown>;
 if(typeof row.id!=='string'||!uuid.test(row.id))return unavailable();
 if(row.replayed===true)return {id:row.id,replayed:true};
 if(typeof row.authUserId!=='string'||!uuid.test(row.authUserId)||
    typeof row.email!=='string'||!row.email||
    typeof row.version!=='number'||!Number.isInteger(row.version))
   return unavailable();
 return {id:row.id,authUserId:row.authUserId,email:row.email,version:row.version};
}
function throttle() {
 const map=new Map<string,{count:number;until:number}>();
 return async(request:FastifyRequest)=>{
   const now=Date.now();let b=map.get(request.ip);
   if(!b||b.until<=now) {
     if(map.size>=10000){
       for(const [k,v] of map)if(v.until<=now)map.delete(k);
       if(map.size>=10000)throw new HttpError(429,'RATE_LIMITED','Too many attempts.');
     }
     b={count:0,until:now+900000};map.set(request.ip,b);
   }
   if(++b.count>20)throw new HttpError(429,'RATE_LIMITED','Too many attempts.');
 };
}
export function installManagedEmployeeEnrollment(app:FastifyInstance,env:Env,
 auth:AuthStore,store:ManagerEnrollmentStore):void{
 async function actor(request:FastifyRequest){
   const raw=sessionCookies(request)[PORTAL_COOKIE];
   if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   try{
     const principal=await resolvePortalSession(raw,{findByTokenHash:hash=>auth.portalSession(hash)});
     return {id:principal.user.id,currentHash:principal.session.token_hash};
   }catch(error){
     if(error instanceof PortalSessionError)
       throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
     throw error;
   }
 }
 async function issue(request:FastifyRequest,id:string,params:{
  rosterVersion:number;version?:number;confirmed:true;delivery?:'manual'|'email'
 },key?:string){
   const principal=await actor(request);
   // No configured email adapter: do not issue a token which a fake sender claims to deliver.
   if(params.delivery==='email')throw new HttpError(503,'EMAIL_NOT_CONFIGURED',
     'Employee invitation email is not configured. Select private link delivery.');
   const token=randomBytes(32).toString('base64url');
   const tokenHash=createHash('sha256').update(token).digest('hex');
   const renewing=params.version!==undefined;
   const commandData={currentHash:principal.currentHash,confirmed:true,
     rosterVersion:params.rosterVersion,tokenHash,
     ...(renewing?{version:params.version}:{key})};
   const row=decode(await store.command(principal.id,renewing?'renew':'start',id,commandData));
   if('replayed' in row&&row.replayed)return {
     id:row.id,replayed:true,
     message:'This issuance was already recorded. Refresh and explicitly reissue to obtain a new private link.',
   };
   try{
     await store.provision(row);
     await store.command(principal.id,'ready',row.id,{
       currentHash:principal.currentHash,confirmed:true,rosterVersion:params.rosterVersion,
       version:row.version,
     });
   }catch{return unavailable();}
   const link=new URL('/employee-enrollment',env.PUBLIC_ORIGIN);
   link.hash=new URLSearchParams({enrollment_id:row.id,token}).toString();
   return {id:row.id,version:row.version+1,recipientEmail:row.email,url:link.toString(),
     delivery:'private_manual_handoff',
     message:'Share this private link only with the named employee through a trusted channel. No email was sent. The employee chooses their password; HR authority is not granted.'};
 }
 app.get('/api/employee-enrollment/delivery',async request=>{
   const principal=await actor(request);
   if(Object.keys(request.query as Record<string,unknown>).length)return invalid();
   await store.deliveryAccess(principal.id);
   return {emailConfigured:false};
 });
 app.get<{Params:{id:string}}>('/api/employee-enrollment/employees/:id',async request=>{
   const principal=await actor(request);
   if(!uuid.test(request.params.id)||Object.keys(request.query as Record<string,unknown>).length)
     return invalid();
   const review=await store.review(principal.id,principal.currentHash,request.params.id);
   if(!review||typeof review!=='object'||Array.isArray(review))return unavailable();
   return {...review,emailDeliveryAvailable:false};
 });
 app.post<{Params:{id:string}}>('/api/employee-enrollment/employees/:id',
   {preHandler:throttle()},async request=>{
   if(!uuid.test(request.params.id))return invalid();
   const body=create.safeParse(request.body),key=request.headers['idempotency-key'];
   if(!body.success||typeof key!=='string'||!uuid.test(key))return invalid();
   return issue(request,request.params.id,body.data,key);
 });
 app.post<{Params:{id:string}}>('/api/employee-enrollment/:id/renew',
   {preHandler:throttle()},async request=>{
   if(!uuid.test(request.params.id))return invalid();
   const body=renew.safeParse(request.body);
   if(!body.success)return invalid();
   return issue(request,request.params.id,body.data);
 });
 app.post<{Params:{id:string}}>('/api/employee-enrollment/:id/cancel',
   {preHandler:throttle()},async request=>{
   if(!uuid.test(request.params.id))return invalid();
   const body=cancel.safeParse(request.body);
   if(!body.success)return invalid();
   const principal=await actor(request);
   return store.command(principal.id,'cancel',request.params.id,
     {...body.data,currentHash:principal.currentHash});
 });
}
