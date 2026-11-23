import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ProjectCustomAppsStore} from '../src/modules/project-apps/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const item='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw};
const data={name:' App ',description:'Deployment',status:'building',
 repositoryUrl:'https://github.com/org/repo',deploymentUrl:'',shared:false};
function fixture(){
 const calls:Array<{actor:string;action:string;project:string;item:string|null;data:Record<string,unknown>}>=[];
 const user={id:actor,full_name:'Developer',email:'dev@example.invalid',status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>user,portalSession:async value=>value===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile:user}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const store:ProjectCustomAppsStore={
  command:async(user,action,project,item,data)=>{
   calls.push({actor:user,action,project,item,data});return {saved:true};
  },
 };
 return {auth,store,calls};
}
test('project apps require active portal; extra query/actor input cannot reach SQL',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectApps:f.store});
 try{
  const anonymous=await app.inject({method:'GET',url:'/api/projects/'+project+'/applications'});
  assert.equal(anonymous.statusCode,401);
  const forged=await app.inject({method:'GET',url:'/api/projects/'+project+'/applications?actor=evil',
   headers:{cookie:headers.cookie}});
  assert.equal(forged.statusCode,400);
  assert.equal(f.calls.length,0);
 }finally{await app.close();}
});
test('list, create and versioned update preserve exact SQL actor and project id',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectApps:f.store});
 try{
  const read=await app.inject({method:'GET',url:'/api/projects/'+project+'/applications',
   headers:{cookie:headers.cookie}});
  assert.equal(read.statusCode,200);
  const created=await app.inject({method:'POST',url:'/api/projects/'+project+'/applications',
   headers,payload:data});
  assert.equal(created.statusCode,200,created.body);
  assert.deepEqual(f.calls[1],{actor,action:'create',project,item:null,
    data:{...data,name:'App'}});
  const update=await app.inject({method:'PATCH',url:'/api/projects/'+project+'/applications/'+item,
   headers,payload:{...data,version:2}});
  assert.equal(update.statusCode,200);
  assert.equal(f.calls[2]?.action,'update');
  assert.equal(f.calls[2]?.item,item);
 }finally{await app.close();}
});
test('insecure, credential-bearing, query and fragment URLs are rejected',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectApps:f.store});
 try{
  for(const url of ['http://example.invalid','https://u:p@example.com/repo',
     'https://example.com/repo?token=x','https://example.com/repo#token',
     'javascript:alert(1)']){
   const result=await app.inject({method:'POST',url:'/api/projects/'+project+'/applications',
    headers,payload:{...data,repositoryUrl:url}});
   assert.equal(result.statusCode,400,url);
  }
  assert.equal(f.calls.length,0);
 }finally{await app.close();}
});
test('SQL tenant denial and version conflict remain authoritative',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectApps:f.store});
 try{
  f.store.command=async()=>{throw new RpcError('42501');};
  const forbidden=await app.inject({method:'PATCH',url:'/api/projects/'+project+'/applications/'+item,
   headers,payload:{...data,version:2}});
  assert.equal(forbidden.statusCode,403);
  f.store.command=async()=>{throw new RpcError('40001');};
  const stale=await app.inject({method:'PATCH',url:'/api/projects/'+project+'/applications/'+item,
   headers,payload:{...data,version:2}});
  assert.equal(stale.statusCode,409);
 }finally{await app.close();}
});
