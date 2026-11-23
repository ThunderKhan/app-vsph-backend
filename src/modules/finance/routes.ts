import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {FinanceCommandStore,FinanceAction} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ref=/^[A-Za-z0-9][A-Za-z0-9/_-]{2,79}$/;
const receiptRef=/^[A-Za-z0-9][A-Za-z0-9/_-]{2,99}$/;
const amount=z.number().int().positive().max(1000000000000);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>
  !Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const invoice=z.strictObject({
  reference:z.string().regex(ref),organizationId:z.string().regex(uuid),
  projectId:z.union([z.string().regex(uuid),z.null()]),
  amountPaise:amount,issuedOn:date,dueOn:date,
}).refine(x=>x.dueOn>=x.issuedOn);
const payment=z.strictObject({
  idempotencyKey:z.string().regex(uuid),reference:z.string().regex(receiptRef),
  amountPaise:amount,receivedOn:date,
}).refine(x=>x.receivedOn<=new Date().toISOString().slice(0,10));
const reason=z.string().trim().min(8).max(300);
const reverse=z.strictObject({reason,confirmed:z.literal(true)});
const voidInvoice=z.strictObject({version:z.number().int().min(1).max(999999999),
 reason,confirmed:z.literal(true)});

export function installFinanceCommands(app:FastifyInstance,sessions:AuthStore,store:FinanceCommandStore):void{
 async function owner(request:FastifyRequest):Promise<string>{
  const raw=sessionCookies(request)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  let principal;
  try {principal=await resolvePortalSession(raw,{
    findByTokenHash:hash=>sessions.portalSession(hash),
  });}catch(error){
    if(error instanceof PortalSessionError)
      throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
    throw error;
  }
  if(principal.user.platform_role!=='super_admin')
    throw new HttpError(403,'ACCESS_DENIED','Owner authority required.');
  return principal.user.id;
 }
 function body<T>(schema:z.ZodType<T>,raw:unknown):T {
  const parsed=schema.safeParse(raw);
  if(!parsed.success)throw new HttpError(400,'INVALID_FINANCE_FIELDS','Invalid finance fields.');
  return parsed.data;
 }
 async function command(request:FastifyRequest,action:FinanceAction,id:string,
   data:Record<string,unknown>):Promise<unknown> {
  const actor=await owner(request);
  // No multi-step writes, no JS paise arithmetic, and no client-supplied actor.
  return store.run(actor,action,id,data);
 }
 function response(reply:{code:(status:number)=>unknown},result:unknown){
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw Error('Invalid finance result');
  const replayed=(result as Record<string,unknown>).replayed===true;
  reply.code(replayed?200:201);
  return result;
 }
 app.post('/api/finance/invoices',async(request,reply)=>{
  const actor=await owner(request);
  const id=request.headers['idempotency-key'];
  if(typeof id!=='string'||!uuid.test(id))
    throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED','A UUID Idempotency-Key is required.');
  const data=body(invoice,request.body);
  const result=await store.run(actor,'invoice.create',id,data);
  return response(reply,result);
 });
 app.post<{Params:{id:string}}>('/api/finance/invoices/:id/payments',async(request,reply)=>{
  if(!uuid.test(request.params.id))throw new HttpError(400,'INVALID_FINANCE_FIELDS','Invalid invoice ID.');
  const data=body(payment,request.body);
  const result=await command(request,'payment.record',request.params.id,data);
  return response(reply,result);
 });
 app.post<{Params:{id:string}}>('/api/finance/payments/:id/reverse',async request=>{
  if(!uuid.test(request.params.id))throw new HttpError(400,'INVALID_FINANCE_FIELDS','Invalid receipt ID.');
  return command(request,'payment.reverse',request.params.id,body(reverse,request.body));
 });
 app.post<{Params:{id:string}}>('/api/finance/invoices/:id/void',async request=>{
  if(!uuid.test(request.params.id))throw new HttpError(400,'INVALID_FINANCE_FIELDS','Invalid invoice ID.');
  return command(request,'invoice.void',request.params.id,body(voidInvoice,request.body));
 });
}
