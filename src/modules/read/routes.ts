import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {PortalSessionError,resolvePortalSession,type ResolvedPortalSession} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {PortalReadStore} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
const statuses=['planned','active','paused','completed','archived','todo','in_progress',
  'blocked','in_review','done','cancelled'] as const;
const query=z.strictObject({
 q:z.string().optional(),kind:z.enum(['all','project','task','milestone']).optional(),
 projectId:z.string().regex(uuid).optional(),organizationId:z.string().regex(uuid).optional(),
 assigneeId:z.string().regex(uuid).optional(),status:z.enum(statuses).optional(),
 from:z.string().regex(date).optional(),to:z.string().regex(date).optional(),
 after:z.string().regex(/^[123]:[0-9a-f-]{36}$/i).optional(),
});
const projectList=z.strictObject({q:z.string().max(100).optional(),
 status:z.string().max(40).optional(),cursor:z.string().regex(uuid).optional()});
const bad=(message='Invalid request.'):never=>{throw new HttpError(400,'INVALID_REQUEST',message);};
function validDate(value:string):boolean {
 return date.test(value)&&!Number.isNaN(Date.parse(value))&&
  new Date(value).toISOString().slice(0,10)===value;
}
function searchFilters(raw:unknown) {
 const p=query.safeParse(raw);
 if(!p.success)return bad('Use 2–100 characters and valid search filters.');
 const q=(p.data.q??'').trim(),kind=p.data.kind??'all';
 if(q.length<2||q.length>100||Array.from(q).some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127))return bad();
 if(p.data.assigneeId&&kind!=='task')return bad();
 if((p.data.from&&!validDate(p.data.from))||(p.data.to&&!validDate(p.data.to))||
   (p.data.from&&p.data.to&&p.data.from>p.data.to))return bad();
 if(p.data.after&&!uuid.test(p.data.after.slice(2)))return bad();
 const {projectId,...rest}=p.data;
 return {projectId:projectId??null,
  data:{q,kind,...Object.fromEntries(Object.entries(rest).filter(([k,v])=>
    k!=='q'&&k!=='kind'&&v!==undefined))}};
}
function noQuery(request:FastifyRequest) {
 if(Object.keys(request.query as Record<string,unknown>).length)return bad();
}
export function installReadRoutes(app:FastifyInstance,sessions:AuthStore,reader:PortalReadStore):void {
 async function principal(request:FastifyRequest):Promise<ResolvedPortalSession>{
  const raw=sessionCookies(request)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Portal session expired. Please log in.');
  try{return await resolvePortalSession(raw,{
    findByTokenHash:hash=>sessions.portalSession(hash),
  });}catch(error){
    if(error instanceof PortalSessionError)
      throw new HttpError(401,'SESSION_REQUIRED','Portal session expired. Please log in.');
    throw error;
  }
 }
 app.get('/api/projects',async request=>{
  const user=await principal(request),p=projectList.safeParse(request.query);
  if(!p.success)return bad('Invalid project filters.');
  return reader.project(user.user.id,'list',null,{
    q:p.data.q??'',status:p.data.status??'',cursor:p.data.cursor??null,
  });
 });
 app.get('/api/projects/manager-overview',async request=>{
  const user=await principal(request);noQuery(request);
  return reader.managerOverview(user.user.id);
 });
 app.get<{Params:{id:string}}>('/api/projects/:id',async request=>{
  const user=await principal(request);
  if(!uuid.test(request.params.id))return bad('Invalid project ID.');
  return reader.project(user.user.id,'detail',request.params.id,{});
 });
 app.get('/api/search',async request=>{
  const user=await principal(request),filters=searchFilters(request.query);
  return reader.search(user.user.id,filters.projectId,filters.data);
 });
 app.get('/api/hrms/access',async request=>{
  const user=await principal(request);noQuery(request);
  return reader.hrAccess(user.user.id,user.session.token_hash);
 });
 app.get('/api/finance',async request=>{
  const user=await principal(request);noQuery(request);
  if(user.user.platform_role!=='super_admin')
    throw new HttpError(403,'ACCESS_DENIED','Owner authority required.');
  return reader.financeDashboard(user.user.id);
 });
 app.get('/api/finance/overview',async request=>{
  const user=await principal(request);noQuery(request);
  if(user.user.platform_role!=='super_admin')
    throw new HttpError(403,'ACCESS_DENIED','Owner authority required.');
  const report=await reader.financeDashboard(user.user.id);
  if(!report||typeof report!=='object')throw Error('Invalid finance report');
  const dto=report as Record<string,unknown>,summary=dto.summary;
  if(!summary||typeof summary!=='object'||!Array.isArray(dto.monthly))
    throw Error('Invalid finance report');
  const allowed=['invoicedPaise','collectedPaise','outstandingPaise','pastDuePaise',
    'issuedInvoices','voidInvoices','clients','projects'] as const;
  const filtered=Object.fromEntries(allowed.map(k=>[k,(summary as Record<string,unknown>)[k]]));
  return {summary:filtered,monthly:dto.monthly.map((x:unknown)=>{
    if(!x||typeof x!=='object')throw Error('Invalid finance month');
    const row=x as Record<string,unknown>;
    return {month_start:row.month_start,collected_paise:row.collected_paise};
  }),asOf:dto.asOf,currency:dto.currency,basis:dto.basis};
 });
}
