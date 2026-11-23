import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {ProjectReportStore} from './store.js';
import {projectCsv} from './csv.js';
const fullUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>
 !Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const filters=z.strictObject({
 projectId:z.string().regex(fullUuid).optional(),
 organizationId:z.string().regex(fullUuid).optional(),
 ownerId:z.string().regex(fullUuid).optional(),
 status:z.enum(['planned','active','paused','completed','archived']).optional(),
 from:iso.optional(),to:iso.optional(),
}).refine(x=>!(x.from&&x.to&&x.from>x.to));
function invalid():never{throw new HttpError(400,'INVALID_REPORT_FILTERS','Invalid notification/report request.');}
export function installProjectReports(app:FastifyInstance,auth:AuthStore,store:ProjectReportStore):void {
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
 async function fetchReport(request:FastifyRequest):Promise<unknown>{
  const parsed=filters.safeParse(request.query);
  if(!parsed.success)return invalid();
  const {projectId,...data}=parsed.data;
  return store.list(await actor(request),projectId??null,
    Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined)));
 }
 app.get('/api/project-reports',async request=>fetchReport(request));
 app.get('/api/project-reports/export.csv',async(request,reply)=>{
  const report=await fetchReport(request);
  const csv=projectCsv(report);
  reply.header('Content-Disposition','attachment; filename="vsph-project-report.csv"');
  reply.header('X-VSPH-Export-Scope','first-100-authorized-matching-projects');
  return reply.type('text/csv; charset=utf-8').send(csv);
 });
}
