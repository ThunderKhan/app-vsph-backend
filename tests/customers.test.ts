import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {CustomerStore} from '../src/modules/customers/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const appId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const get={cookie:'vsph.portal.sid='+raw};
const write={...get,origin:env.PUBLIC_ORIGIN,'idempotency-key':key};
function fixture(role='super_admin'){
 const calls:Array<{op:string;args:unknown[]}>=[];
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
 const store:CustomerStore={
  command:async(...args)=>{calls.push({op:'command',args});return {ok:true};},
  lifecycle:async(...args)=>{calls.push({op:'lifecycle',args});return {version:2};},
  queueInvitation:async(...args)=>{calls.push({op:'queue',args});return {id:key};},
 };
 return {auth,store,calls};
}
test('customer API is owner-only; every RPC actor comes from verified portal session',async()=>{
 const f=fixture('employee'),app=buildApp(env,{auth:{store:f.auth},customers:f.store});
 try{
  assert.equal((await app.inject({method:'GET',url:'/api/customers'})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/api/customers',headers:get})).statusCode,403);
  assert.equal(f.calls.length,0);
 }finally{await app.close();}
 const owner=fixture(),authorized=buildApp(env,{auth:{store:owner.auth},customers:owner.store});
 try{
  const list=await authorized.inject({method:'GET',url:'/api/customers?afterId='+org,headers:get});
  assert.equal(list.statusCode,200,list.body);
  assert.deepEqual(owner.calls[0],{op:'command',args:[actor,'list',null,{afterId:org}]});
  const forged=await authorized.inject({method:'GET',url:'/api/customers?actor='+user,headers:get});
  assert.equal(forged.statusCode,400);
  assert.equal(owner.calls.length,1);
 }finally{await authorized.close();}
});
test('customer membership writes preserve SQL versions and reject forged authority',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},customers:f.store});
 try{
  const ok=await app.inject({method:'POST',url:'/api/customers/'+org+'/member',
   headers:write,payload:{userId:user,version:7,role:'viewer',status:'suspended'}});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.calls[0],{op:'command',args:[actor,'member',org,
   {userId:user,version:7,role:'viewer',status:'suspended'}]});
  for(const payload of [{userId:user,version:1,role:'owner',status:'invalid'},
   {userId:user,version:1,role:'member',status:'active',actor:user}]){
   const denied=await app.inject({method:'POST',url:'/api/customers/'+org+'/member',
    headers:write,payload});
   assert.equal(denied.statusCode,400,denied.body);
  }
  const csrf=await app.inject({method:'POST',url:'/api/customers/'+org+'/role',
   headers:{...write,origin:'https://evil.invalid'},payload:{userId:user,version:1,role:'viewer',applicationId:appId}});
  assert.equal(csrf.statusCode,403);
  assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('customer lifecycle requires explicit impact confirmation and allowlisted action fields',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},customers:f.store});
 try{
  const preview=await app.inject({method:'GET',url:'/api/customers/'+org+'/impact',headers:get});
  assert.equal(preview.statusCode,200);
  assert.deepEqual(f.calls[0],{op:'lifecycle',args:[actor,'preview',org,{}]});
  for(const payload of [{version:1,status:'suspended'},
   {version:1,status:'suspended',confirmed:true,userId:user}]){
   const r=await app.inject({method:'POST',url:'/api/customers/'+org+'/lifecycle/status',
    headers:write,payload});
   assert.equal(r.statusCode,400,r.body);
  }
  const ok=await app.inject({method:'POST',url:'/api/customers/'+org+'/lifecycle/entitlement',
   headers:write,payload:{version:4,confirmed:true,applicationId:appId,planCode:'basic',
    subscriptionStatus:'active',accessStatus:'enabled',startsAt:'2026-11-23T00:00:00Z',endsAt:''}});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.calls[1],{op:'lifecycle',args:[actor,'entitlement',org,{
   version:4,confirmed:true,applicationId:appId,planCode:'basic',
   subscriptionStatus:'active',accessStatus:'enabled',startsAt:'2026-11-23T00:00:00Z',endsAt:'',
  }]});
 }finally{await app.close();}
});
test('customer invitation remains queued until worker delivery, not reported sent',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},customers:f.store});
 const payload={name:' Client Admin ',email:' USER@example.invalid ',
  memberRole:'admin',products:[{applicationId:appId,role:'viewer'}]};
 try{
  const response=await app.inject({method:'POST',url:'/api/customers/'+org+'/invitations',
   headers:write,payload});
  assert.equal(response.statusCode,202,response.body);
  assert.match(response.json().message,/not yet confirmed/);
  assert.deepEqual(f.calls[0],{op:'queue',args:[actor,key,{
   kind:'member',organizationId:org,adminName:'Client Admin',
   adminEmail:'user@example.invalid',memberRole:'admin',
   products:payload.products,
  }]});
  const duplicate=await app.inject({method:'POST',url:'/api/customers/'+org+'/invitations',
   headers:write,payload:{...payload,products:[...payload.products,...payload.products]}});
  assert.equal(duplicate.statusCode,400);
  assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('customer SQL access denial and stale lifecycle are propagated safely',async()=>{
 const f=fixture();
 f.store.command=async()=>{throw new RpcError('42501');};
 f.store.lifecycle=async()=>{throw new RpcError('40001');};
 const app=buildApp(env,{auth:{store:f.auth},customers:f.store});
 try{
  const deny=await app.inject({method:'GET',url:'/api/customers/'+org,headers:get});
  assert.equal(deny.statusCode,403);
  const stale=await app.inject({method:'POST',url:'/api/customers/'+org+'/lifecycle/status',
   headers:write,payload:{version:3,confirmed:true,status:'suspended'}});
  assert.equal(stale.statusCode,409);
  assert.equal(stale.json().code,'CONFLICT');
 }finally{await app.close();}
});
