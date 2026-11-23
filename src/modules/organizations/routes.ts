import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {PortalSessionError,resolvePortalSession} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {OrganizationStore,OrganizationAction} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const version=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const cursor=z.strictObject({afterId:z.string().regex(uuid).optional()});
const profile=z.strictObject({version,name:z.string().trim().min(1).max(150)})
 .refine(value=>!/[\u0000-\u001f\u007f]/.test(value.name));
const member=z.strictObject({userId:z.string().regex(uuid),version,
 role:z.enum(['admin','member','viewer']),status:z.enum(['active','suspended']),
 confirmed:z.literal(true)});
const role=z.strictObject({userId:z.string().regex(uuid),version,
 applicationId:z.string().regex(uuid),
 role:z.enum(['','admin','manager','user','viewer','staff','musician']),
 confirmed:z.literal(true)});
const product=z.strictObject({applicationId:z.string().regex(uuid),
 role:z.enum(['admin','manager','user','viewer','staff','musician'])});
const invite=z.strictObject({
 name:z.string(),email:z.string(),memberRole:z.enum(['admin','member','viewer']),
 products:z.array(product).max(12),
});
const generation=z.strictObject({generation:version,confirmed:z.literal(true)});
function invalid(message='Invalid organization request.'):never{
 throw new HttpError(400,'INVALID_ORGANIZATION_REQUEST',message);
}
function validateInvite(raw:unknown,organizationId:string):Record<string,unknown>{
 if(!uuid.test(organizationId))return invalid('Invalid organization.');
 const parsed=invite.safeParse(raw);
 if(!parsed.success)return invalid('Provide name, email, organization role and explicit product roles.');
 const value=parsed.data,name=value.name.trim(),email=value.email.trim().toLowerCase();
 if(!name||name.length>150||/[\u0000-\u001f\u007f]/.test(name)||
   !email||email.length>190||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  return invalid('Provide name, email, organization role and explicit product roles.');
 if(new Set(value.products.map(x=>x.applicationId.toLowerCase())).size!==value.products.length)
  return invalid('Invalid or duplicate product role.');
 return {kind:'member',organizationId,adminName:name,adminEmail:email,
  memberRole:value.memberRole,products:value.products,delegated:true};
}
export function installOrganizations(app:FastifyInstance,auth:AuthStore,store:OrganizationStore):void{
 async function actor(req:FastifyRequest):Promise<string>{
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return (await resolvePortalSession(raw,{
   findByTokenHash:hash=>auth.portalSession(hash),
  })).user.id;}catch(error){
   if(error instanceof PortalSessionError)
    throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 function orgId(id:string):string{
  if(!uuid.test(id))return invalid('Invalid organization.');
  return id;
 }
 function onlyCursor(raw:unknown):Record<string,unknown>{
  const p=cursor.safeParse(raw);
  if(!p.success)return invalid('Invalid cursor.');
  return p.data.afterId?{afterId:p.data.afterId}:{};
 }
 function cleanBody(action:'profile'|'member'|'role',raw:unknown):Record<string,unknown>{
  const p=(action==='profile'?profile:action==='member'?member:role).safeParse(raw);
  if(!p.success)return invalid('Invalid organization update.');
  return p.data;
 }
 app.get('/api/organizations',async req=>
  store.command(await actor(req),'list',null,onlyCursor(req.query)));
 app.get<{Params:{id:string}}>('/api/organizations/:id',async req=>
  store.command(await actor(req),'read',orgId(req.params.id),{}));
 app.get<{Params:{id:string}}>('/api/organizations/:id/members',async req=>
  store.command(await actor(req),'members',orgId(req.params.id),onlyCursor(req.query)));
 for(const action of ['profile','member','role'] as const){
  app.post<{Params:{id:string}}>('/api/organizations/:id/'+action,async req=>{
   const id=orgId(req.params.id),data=cleanBody(action,req.body),who=await actor(req);
   return store.command(who,action as OrganizationAction,id,data);
  });
 }
 app.get<{Params:{id:string}}>('/api/organizations/:id/invitations',async req=>{
  const id=orgId(req.params.id);
  if(Object.keys(req.query as Record<string,unknown>).length)return invalid();
  return store.invitation(await actor(req),'list',id,{});
 });
 app.post<{Params:{id:string}}>('/api/organizations/:id/invitations',async(req,reply)=>{
  const id=orgId(req.params.id),who=await actor(req);
  const request=validateInvite(req.body,id),key=req.headers['idempotency-key'];
  if(typeof key!=='string'||!uuid.test(key))
   return invalid('A UUID Idempotency-Key is required.');
  const result=await store.invitation(who,'queue',id,{key,request});
  if(!result||typeof result!=='object'||Array.isArray(result))
   throw Error('Invalid invitation result');
  reply.code(202);
  return {...result,message:'Invitation queued. Delivery is not confirmed.'};
 });
 for(const action of ['cancel','reissue'] as const){
  app.post<{Params:{id:string;invitationId:string}}>(
   '/api/organizations/:id/invitations/:invitationId/'+action,async req=>{
    const id=orgId(req.params.id),invitationId=req.params.invitationId;
    if(!uuid.test(invitationId))return invalid('Invalid invitation.');
    const p=generation.safeParse(req.body);
    if(!p.success)return invalid('Review and confirm the current invitation generation.');
    return store.invitation(await actor(req),action,id,{
     invitationId,generation:p.data.generation,confirmed:true,
    });
   });
 }
}
