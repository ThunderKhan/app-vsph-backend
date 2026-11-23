import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ProjectWorkspaceStore,WorkspaceOperation} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Include full UUID pattern, not a prefix that could accept a guessed foreign key.
const fullUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=z.string().regex(fullUuid);
const version=z.number().int().positive().max(999999999);
const noControl=(s:string)=>!Array.from(s).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const label=(min:number,max:number)=>z.string().max(max).refine(s=>s.trim().length>=min&&noControl(s));
const url=z.string().max(1000).refine(raw=>{
 try{
  const u=new URL(raw);
  return u.protocol==='https:'&&!u.username&&!u.password&&/^[a-z0-9.-]+$/i.test(u.hostname);
 }catch{return false;}
});
const schemas={
 'checklist-add':z.strictObject({version,milestoneId:id,title:label(1,180),assigneeId:id.nullable()}),
 'checklist-toggle':z.strictObject({version,itemId:id,completed:z.boolean()}),
 'risk-add':z.strictObject({version,title:label(1,180),severity:z.enum(['low','medium','high'])}),
 'risk-resolve':z.strictObject({version,id,resolved:z.boolean()}),
 'resource-add':z.strictObject({version,label:label(1,120),url,category:z.enum([
   'document','design','repository','deployment','other']),shared:z.boolean()}),
 'resource-archive':z.strictObject({version,id}),
 'update-publish':z.strictObject({version,summary:label(8,2500),
    health:z.enum(['on_track','at_risk','off_track']),nextSteps:label(0,1500),shared:z.boolean()}),
};
const actions:Record<keyof typeof schemas,WorkspaceOperation>={
 'checklist-add':'checklist.add','checklist-toggle':'checklist.toggle',
 'risk-add':'risk.add','risk-resolve':'risk.resolve',
 'resource-add':'resource.add','resource-archive':'resource.archive',
 'update-publish':'update.publish',
};
function invalid():never{throw new HttpError(400,'INVALID_WORKSPACE_DATA','Invalid project data.');}
export function installProjectWorkspace(app:FastifyInstance,auth:AuthStore,store:ProjectWorkspaceStore):void {
 async function actor(request:FastifyRequest):Promise<string>{
  const raw=sessionCookies(request)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return (await resolvePortalSession(raw,{
    findByTokenHash:hash=>auth.portalSession(hash),
  })).user.id;}catch(error){
   if(error instanceof PortalSessionError)
     throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 app.get<{Params:{id:string}}>('/api/projects/:id/workspace',async req=>{
  if(!fullUuid.test(req.params.id)||Object.keys(req.query as Record<string,unknown>).length)
    return invalid();
  return store.command(await actor(req),'list',req.params.id,{});
 });
 app.post<{Params:{id:string;action:string}}>('/api/projects/:id/workspace/:action',async req=>{
  if(!fullUuid.test(req.params.id)||Object.keys(req.query as Record<string,unknown>).length||
    !Object.hasOwn(schemas,req.params.action))return invalid();
  const action=req.params.action as keyof typeof schemas;
  const parsed=schemas[action].safeParse(req.body);
  if(!parsed.success)return invalid();
  return store.command(await actor(req),actions[action],req.params.id,parsed.data);
 });
}
