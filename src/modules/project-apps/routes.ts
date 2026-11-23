import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ProjectCustomAppsStore} from './store.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUrl=(value:string):boolean=>{
 if(!value)return true;
 if(value.length>1000||!/^\x68ttps:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~/%-]*)?$/.test(value))return false;
 try{
  const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;
 }catch{return false;}
};
const schema=z.strictObject({
 name:z.string().min(1).max(150).refine(v=>Boolean(v.trim())),
 description:z.string().max(2000),
 status:z.enum(['planned','building','testing','live','paused','retired']),
 repositoryUrl:z.string().max(1000).refine(validUrl),
 deploymentUrl:z.string().max(1000).refine(validUrl),
 shared:z.boolean(),
});
const updating=schema.extend({version:z.number().int().min(1).max(2147483646)});
const invalid=():never=>{throw new HttpError(400,'INVALID_PROJECT_DATA','Invalid project data.');};
export function installProjectCustomApps(app:FastifyInstance,auth:AuthStore,store:ProjectCustomAppsStore):void{
 async function actor(request:FastifyRequest):Promise<string>{
  const raw=sessionCookies(request)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return (await resolvePortalSession(raw,{
    findByTokenHash:hash=>auth.portalSession(hash),
  })).user.id;}
  catch(error){
   if(error instanceof PortalSessionError)
     throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 app.get<{Params:{id:string}}>('/api/projects/:id/applications',async req=>{
   if(!uuid.test(req.params.id)||Object.keys(req.query as Record<string,unknown>).length)
     return invalid();
   return store.command(await actor(req),'list',req.params.id,null,{});
 });
 app.post<{Params:{id:string}}>('/api/projects/:id/applications',async req=>{
   if(!uuid.test(req.params.id)||Object.keys(req.query as Record<string,unknown>).length)return invalid();
   const parsed=schema.safeParse(req.body);
   if(!parsed.success)return invalid();
   return store.command(await actor(req),'create',req.params.id,null,{
     ...parsed.data,name:parsed.data.name.trim(),
   });
 });
 app.patch<{Params:{id:string;applicationId:string}}>('/api/projects/:id/applications/:applicationId',async req=>{
   if(!uuid.test(req.params.id)||!uuid.test(req.params.applicationId)||
     Object.keys(req.query as Record<string,unknown>).length)return invalid();
   const parsed=updating.safeParse(req.body);
   if(!parsed.success)return invalid();
   return store.command(await actor(req),'update',req.params.id,req.params.applicationId,{
     ...parsed.data,name:parsed.data.name.trim(),
   });
 });
}
