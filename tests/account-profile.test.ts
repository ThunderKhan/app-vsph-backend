import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {AccountProfileStore} from '../src/modules/profile/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cookie='A'.repeat(43),hash=hashSessionToken(cookie);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+cookie};
const body={displayName:'  Test User  ',bio:'Working on projects',timeZone:'Asia/Kolkata',
 avatarTone:'navy',version:2};
function fixture() {
 const calls:unknown[][]=[];
 const auth:AuthStore={
  activeProfile:async()=>null,portalSession:async token=>token===hash?{
    token_hash:hash,user_id:actor,expires_at:'2099-11-23T00:00:00Z',
    profile:{id:actor,full_name:'Test',email:'test@example.invalid',platform_role:null,status:'active'},
  }:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const profile:AccountProfileStore={command:async(...args)=>{calls.push(args);return {version:2};}};
 return {auth,profile,calls};
}
test('account profile accepts only verified actor and session',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},profile:f.profile});
 try{
  const missing=await app.inject({method:'GET',url:'/api/account/profile'});
  assert.equal(missing.statusCode,401);
  const response=await app.inject({method:'GET',url:'/api/account/profile',
   headers:{cookie:headers.cookie}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(f.calls[0],[actor,hash,'get',{}]);
  const forged=await app.inject({method:'GET',url:'/api/account/profile?actor=someone',
   headers:{cookie:headers.cookie}});
  assert.equal(forged.statusCode,400);
  assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('account profile validates timezone, version, avatar and rejects actor injection',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},profile:f.profile});
 try{
  for(const invalid of [{...body,timeZone:'Mars/Unknown'},{...body,version:-1},
   {...body,avatarTone:'custom'},{...body,displayName:'bad\u0000text'},
   {...body,actor:'someone'}]){
   const result=await app.inject({method:'PATCH',url:'/api/account/profile',headers,payload:invalid});
   assert.equal(result.statusCode,400);
  }
  assert.deepEqual(f.calls,[]);
  const ok=await app.inject({method:'PATCH',url:'/api/account/profile',headers,payload:body});
  assert.equal(ok.statusCode,200);
  assert.deepEqual(f.calls[0],[actor,hash,'save',{...body,displayName:'Test User'}]);
 }finally{await app.close();}
});
test('SQL optimistic update conflicts remain 409, never convert to success',async()=>{
 const f=fixture();f.profile.command=async()=>{throw new RpcError('40001');};
 const app=buildApp(env,{auth:{store:f.auth},profile:f.profile});
 try{
  const conflict=await app.inject({method:'PATCH',url:'/api/account/profile',headers,payload:body});
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.json().code,'CONFLICT');
 }finally{await app.close();}
});
