import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ProjectWorkspaceStore} from '../src/modules/project-workspace/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const entity='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw};
function fixture(){
 const events:Array<{actor:string;action:string;id:string;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Contributor',email:'contributor@example.invalid',
  platform_role:'user',status:'active'};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],listedApps:async()=>[],
  listRecords:async()=>[],sessionCommand:async()=>null,createAppSession:async()=>{},
  appSession:async()=>null,revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const workspace:ProjectWorkspaceStore={
  command:async(who,action,id,data)=>{
   events.push({actor:who,action,id,data});return {saved:true};
  },
 };
 return {auth,workspace,events};
}
test('workspace requires current portal and uses path-derived tenant/project identity',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWorkspace:f.workspace});
 try{
  const anonymous=await app.inject({method:'GET',url:'/api/projects/'+project+'/workspace'});
  assert.equal(anonymous.statusCode,401);
  const read=await app.inject({method:'GET',url:'/api/projects/'+project+'/workspace',
    headers:{cookie:headers.cookie}});
  assert.equal(read.statusCode,200);
  assert.deepEqual(f.events,[{actor,action:'list',id:project,data:{}}]);
  const bad=await app.inject({method:'GET',url:'/api/projects/'+project+'/workspace?actor=other',
    headers:{cookie:headers.cookie}});
  assert.equal(bad.statusCode,400);assert.equal(f.events.length,1);
 }finally{await app.close();}
});
test('checklist, risk and weekly update dispatch original SQL action names',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWorkspace:f.workspace});
 try{
  const add=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/checklist-add',
   headers,payload:{version:2,milestoneId:entity,title:'Review PR',assigneeId:actor}});
  assert.equal(add.statusCode,200,add.body);
  assert.equal(f.events[0]?.action,'checklist.add');
  const risk=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/risk-resolve',
   headers,payload:{version:2,id:entity,resolved:true}});
  assert.equal(risk.statusCode,200);assert.equal(f.events[1]?.action,'risk.resolve');
  const update=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/update-publish',
   headers,payload:{version:2,summary:'Beta delivered to staging',health:'on_track',
    nextSteps:'QA',shared:false}});
  assert.equal(update.statusCode,200);assert.equal(f.events[2]?.action,'update.publish');
 }finally{await app.close();}
});
test('rejects invalid UUID, insecure links, unapproved action and client-supplied actor',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectWorkspace:f.workspace});
 try{
  const badId=await app.inject({method:'POST',url:'/api/projects/not-a-uuid/workspace/checklist-add',
   headers,payload:{version:2,milestoneId:entity,title:'Review PR',assigneeId:null}});
  assert.equal(badId.statusCode,400);
  const badUrl=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/resource-add',
   headers,payload:{version:2,label:'Private secret',url:'http://insecure.invalid',
    category:'document',shared:false}});
  assert.equal(badUrl.statusCode,400);
  const elevated=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/risk-resolve',
   headers,payload:{version:2,id:entity,resolved:true,actor:'evil'}});
  assert.equal(elevated.statusCode,400);
  const wrong=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/superuser',
   headers,payload:{version:2}});
  assert.equal(wrong.statusCode,400);assert.deepEqual(f.events,[]);
 }finally{await app.close();}
});
test('SQL tenant and version boundaries propagate into explicit errors',async()=>{
 const f=fixture();f.workspace.command=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},projectWorkspace:f.workspace});
 try{
  const denied=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/risk-add',
   headers,payload:{version:2,title:'Unassigned security risk',severity:'high'}});
  assert.equal(denied.statusCode,403);assert.equal(denied.json().code,'ACCESS_DENIED');
  f.workspace.command=async()=>{throw new RpcError('40001');};
  const stale=await app.inject({method:'POST',url:'/api/projects/'+project+'/workspace/risk-add',
   headers,payload:{version:2,title:'Unassigned security risk',severity:'high'}});
  assert.equal(stale.statusCode,409);assert.equal(stale.json().code,'CONFLICT');
 }finally{await app.close();}
});
