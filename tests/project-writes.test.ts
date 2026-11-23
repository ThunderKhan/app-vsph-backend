import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ProjectWriteStore} from '../src/modules/project-write/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const item='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const org='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw};
const newProject={key:'TEST-123',name:'Example',kind:'customer',customerOrganizationId:org};
function fixture(){
 const calls:Array<{method:string;actor:string;action:string;id:string|null;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Manager',email:'manager@example.invalid',status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,
  portalSession:async token=>token===hash?{token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,temporaryLogout:async()=>{},
  appByCode:async()=>null,contexts:async()=>[],listedApps:async()=>[],listRecords:async()=>[],
  sessionCommand:async()=>null,createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const writes:ProjectWriteStore={
  command:async(who,action,id,data)=>{
   calls.push({method:'project_command',actor:who,action,id,data});
   return {id:project,version:2};
  },
  createWithManager:async(who,data)=>{
   calls.push({method:'project_creation_command',actor:who,action:'create',id:null,data});
   return {id:project,version:2};
  },
 };
 return {auth,writes,calls};
}
test('new projects never hit SQL without live portal or trusted Origin',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const anonymous=await app.inject({method:'POST',url:'/api/projects',
   headers:{origin:env.PUBLIC_ORIGIN},payload:newProject});
  assert.equal(anonymous.statusCode,401);
  const evil=await app.inject({method:'POST',url:'/api/projects',
   headers:{...headers,origin:'https://evil.invalid'},payload:newProject});
  assert.equal(evil.statusCode,403);
  assert.deepEqual(f.calls,[]);
 }finally{await app.close();}
});
test('validated project creation binds actor, preserves customer tenant, returns 201',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const created=await app.inject({method:'POST',url:'/api/projects',headers,payload:newProject});
  assert.equal(created.statusCode,201,created.body);
  assert.deepEqual(f.calls,[{method:'project_command',actor,action:'create',id:null,data:newProject}]);
  const wrong=await app.inject({method:'POST',url:'/api/projects',headers,
   payload:{...newProject,kind:'internal'}});
  assert.equal(wrong.statusCode,400);assert.equal(f.calls.length,1);
 }finally{await app.close();}
});
test('invalid product array, malicious URL, stale version and arbitrary body fields fail closed',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const badCreate=await app.inject({method:'POST',url:'/api/projects',headers,
    payload:{...newProject,products:[org,org]}});
  assert.equal(badCreate.statusCode,400);
  const badTask=await app.inject({method:'POST',url:'/api/projects/'+project+'/deliverables',headers,
    payload:{version:2,title:'Readme',url:'http://not-secure.invalid'}});
  assert.equal(badTask.statusCode,400);
  const stale=await app.inject({method:'PATCH',url:'/api/projects/'+project,headers,
    payload:{version:0,name:'New name'}});
  assert.equal(stale.statusCode,400);
  const forged=await app.inject({method:'PATCH',url:'/api/projects/'+project,headers,
    payload:{version:2,name:'Rename',actor:'other'}});
  assert.equal(forged.statusCode,400);
  assert.deepEqual(f.calls,[]);
 }finally{await app.close();}
});
test('task and milestone patch derive entity ID from path, not untrusted body',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const done=await app.inject({method:'PATCH',url:'/api/projects/'+project+'/tasks/'+item,
    headers,payload:{version:3,status:'done',id:org}});
  assert.equal(done.statusCode,200,done.body);
  assert.deepEqual(f.calls[0],{method:'project_command',actor,action:'task.update',
    id:project,data:{version:3,status:'done',id:item}});
  const milestone=await app.inject({method:'POST',url:'/api/projects/'+project+'/milestones',
    headers,payload:{version:3,title:'Ship beta'}});
  assert.equal(milestone.statusCode,200);
  assert.equal(f.calls[1]?.action,'milestone.create');
 }finally{await app.close();}
});
test('SQL tenant denial and concurrency conflict retain explicit authorization response',async()=>{
 const f=fixture();
 f.writes.command=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const denied=await app.inject({method:'POST',url:'/api/projects/'+project+'/comments',
    headers,payload:{version:2,body:'Not your project'}});
  assert.equal(denied.statusCode,403);assert.equal(denied.json().code,'ACCESS_DENIED');
  f.writes.command=async()=>{throw new RpcError('40001');};
  const stale=await app.inject({method:'PATCH',url:'/api/projects/'+project,headers,
    payload:{version:2,name:'Stale update'}});
  assert.equal(stale.statusCode,409);assert.equal(stale.json().code,'CONFLICT');
 }finally{await app.close();}
});
test('manager appointment refuses schema downgrade and preserves reviewed fallback only if null',async()=>{
 const f=fixture();f.writes.createWithManager=async()=>{throw new RpcError('PGRST202');};
 const app=buildApp(env,{auth:{store:f.auth},projectWrites:f.writes});
 try{
  const blocked=await app.inject({method:'POST',url:'/api/projects',headers,
    payload:{...newProject,managerUserId:actor}});
  assert.equal(blocked.statusCode,503);assert.equal(blocked.json().code,'SCHEMA_NOT_READY');
  assert.equal(f.calls.length,0);
  const fallback=await app.inject({method:'POST',url:'/api/projects',headers,
    payload:{...newProject,managerUserId:null}});
  assert.equal(fallback.statusCode,201,fallback.body);
  assert.deepEqual(f.calls[0]?.data,newProject);
 }finally{await app.close();}
});
