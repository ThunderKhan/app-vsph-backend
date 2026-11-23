import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {EnrollmentPasswordRejected,type EnrollmentStore} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proof=z.strictObject({id:z.string().regex(uuid),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
const acceptance=proof.extend({password:z.string().min(8).max(128),confirmed:z.literal(true)});
function invalid():never {throw new HttpError(400,'INVALID_ENROLLMENT_FIELDS',
 'Review and confirm the current employee enrollment fields.');}
function recovery():never {throw new HttpError(503,'ENROLLMENT_RECOVERY_REQUIRED',
 'Employee account setup is incomplete. Review recovery or reissue options.');}
function throttle(max:number){
 const buckets=new Map<string,{count:number;until:number}>();
 return async (request:FastifyRequest)=>{
   const now=Date.now();let record=buckets.get(request.ip);
   if(!record||record.until<=now) {
     if(buckets.size>=10000){
       for(const [key,bucket] of buckets)if(bucket.until<=now)buckets.delete(key);
       if(buckets.size>=10000)throw new HttpError(429,'RATE_LIMITED','Too many attempts.');
     }
     record={count:0,until:now+900000};buckets.set(request.ip,record);
   }
   if(++record.count>max)throw new HttpError(429,'RATE_LIMITED','Too many attempts.');
 };
}
export function installPublicEmployeeEnrollment(app:FastifyInstance,store:EnrollmentStore):void {
 app.post('/api/employee-enrollment/inspect',{preHandler:throttle(20)},async request=>{
   const parsed=proof.safeParse(request.body);
   if(!parsed.success)return invalid();
   const tokenHash=createHash('sha256').update(parsed.data.token).digest('hex');
   return store.inspect(parsed.data.id,tokenHash);
 });
 app.post('/api/employee-enrollment/accept',{preHandler:throttle(20)},async request=>{
   const parsed=acceptance.safeParse(request.body);
   if(!parsed.success)return invalid();
   const {id,token,password}=parsed.data,hash=createHash('sha256').update(token).digest('hex');
   const acceptanceId=randomUUID();
   // Reservation must be atomic and server-owned. The provider must not be
   // contacted before the one-use SQL state transition has succeeded.
   const record=await store.reserve(id,hash,acceptanceId);
   try{
     const identity=await store.identity(record.authUserId);
     if(identity.id!==record.authUserId||
       identity.email?.toLowerCase()!==record.email.toLowerCase()||
       identity.app_metadata?.vsph_employee_enrollment!==id||
       Boolean(identity.email_confirmed_at)||
       identity.factors?.some(f=>f.status==='verified'))
       return recovery();
     await store.setPassword(record.authUserId,password);
     await store.finish(id,hash,acceptanceId);
     return {message:'Your employee account is ready. Sign in with your work email and the password you just chose.'};
   }catch(error){
     if(error instanceof EnrollmentPasswordRejected){
       try{await store.reject(id,hash,acceptanceId);}
       catch{return recovery();}
       throw new HttpError(400,'PASSWORD_REJECTED',
         'The authentication provider rejected this password. Choose a stronger password and try again.');
     }
     // A timeout is ambiguous; SQL 'failed' quarantines rather than
     // releasing the reservation. An operator must reconcile an uncertain write.
     try{await store.failed(id,hash,acceptanceId);}
     catch{/* A locked reservation is safer than a duplicate provider write. */}
     return recovery();
   }
 });
}
