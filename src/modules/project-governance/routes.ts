import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ProjectGovernanceStore} from './store.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const version=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const assign=z.strictObject({version,userId:z.string().regex(uuid),
 role:z.enum(['manager','contributor','viewer']),team:z.string().max(100)});
const remove=z.strictObject({version,userId:z.string().regex(uuid)});
const member=z.strictObject({version,userId:z.string().regex(uuid),
 role:z.enum(['manager','contributor','viewer','client']),
 status:z.enum(['active','revoked']),team:z.string().max(100).optional()});
const lifecycle=z.strictObject({version:z.number().int().min(1).max(999999999),
 key:z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/),confirmed:z.literal(true)});
const types={assign:'assign',remove:'remove',
 'manager-grant':'manager.grant','manager-revoke':'manager.revoke'} as const;
function invalid():never{throw new HttpError(400,'INVALID_PROJECT_DATA','Invalid project data.');}
export function installProjectGovernance(app:FastifyInstance,auth:AuthStore,
 store:ProjectGovernanceStore):void {
 async function principal(req:FastifyRequest):Promise<string>{
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return (await resolvePortalSession(raw,{findByTokenHash:hash=>auth.portalSession(hash)})).user.id;}
  catch(error){
   if(error instanceof PortalSessionError)
     throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 app.get<{Params:{id:string}}>('/api/projects/:id/workforce',async req=>{
  if(!uuid.test(req.params.id)||Object.keys(req.query as Record<string,unknown>).length)return invalid();
  return store.workforce(await principal(req),'directory',req.params.id,{});
 });
 app.post<{Params:{id:string;action:string}}>('/api/projects/:id/workforce/:action',async req=>{
  if(!uuid.test(req.params.id)||!Object.hasOwn(types,req.params.action))return invalid();
  const action=types[req.params.action as keyof typeof types];
  const parsed=(action==='assign'?assign:remove).safeParse(req.body);
  if(!parsed.success)return invalid();
  return store.workforce(await principal(req),action,req.params.id,parsed.data);
 });
 app.post<{Params:{id:string}}>('/api/projects/:id/members',async req=>{
  if(!uuid.test(req.params.id))return invalid();
  const parsed=member.safeParse(req.body);
  if(!parsed.success)return invalid();
  const {version,userId,role,status}=parsed.data,who=await principal(req);
  if(role==='client')return store.clientMember(who,req.params.id,parsed.data);
  if(status==='revoked')return store.workforce(who,'remove',req.params.id,{version,userId});
  return store.workforce(who,'assign',req.params.id,{
   version,userId,role,team:parsed.data.team??'',
  });
 });
 app.post<{Params:{id:string;action:string}}>('/api/projects/:id/lifecycle/:action',async req=>{
  if(!uuid.test(req.params.id)||!['archive','delete'].includes(req.params.action))
    return invalid();
  const parsed=lifecycle.safeParse(req.body);
  if(!parsed.success)return invalid();
  try{return await store.lifecycle(await principal(req),
    req.params.action as 'archive'|'delete',req.params.id,parsed.data);}
  catch(error){
   if(error instanceof RpcError&&error.state==='23503')
     throw new HttpError(400,'PROJECT_HAS_DEPENDENCIES',
       'Project has linked work, records or external references. Keep it archived.');
   throw error;
  }
 });
}
