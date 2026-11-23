import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {PortalSessionError,resolvePortalSession} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {CustomerStore,CustomerLifecycleAction} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const version=z.number().int().min(1).max(2147483647);
const cursor=z.strictObject({afterId:z.string().regex(uuid).optional()});
const member=z.strictObject({userId:z.string().regex(uuid),version,
 role:z.enum(['owner','admin','member','viewer']),status:z.enum(['active','suspended'])});
const role=z.strictObject({userId:z.string().regex(uuid),version,
 applicationId:z.string().regex(uuid),
 role:z.enum(['','super_admin','admin','manager','user','viewer','staff','musician'])});
const product=z.strictObject({applicationId:z.string().regex(uuid),
 role:z.enum(['super_admin','admin','manager','user','viewer','staff','musician'])});
const invite=z.strictObject({
 name:z.string(),email:z.string(),memberRole:z.enum(['admin','member','viewer']),
 products:z.array(product).max(12),
});
const isoTime=z.string().refine(x=>
 x===''||(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(x)&&
 Number.isFinite(Date.parse(x))));
const status=z.strictObject({version,confirmed:z.literal(true),
 status:z.enum(['active','suspended','closed'])});
const common={version,confirmed:z.literal(true),applicationId:z.string().regex(uuid)};
const subscriptionFields={planCode:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
 subscriptionStatus:z.enum(['trial','active','past_due','cancelled','expired']),
 startsAt:isoTime.optional(),endsAt:isoTime.optional()};
const accessFields={accessStatus:z.enum(['enabled','suspended','revoked'])};
const subscription=z.strictObject({...common,...subscriptionFields});
const access=z.strictObject({...common,...accessFields});
const entitlement=z.strictObject({...common,...subscriptionFields,...accessFields});
function invalid(message='Invalid customer request.'):never{
 throw new HttpError(400,'INVALID_CUSTOMER_REQUEST',message);
}
function id(value:string):string{
 if(!uuid.test(value))return invalid('Invalid organization.');
 return value;
}
function invitation(raw:unknown,organizationId:string):Record<string,unknown>{
 const p=invite.safeParse(raw);
 if(!p.success)return invalid('Provide name, email, organization role and explicit product roles.');
 const name=p.data.name.trim(),email=p.data.email.trim().toLowerCase();
 if(!name||name.length>150||Array.from(name).some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127)||
   email.length>190||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
   new Set(p.data.products.map(x=>x.applicationId.toLowerCase())).size!==p.data.products.length)
  return invalid('Invalid invitation details or duplicate product roles.');
 return {kind:'member',organizationId,adminName:name,adminEmail:email,
  memberRole:p.data.memberRole,products:p.data.products};
}
export function installCustomers(app:FastifyInstance,auth:AuthStore,store:CustomerStore):void{
 async function owner(req:FastifyRequest):Promise<string>{
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{
   const principal=await resolvePortalSession(raw,{
    findByTokenHash:hash=>auth.portalSession(hash),
   });
   if(principal.user.platform_role!=='super_admin')
    throw new HttpError(403,'ACCESS_DENIED','Owner authority required.');
   return principal.user.id;
  }catch(error){
   if(error instanceof PortalSessionError)
    throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 function noQuery(req:FastifyRequest):void{
  if(Object.keys(req.query as Record<string,unknown>).length)invalid();
 }
 app.get('/api/admin-management/customers',async req=>{
  const who=await owner(req),p=cursor.safeParse(req.query);
  if(!p.success)return invalid('Invalid cursor.');
  return store.command(who,'list',null,p.data.afterId?{afterId:p.data.afterId}:{});
 });
 app.get<{Params:{id:string}}>('/api/admin-management/customers/:id',async req=>{
  const who=await owner(req);noQuery(req);
  return store.command(who,'read',id(req.params.id),{});
 });
 app.post<{Params:{id:string}}>('/api/admin-management/customers/:id/invitations',async(req,reply)=>{
  const who=await owner(req),org=id(req.params.id),request=invitation(req.body,org);
  const key=req.headers['idempotency-key'];
  if(typeof key!=='string'||!uuid.test(key))
   return invalid('A UUID Idempotency-Key is required.');
  const job=await store.queueInvitation(who,key,request);
  if(!job||typeof job!=='object'||Array.isArray(job)||
    typeof (job as Record<string,unknown>).id!=='string')
   throw Error('Invalid provisioning job result');
  reply.code(202);
  return {id:(job as Record<string,unknown>).id,
   message:'Invitation queued. Delivery is not yet confirmed.'};
 });
 for(const action of ['member','role'] as const){
  app.post<{Params:{id:string}}>('/api/admin-management/customers/:id/'+action,async req=>{
   const who=await owner(req),org=id(req.params.id);
   const p=(action==='member'?member:role).safeParse(req.body);
   if(!p.success)return invalid('Invalid membership mutation.');
   return store.command(who,action,org,p.data);
  });
 }
 app.get<{Params:{id:string}}>('/api/admin-management/customers/:id/impact',async req=>{
  const who=await owner(req);noQuery(req);
  return store.lifecycle(who,'preview',id(req.params.id),{});
 });
 const schemas={status,subscription,access,entitlement};
 app.post<{Params:{id:string;action:string}}>(
  '/api/admin-management/customers/:id/lifecycle/:action',async req=>{
   const who=await owner(req),org=id(req.params.id),action=req.params.action;
   if(!Object.hasOwn(schemas,action))return invalid('Invalid lifecycle action.');
   const p=schemas[action as keyof typeof schemas].safeParse(req.body);
   if(!p.success)return invalid('Review and confirm current lifecycle and access changes.');
   return store.lifecycle(who,action as CustomerLifecycleAction,org,p.data);
  });
}
