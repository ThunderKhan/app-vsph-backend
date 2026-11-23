import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { sessionCookies } from '../auth/cookies.js';
import { PORTAL_COOKIE } from '../auth/session-tokens.js';
import { resolvePortalSession } from '../auth/portal-session.js';
import type { AuthStore } from '../auth/store.js';
import type { InvitationStore } from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proof=z.strictObject({invitationId:z.string().regex(uuid),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
const accept=proof.extend({password:z.string().min(12).max(128).optional()});
const successMessage='Invitation accepted for this customer workspace. Sign in to continue.';
function rateLimit() {
  const buckets=new Map<string,{count:number;expires:number}>();
  return async (request:FastifyRequest) => {
    const now=Date.now(),ip=request.ip;
    let b=buckets.get(ip);
    if(!b||b.expires<=now) {
      if(buckets.size>=10000) {
        for(const [key,value] of buckets)if(value.expires<=now)buckets.delete(key);
        if(buckets.size>=10000)throw new HttpError(429,'RATE_LIMITED','Too many requests.');
      }
      b={count:0,expires:now+15*60*1000};buckets.set(ip,b);
    }
    if(++b.count>20)throw new HttpError(429,'RATE_LIMITED','Too many requests.');
  };
}
export function installInvitationRoutes(app:FastifyInstance,sessions:AuthStore,store:InvitationStore):void {
  async function optionalActor(request:FastifyRequest):Promise<string|null> {
    const raw=sessionCookies(request)[PORTAL_COOKIE];
    if(!raw)return null;
    try {
      return (await resolvePortalSession(raw,{
        findByTokenHash:(hash)=>sessions.portalSession(hash),
      })).user.id;
    } catch {return null;}
  }
  app.post('/api/invitations/inspect',{preHandler:rateLimit()},async request=>{
    const parsed=proof.safeParse(request.body);
    if(!parsed.success)throw new HttpError(400,'INVITATION_PROOF_INVALID',
      'Use a current invitation email. Legacy account-wide activation is unavailable.');
    return store.inspect(parsed.data.invitationId,
      createHash('sha256').update(parsed.data.token).digest('hex'),await optionalActor(request));
  });
  app.post('/api/invitations/accept',{preHandler:rateLimit()},async request=>{
    const parsed=accept.safeParse(request.body);
    if(!parsed.success)throw new HttpError(400,'INVITATION_PROOF_INVALID',
      'Use a current invitation email. Legacy account-wide activation is unavailable.');
    const {invitationId,token,password}=parsed.data;
    const actor=await optionalActor(request),tokenHash=createHash('sha256').update(token).digest('hex');
    const acceptanceId=randomUUID();
    const info=await store.inspect(invitationId,tokenHash,actor);
    if(info.newIdentity && !password)
      throw new HttpError(400,'INVALID_INVITATION_PASSWORD','Choose a password of 12–128 characters.');
    // SQL reserve_accept is the authoritative single-use state transition.
    // Neither frontend success nor provider success can bypass finish_accept.
    const reserved=await store.reserve(invitationId,tokenHash,actor,acceptanceId);
    try {
      if(reserved.newIdentity!==info.newIdentity)throw new Error('Invitation changed during reservation');
      if(reserved.newIdentity){
        if(!uuid.test(reserved.userId)||!password)throw new Error('Invalid reserved identity');
        await store.setNewIdentityPassword(reserved.userId,password);
      }
      await store.finish(invitationId,tokenHash,actor,acceptanceId);
      return {message:successMessage};
    }catch(error){
      try{await store.markFailed(invitationId,tokenHash,actor,acceptanceId);}
      catch{throw new Error('Invitation recovery requires operator review');}
      throw error;
    }
  });
}
