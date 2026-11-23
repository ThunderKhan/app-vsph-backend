import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {FinanceJournalStore,JournalKind} from './journal-store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const scope=/^[a-f0-9]{32}$/;
const query=z.strictObject({
 kind:z.enum(['invoices','receipts']).optional(),
 organizationId:z.string().regex(uuid).optional(),
 projectId:z.string().regex(uuid).optional(),
 status:z.string().optional(),
 search:z.string().optional(),
 from:z.string().optional(),to:z.string().optional(),
 cursor:z.string().max(500).optional(),
});
function validDate(value:string):boolean{
 return date.test(value)&&!Number.isNaN(Date.parse(value))&&
  new Date(value).toISOString().slice(0,10)===value;
}
function invalid():never{
 throw new HttpError(400,'INVALID_JOURNAL_FILTERS',
  'Invalid journal filters or cursor. Refresh the first page.');
}
function parseFilters(raw:unknown):{kind:JournalKind;filters:Record<string,unknown>}{
 const parsed=query.safeParse(raw);
 if(!parsed.success)return invalid();
 const q=parsed.data,kind=q.kind??'invoices';
 const allowed=kind==='invoices'?['all','issued','void']:['all','active','reversed'];
 if(q.status!==undefined&&!allowed.includes(q.status))return invalid();
 if((q.from&&!validDate(q.from))||(q.to&&!validDate(q.to))||
   (q.from&&q.to&&q.from>q.to))return invalid();
 const filters:Record<string,unknown>={};
 for(const key of ['organizationId','projectId','status','from','to'] as const)
  if(q[key]!==undefined)filters[key]=q[key];
 if(q.search!==undefined){
  const search=q.search.trim();
  if(search.length>100||Array.from(search).some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127)||
    /[\uD800-\uDFFF]/u.test(search))return invalid();
  filters.search=search;
 }
 if(q.cursor!==undefined){
  let cursor:unknown;
  try{cursor=JSON.parse(q.cursor);}catch{return invalid();}
  if(!cursor||typeof cursor!=='object'||Array.isArray(cursor))return invalid();
  const value=cursor as Record<string,unknown>;
  if(Object.keys(value).length!==3||
    Object.keys(value).some(k=>!['at','id','scope'].includes(k))||
    typeof value.id!=='string'||!uuid.test(value.id)||
    typeof value.scope!=='string'||!scope.test(value.scope)||
    typeof value.at!=='string'||!timestamp.test(value.at)||
    !validDate(value.at.slice(0,10))||!Number.isFinite(Date.parse(value.at)))
    return invalid();
  // Preserve PostgreSQL's timestamp precision; never round the cursor.
  filters.cursor=value;
 }
 return {kind,filters};
}
export function installFinanceJournal(app:FastifyInstance,auth:AuthStore,store:FinanceJournalStore):void{
 async function owner(req:FastifyRequest):Promise<string>{
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{
   const principal=await resolvePortalSession(raw,{
    findByTokenHash:hash=>auth.portalSession(hash),
   });
   if(principal.user.platform_role!=='super_admin')
    throw new HttpError(403,'ACCESS_DENIED','Owner authority required.');
   return principal.user.id;
  }catch(error){
   if(error instanceof PortalSessionError)
    throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 app.get('/api/finance/journal',async req=>{
  const actor=await owner(req),{kind,filters}=parseFilters(req.query);
  return store.list(actor,kind,filters);
 });
}
