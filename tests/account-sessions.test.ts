import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import type {AuthStore} from '../src/modules/auth/store.js';

const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const target='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cookie='A'.repeat(43),hash=hashSessionToken(cookie);
const user={id:actor,full_name:'Test Owner',email:'owner@example.invalid',status:'active',platform_role:'super_admin'};
const session={token_hash:hash,user_id:actor,expires_at:'2099-11-23T11:00:00Z',profile:user};
test('current session and actor are supplied only by backend, never request body',async()=>{
 const calls:unknown[][]=[];
 const store:AuthStore={
   activeProfile:async()=>null,portalSession:async input=>input===hash?session:null,
   createPortal:async()=>{},revokePortal:async()=>{},temporaryLogout:async()=>{},
   appByCode:async()=>null,contexts:async()=>[],listedApps:async()=>[],listRecords:async()=>[],
   createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
   sessionCommand:async(...args)=>{calls.push(args);return {sessions:[]};},
 };
 const app=buildApp(env,{auth:{store}});
 const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+cookie};
 try {
  const denied=await app.inject({method:'GET',url:'/api/account/sessions'});
  assert.equal(denied.statusCode,401);
  assert.equal(calls.length,0);
  const list=await app.inject({method:'GET',url:'/api/account/sessions',headers:{cookie:headers.cookie}});
  assert.equal(list.statusCode,200);
  assert.deepEqual(calls[0],[actor,'list',null,hash]);
  const invalid=await app.inject({method:'POST',url:'/api/account/sessions/not-uuid/revoke',
    headers,payload:{actor:'attacker'}});
  assert.equal(invalid.statusCode,400);
  assert.equal(calls.length,1);
  const other=await app.inject({method:'POST',url:'/api/account/sessions/revoke-others',
    headers,payload:{actor:'attacker',currentHash:'fake'}});
  assert.equal(other.statusCode,200);
  assert.deepEqual(calls[1],[actor,'revoke_others',null,hash]);
  const revoke=await app.inject({method:'POST',url:'/api/account/sessions/'+target+'/revoke',
    headers,payload:{}});
  assert.equal(revoke.statusCode,200);
  assert.deepEqual(calls[2],[actor,'revoke',target,hash]);
  const csrf=await app.inject({method:'POST',url:'/api/account/sessions/revoke-others',
    headers:{origin:'https://attacker.invalid',cookie:headers.cookie},payload:{}});
  assert.equal(csrf.statusCode,403);assert.equal(calls.length,3);
 } finally{await app.close();}
});
