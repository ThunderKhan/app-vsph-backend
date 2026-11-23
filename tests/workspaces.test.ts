import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {WorkspaceCountStore} from '../src/modules/workspaces/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={cookie:'vsph.portal.sid='+raw};
function fixture(role:string|null='user'){
 const calls:Array<{actor:string;owner:boolean}>=[];
 const profile={id:actor,full_name:'Test',email:'test@example.invalid',
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
 const store:WorkspaceCountStore={count:async(who,owner)=>{
  calls.push({actor:who,owner});return {count:owner?5:2};
 }};
 return {auth,store,calls};
}
test('workspaces count requires current portal and rejects actor/tenant query injection',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},workspaces:f.store});
 try{
  assert.equal((await app.inject({method:'GET',url:'/api/workspaces'})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/api/workspaces?actor=other',headers})).statusCode,400);
  assert.equal(f.calls.length,0);
  const good=await app.inject({method:'GET',url:'/api/workspaces',headers});
  assert.equal(good.statusCode,200,good.body);
  assert.deepEqual(good.json(),{count:2});
  assert.deepEqual(f.calls,[{actor,owner:false}]);
 }finally{await app.close();}
});
test('owner count scope is derived from current profile rather than browser request',async()=>{
 const f=fixture('super_admin'),app=buildApp(env,{auth:{store:f.auth},workspaces:f.store});
 try{
  const response=await app.inject({method:'GET',url:'/api/workspaces',headers});
  assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(response.json(),{count:5});
  assert.deepEqual(f.calls,[{actor,owner:true}]);
 }finally{await app.close();}
});
test('SQL workspace query failure returns denial, not a false count of zero',async()=>{
 const f=fixture();f.store.count=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},workspaces:f.store});
 try{
  const response=await app.inject({method:'GET',url:'/api/workspaces',headers});
  assert.equal(response.statusCode,403);
  assert.equal(response.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
