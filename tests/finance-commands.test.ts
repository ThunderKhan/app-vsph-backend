import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {FinanceCommandStore} from '../src/modules/finance/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw,'idempotency-key':key};
const invoice={reference:'INV_123',organizationId:org,projectId:project,
 amountPaise:15755,issuedOn:'2026-11-20',dueOn:'2026-12-20'};
function fixture(role:string|null='super_admin'){
 const calls:Array<{actor:string;action:string;id:string;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'User',email:'user@example.invalid',status:'active',platform_role:role};
 const auth:AuthStore={
  activeProfile:async()=>profile,
  portalSession:async token=>token===hash?{token_hash:hash,user_id:actor,
   expires_at:'2099-11-23T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const finance:FinanceCommandStore={
  run:async(actor,action,id,data)=>{
   calls.push({actor,action,id,data});
   return {id:'test-result',replayed:false};
  },
 };
 return {auth,finance,calls};
}
test('finance writes require active owner and trusted origin',async()=>{
 const employee=fixture('employee'),app=buildApp(env,{auth:{store:employee.auth},finance:employee.finance});
 try{
  const noSession=await app.inject({method:'POST',url:'/api/finance/invoices',
   headers:{origin:env.PUBLIC_ORIGIN,'idempotency-key':key},payload:invoice});
  assert.equal(noSession.statusCode,401);
  const notOwner=await app.inject({method:'POST',url:'/api/finance/invoices',headers,payload:invoice});
  assert.equal(notOwner.statusCode,403);
  const csrf=await app.inject({method:'POST',url:'/api/finance/invoices',
   headers:{...headers,origin:'https://evil.invalid'},payload:invoice});
  assert.equal(csrf.statusCode,403);
  assert.deepEqual(employee.calls,[]);
 }finally{await app.close();}
});
test('invoice validation forbids floating-point and missing idempotency key',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},finance:f.finance});
 try{
  const missing=await app.inject({method:'POST',url:'/api/finance/invoices',
   headers:{origin:env.PUBLIC_ORIGIN,cookie:headers.cookie},payload:invoice});
  assert.equal(missing.statusCode,400);
  for(const badAmount of [100.05,-200,0,1e15]){
   const invalid=await app.inject({method:'POST',url:'/api/finance/invoices',
    headers,payload:{...invoice,amountPaise:badAmount}});
   assert.equal(invalid.statusCode,400);
  }
  assert.equal(f.calls.length,0);
  const created=await app.inject({method:'POST',url:'/api/finance/invoices',headers,payload:invoice});
  assert.equal(created.statusCode,201,created.body);
  assert.deepEqual(f.calls[0],{actor,action:'invoice.create',id:key,data:invoice});
 }finally{await app.close();}
});
test('payment, void and reversal preserve exact SQL commands and safe replay',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},finance:f.finance});
 try{
  const receipt=await app.inject({method:'POST',url:'/api/finance/invoices/'+project+'/payments',
   headers,payload:{idempotencyKey:key,reference:'RCP_123',amountPaise:750,receivedOn:'2026-11-20'}});
  assert.equal(receipt.statusCode,201,receipt.body);
  assert.equal(f.calls[0]?.action,'payment.record');
  const reverse=await app.inject({method:'POST',url:'/api/finance/payments/'+project+'/reverse',
   headers,payload:{reason:'Duplicate receipt entry',confirmed:true}});
  assert.equal(reverse.statusCode,200);
  assert.equal(f.calls[1]?.action,'payment.reverse');
  const voided=await app.inject({method:'POST',url:'/api/finance/invoices/'+project+'/void',
   headers,payload:{version:3,reason:'Invoice cancelled by owner',confirmed:true}});
  assert.equal(voided.statusCode,200);
  assert.equal(f.calls[2]?.action,'invoice.void');
  f.finance.run=async()=>({replayed:true});
  const replay=await app.inject({method:'POST',url:'/api/finance/invoices',headers,payload:invoice});
  assert.equal(replay.statusCode,200);
 }finally{await app.close();}
});
test('privileged SQL access denial never becomes success',async()=>{
 const f=fixture();f.finance.run=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},finance:f.finance});
 try{
  const forbidden=await app.inject({method:'POST',url:'/api/finance/invoices',headers,payload:invoice});
  assert.equal(forbidden.statusCode,403);
  assert.equal(forbidden.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
