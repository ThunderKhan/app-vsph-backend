import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { sessionCookies } from '../auth/cookies.js';
import { EMPLOYEE_SETUP_COOKIE, hashSessionToken } from '../auth/session-tokens.js';
import { ProviderPasswordRejected, type CredentialStore } from './store.js';

const schema=z.strictObject({password:z.string().min(12).max(128),confirmed:z.literal(true)});
const error=(status:number,code:string,message:string):never=>{throw new HttpError(status,code,message);};
function setup(request:FastifyRequest):string {
  const raw=sessionCookies(request)[EMPLOYEE_SETUP_COOKIE];
  if(!raw)return error(401,'TEMPORARY_SESSION_REQUIRED','Temporary sign-in expired. Please sign in again.');
  return raw;
}
function rateLimit() {
  const buckets=new Map<string,{count:number;expiry:number}>();
  return async(request:FastifyRequest,reply:FastifyReply)=>{
    const now=Date.now(),key=request.ip;
    let b=buckets.get(key);
    if(!b||b.expiry<=now){
      if(buckets.size>=10000) {
        for(const [k,v] of buckets)if(v.expiry<=now)buckets.delete(k);
        if(buckets.size>=10000)return error(429,'RATE_LIMITED','Too many attempts.');
      }
      b={count:0,expiry:now+900000};buckets.set(key,b);
    }
    if(++b.count>10){
      reply.header('Retry-After',String(Math.max(1,Math.ceil((b.expiry-now)/1000))));
      return error(429,'RATE_LIMITED','Too many attempts.');
    }
  };
}
export function installTemporaryCredentials(app:FastifyInstance,store:CredentialStore,secure:boolean):void {
  app.get('/api/employee-credentials/status',async(request)=>{
    if(Object.keys((request.query??{}) as Record<string,unknown>).length)
      return error(400,'INVALID_REQUEST','Invalid request.');
    return store.status(hashSessionToken(setup(request)));
  });
  app.post('/api/employee-credentials/replace',{preHandler:rateLimit()},async(request,reply)=>{
    const raw=setup(request),parsed=schema.safeParse(request.body);
    if(!parsed.success)return error(400,'INVALID_CREDENTIAL_FIELDS','Confirm the current employee credentials fields.');
    const setupHash=hashSessionToken(raw),nonce=randomUUID(),password=parsed.data.password;
    // The SQL reservation's opaque nonce makes ambiguous provider writes non-replayable.
    const reserved=await store.reserve(setupHash,hashSessionToken(password),nonce);
    try{
      const identity=await store.getIdentity(reserved.userId);
      if(identity.id!==reserved.userId||identity.email?.toLowerCase()!==reserved.email.toLowerCase()||
        identity.app_metadata?.vsph_employee_enrollment!==reserved.enrollmentId||
        !identity.email_confirmed_at)throw Error('Reserved identity unavailable');
      if(identity.factors?.some(f=>f.status==='verified')&&reserved.assurance!=='aal2'){
        await store.reject(setupHash,nonce);
        return error(401,'IDENTITY_STEP_UP_REQUIRED',
          'Authenticator settings changed. Sign in again with your authenticator.');
      }
      await store.updatePassword(reserved.userId,password);
      await store.finish(setupHash,nonce);
      reply.header('Set-Cookie',`${EMPLOYEE_SETUP_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`);
      return {message:'Your personal password is set. Sign in again to open your employee workspace.'};
    }catch(err){
      if(err instanceof ProviderPasswordRejected){
        await store.reject(setupHash,nonce);
        return error(400,'PASSWORD_REJECTED','Choose a stronger personal password.');
      }
      // No retry on ambiguous provider update; the failed SQL transition
      // keeps the setup credential quarantined pending operator reconciliation.
      try{await store.failed(reserved.id,nonce);}catch{ /* Remain locked if recovery failed. */ }
      return error(503,'CREDENTIAL_RECOVERY_REQUIRED',
        'Employee account setup is incomplete. Review recovery or reissue options.');
    }
  });
}
