import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {FinanceJournalStore} from '../src/modules/finance/journal-store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={cookie:'vsph.portal.sid='+raw};
function fixture(role='super_admin'){
 const calls:Array<{actor:string;kind:string;filters:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Owner',email:'owner@example.invalid',
  status:'active',platform_role:role};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const journal:FinanceJournalStore={list:async(who,kind,filters)=>{
  calls.push({actor:who,kind,filters});return {items:[],nextCursor:null};
 }};
 return {auth,journal,calls};
}
test('journal is owner-only and never runs SQL for unauthenticated or non-owner users',async()=>{
 const f=fixture('employee'),app=buildApp(env,{auth:{store:f.auth},journal:f.journal});
 try{
  assert.equal((await app.inject({method:'GET',url:'/api/finance/journal'})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/api/finance/journal',headers})).statusCode,403);
  assert.equal(f.calls.length,0);
 }finally{await app.close();}
});
test('journal validates exact filters and supplies trusted actor to finance_journal',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},journal:f.journal});
 try{
  const good=await app.inject({method:'GET',headers,
   url:'/api/finance/journal?kind=receipts&organizationId='+org+'&status=reversed&search=%20receipt%20'});
  assert.equal(good.statusCode,200,good.body);
  assert.deepEqual(f.calls,[{actor,kind:'receipts',
   filters:{organizationId:org,status:'reversed',search:'receipt'}}]);
  for(const q of ['actor=evil','kind=unknown','kind=receipts&status=issued',
   'from=2026-02-30','from=2026-12-01&to=2026-11-01',
   'search=%0Ainvalid','organizationId=invalid','cursor=%7B%7D']){
   const response=await app.inject({method:'GET',headers,url:'/api/finance/journal?'+q});
   assert.equal(response.statusCode,400,q+' '+response.body);
  }
  assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('cursor scope and microseconds survive unchanged to SQL for reauthorization',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},journal:f.journal});
 const cursor={at:'2026-11-21T19:20:33.123456+05:30',id:org,scope:'a'.repeat(32)};
 try{
  const ok=await app.inject({method:'GET',headers,url:'/api/finance/journal?cursor='+
   encodeURIComponent(JSON.stringify(cursor))});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.calls[0]?.filters.cursor,cursor);
  const invalid={...cursor,scope:'not-scope'};
  const rejected=await app.inject({method:'GET',headers,url:'/api/finance/journal?cursor='+
   encodeURIComponent(JSON.stringify(invalid))});
  assert.equal(rejected.statusCode,400);
  assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('journal SQL denial cannot be misreported as empty results',async()=>{
 const f=fixture();f.journal.list=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},journal:f.journal});
 try{
  const response=await app.inject({method:'GET',url:'/api/finance/journal',headers});
  assert.equal(response.statusCode,403);
  assert.equal(response.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
