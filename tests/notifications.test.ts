import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {NotificationStore} from '../src/modules/notifications/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw};
function fixture(){
 const events:Array<{actor:string;action:string;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Employee',email:'employee@example.invalid',
  status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const store:NotificationStore={command:async(who,action,data)=>{
   events.push({actor:who,action,data});
   if(action==='inbox')return {notifications:[]};
   return {saved:true};
 }};
 return {auth,store,events};
}
test('inbox SQL dispatch precedes scoped inbox; no session never invokes SQL',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},notifications:f.store});
 try{
  const missing=await app.inject({method:'GET',url:'/api/notifications'});
  assert.equal(missing.statusCode,401);assert.equal(f.events.length,0);
  const ok=await app.inject({method:'GET',url:'/api/notifications',
   headers:{cookie:headers.cookie}});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.events,[{actor,action:'dispatch',data:{}},{actor,action:'inbox',data:{}}]);
 }finally{await app.close();}
});
test('preferences mutation validates exact typed fields and uses actor from portal',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},notifications:f.store});
 const valid={assignments:true,delivery:false,overdue:true};
 try{
  const unknown=await app.inject({method:'POST',url:'/api/notifications/preferences',
   headers,payload:{...valid,actor:'evil'}});
  assert.equal(unknown.statusCode,400);assert.equal(f.events.length,0);
  const ok=await app.inject({method:'POST',url:'/api/notifications/preferences',
   headers,payload:valid});
  assert.equal(ok.statusCode,200);
  assert.deepEqual(f.events,[{actor,action:'preferences.save',data:valid}]);
 }finally{await app.close();}
});
test('notification read accepts bounded numerical public ID, rejects malformed input',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},notifications:f.store});
 try{
  const bad=await app.inject({method:'POST',url:'/api/notifications/not-a-number/read',
   headers,payload:{}});
  assert.equal(bad.statusCode,400);assert.equal(f.events.length,0);
  const ok=await app.inject({method:'POST',url:'/api/notifications/1234/read',headers,payload:{}});
  assert.equal(ok.statusCode,200);
  assert.deepEqual(f.events,[{actor,action:'read',data:{notificationId:'1234'}}]);
 }finally{await app.close();}
});
test('SQL tenant denial and dispatch failure are not hidden by empty success inbox',async()=>{
 const f=fixture();f.store.command=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},notifications:f.store});
 try{
  const denied=await app.inject({method:'GET',url:'/api/notifications',
   headers:{cookie:headers.cookie}});
  assert.equal(denied.statusCode,403);assert.equal(denied.json().code,'ACCESS_DENIED');
  const csrf=await app.inject({method:'POST',url:'/api/notifications/retry',
   headers:{origin:'https://evil.invalid',cookie:headers.cookie},payload:{}});
  assert.equal(csrf.statusCode,403);
 }finally{await app.close();}
});
