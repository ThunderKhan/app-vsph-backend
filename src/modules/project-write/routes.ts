import type {FastifyInstance,FastifyRequest} from 'fastify';
import {HttpError} from '../../errors.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ProjectWriteAction,ProjectWriteStore} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed:Record<ProjectWriteAction,readonly string[]>={
 create:['key','name','description','kind','customerOrganizationId','ownerId','priority',
  'startsOn','dueOn','clientVisible','products','managerUserId'],
 update:['version','name','description','ownerId','status','priority','dueOn',
  'clientVisible','products'],
 'milestone.create':['version','title','dueOn','shared'],
 'milestone.update':['version','id','title','status','dueOn','dependsOn','shared'],
 'task.create':['version','title','description','priority','dueOn','assigneeId',
  'milestoneId','shared'],
 'task.update':['version','id','title','description','priority','dueOn','assigneeId',
  'milestoneId','status','shared'],
 'comment.create':['version','body','taskId','shared'],
 'deliverable.create':['version','title','url','taskId','shared'],
};
const invalid=():never=>{throw new HttpError(400,'INVALID_PROJECT_DATA','Invalid project data.');};
function date(value:unknown):boolean{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 !Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function validate(action:ProjectWriteAction,raw:unknown):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid();
 const data=raw as Record<string,unknown>;
 if(Object.keys(data).some(key=>!allowed[action].includes(key)))return invalid();
 if(action!=='create'&&(!Number.isSafeInteger(data.version)||(data.version as number)<1))
   return invalid();
 for(const key of ['id','userId','ownerId','customerOrganizationId','milestoneId',
  'taskId','assigneeId','dependsOn','managerUserId']){
   const value=data[key];
   if(value!==undefined&&value!==null&&value!==''&&(typeof value!=='string'||!uuid.test(value)))
     return invalid();
 }
 for(const [key,max] of [['name',150],['title',200],['description',5000],['body',4000]] as const){
  if(data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>max||
    (['name','title','body'].includes(key)&&!data[key].trim())))return invalid();
 }
 for(const field of ['startsOn','dueOn'])
   if(data[field]&&(!date(data[field])))return invalid();
 for(const field of ['shared','clientVisible'])
   if(data[field]!==undefined&&typeof data[field]!=='boolean')return invalid();
 if(data.priority&& !['low','normal','high','urgent'].includes(data.priority as string))
   return invalid();
 if(data.products!==undefined){
   const products=data.products;
   if(!Array.isArray(products)||products.length>20||
      products.some(item=>typeof item!=='string'||!uuid.test(item))||
      new Set(products).size!==products.length)return invalid();
 }
 if(action==='create'){
  if(typeof data.key!=='string'||!/^[A-Z][A-Z0-9-]{1,19}$/.test(data.key)||
     typeof data.name!=='string'||!data.name.trim()||
     !['internal','customer'].includes(data.kind as string)||
     ((data.kind==='customer')!==Boolean(data.customerOrganizationId)))return invalid();
 }
 if(action.endsWith('.create')&&!(data.title||data.body))return invalid();
 if(action.endsWith('.update')&&(!data.id||typeof data.id!=='string'||!uuid.test(data.id)))
   return invalid();
 if(data.url!==undefined){
  if(typeof data.url!=='string'||data.url.length>2000)return invalid();
  try{
   const url=new URL(data.url);
   if(url.protocol!=='https:'||url.username||url.password)return invalid();
  }catch{return invalid();}
 }
 return data;
}
export function installProjectWriteRoutes(app:FastifyInstance,auth:AuthStore,store:ProjectWriteStore):void{
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
 async function command(request:FastifyRequest,action:ProjectWriteAction,id:string|null,
   data:Record<string,unknown>):Promise<unknown>{
   return store.command(await actor(request),action,id,data);
 }
 app.post('/api/projects',async(request,reply)=>{
  const data=validate('create',request.body),who=await actor(request);
  let outcome:unknown;
  if(Object.hasOwn(data,'managerUserId')){
   try{outcome=await store.createWithManager(who,data);}
   catch(error){
    // The reviewed project-manager appointment schema may be absent.
    // Refuse any requested manager assignment rather than silently dropping it.
    if(!(error instanceof RpcError)||!['PGRST202','42883'].includes(error.state))throw error;
    if(data.managerUserId)
      throw new HttpError(503,'SCHEMA_NOT_READY',
        'Project-manager appointment requires the reviewed schema upgrade.');
    const legacy={...data};delete legacy.managerUserId;
    outcome=await store.command(who,'create',null,legacy);
   }
  }else outcome=await store.command(who,'create',null,data);
  reply.code(201);return outcome;
 });
 app.patch<{Params:{id:string}}>('/api/projects/:id',async request=>{
  if(!uuid.test(request.params.id))return invalid();
  return command(request,'update',request.params.id,validate('update',request.body));
 });
 const creations={
  milestones:'milestone.create',tasks:'task.create',
  comments:'comment.create',deliverables:'deliverable.create',
 } as const;
 for(const [resource,action] of Object.entries(creations)){
   app.post<{Params:{id:string}}>('/api/projects/:id/'+resource,async request=>{
    if(!uuid.test(request.params.id))return invalid();
    return command(request,action,request.params.id,validate(action,request.body));
   });
 }
 for(const [resource,action] of [['tasks','task.update'],['milestones','milestone.update']] as const){
   app.patch<{Params:{id:string;entity:string}}>('/api/projects/:id/'+resource+'/:entity',async request=>{
    if(!uuid.test(request.params.id)||!uuid.test(request.params.entity))return invalid();
    const requestBody=request.body;
    if(!requestBody||typeof requestBody!=='object'||Array.isArray(requestBody))return invalid();
    return command(request,action,request.params.id,
      validate(action,{...requestBody,id:request.params.entity}));
   });
 }
}
