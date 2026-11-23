import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {AccountProfileStore} from './store.js';
const body=z.strictObject({
 displayName:z.string().min(1).max(200),bio:z.string().max(500),
 timeZone:z.string().min(1).max(100),avatarTone:z.enum(['navy','blue','slate']),
 version:z.number().int().min(0).max(2147483646),
});
function control(text:string,allowTabAndNewline=false):boolean {
 return Array.from(text).some(c=>{const n=c.charCodeAt(0);
   return n===127||(n<32&&!(allowTabAndNewline&&(n===9||n===10)));
 });
}
function normalize(raw:unknown) {
 const parsed=body.safeParse(raw);
 if(!parsed.success)throw new HttpError(400,'INVALID_PROFILE_FIELDS',
   'Review your display name, bio, time zone and avatar choice.');
 const data=parsed.data,displayName=data.displayName.trim();
 if(!displayName||displayName.length>150||control(data.displayName)||
    control(data.bio,true))
   throw new HttpError(400,'INVALID_PROFILE_FIELDS','Invalid profile fields.');
 try{new Intl.DateTimeFormat('en-IN',{timeZone:data.timeZone});}
 catch{throw new HttpError(400,'INVALID_PROFILE_FIELDS','Invalid time zone.');}
 return {...data,displayName};
}
export function installProfileRoutes(app:FastifyInstance,sessions:AuthStore,store:AccountProfileStore):void{
 async function authenticated(request:FastifyRequest){
  const raw=sessionCookies(request)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return await resolvePortalSession(raw,{findByTokenHash:hash=>sessions.portalSession(hash)});}
  catch(error){
   if(error instanceof PortalSessionError)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 function noQuery(request:FastifyRequest){
  if(Object.keys(request.query as Record<string,unknown>).length)
   throw new HttpError(400,'INVALID_REQUEST','Profile request does not accept filters.');
 }
 app.get('/api/account/profile',async request=>{
  const principal=await authenticated(request);noQuery(request);
  return store.command(principal.user.id,principal.session.token_hash,'get',{});
 });
 app.patch('/api/account/profile',async request=>{
  const principal=await authenticated(request);noQuery(request);
  return store.command(principal.user.id,principal.session.token_hash,'save',normalize(request.body));
 });
}
