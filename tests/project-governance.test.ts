import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ProjectGovernanceStore} from '../src/modules/project-governance/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const target='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw};
function fixture(){
 const calls:Array<{name:string;actor:string;action:string;id:string;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Manager',email:'manager@example.invalid',
  status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,
  portalSession:async token=>token===hash?{token_hash:hash,user_id:actor,
   expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const governance:ProjectGovernanceStore={
  workforce:async(who,action,id,data)=>{
   calls.push({name:'workforce',actor:who,action,id,data});return {saved:true};
  },
  lifecycle:async(who,action,id,data)=>{
   calls.push({name:'lifecycle',actor:who,action,id,data});return {saved:true};
  },
  clientMember:async(who,id,data)=>{
   calls.push({name:'clientMember',actor:who,action:'member.save',id,data});return {saved:true};
  },
 };
 return {auth,governance,calls};
}
test('project workforce requires portal session and rejects arbitrary action/extra fields',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectGovernance:f.governance});
 try{
  const anonymous=await app.inject({method:'GET',url:'/api/projects/'+project+'/workforce'});
  assert.equal(anonymous.statusCode,401);
  const missing=await app.inject({method:'POST',url:'/api/projects/'+project+'/workforce/elevate',
   headers,payload:{version:2,userId:target}});
  assert.equal(missing.statusCode,400);
  const invalid=await app.inject({method:'POST',url:'/api/projects/'+project+'/workforce/assign',
   headers,payload:{version:2,userId:target,role:'manager',team:'Core',organizationId:actor}});
  assert.equal(invalid.statusCode,400);assert.deepEqual(f.calls,[]);
 }finally{await app.close();}
});
test('role and tenant are SQL-authoritative; action mapping cannot grant owner role',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectGovernance:f.governance});
 try{
  const bad=await app.inject({method:'POST',url:'/api/projects/'+project+'/workforce/assign',
   headers,payload:{version:2,userId:target,role:'owner',team:'Core'}});
  assert.equal(bad.statusCode,400);assert.equal(f.calls.length,0);
  const ok=await app.inject({method:'POST',url:'/api/projects/'+project+'/workforce/manager-grant',
   headers,payload:{version:2,userId:target}});
  assert.equal(ok.statusCode,200);
  assert.deepEqual(f.calls,[{name:'workforce',actor,action:'manager.grant',id:project,
    data:{version:2,userId:target}}]);
 }finally{await app.close();}
});
test('project member revocation delegates workforce, customer member delegates project command',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectGovernance:f.governance});
 try{
  const remove=await app.inject({method:'POST',url:'/api/projects/'+project+'/members',headers,
    payload:{version:2,userId:target,role:'contributor',status:'revoked'}});
  assert.equal(remove.statusCode,200);
  assert.deepEqual(f.calls[0],{name:'workforce',actor,action:'remove',id:project,
    data:{version:2,userId:target}});
  const client=await app.inject({method:'POST',url:'/api/projects/'+project+'/members',headers,
   payload:{version:2,userId:target,role:'client',status:'active',team:'Client'}});
  assert.equal(client.statusCode,200);
  assert.deepEqual(f.calls[1],{name:'clientMember',actor,action:'member.save',id:project,
   data:{version:2,userId:target,role:'client',status:'active',team:'Client'}});
 }finally{await app.close();}
});
test('archive/delete guard requires version, correct project key and explicit confirmation',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},projectGovernance:f.governance});
 try{
  const bad=await app.inject({method:'POST',url:'/api/projects/'+project+'/lifecycle/delete',
   headers,payload:{version:2,key:'ABC-123',confirmed:false}});
  assert.equal(bad.statusCode,400);assert.equal(f.calls.length,0);
  const good=await app.inject({method:'POST',url:'/api/projects/'+project+'/lifecycle/archive',
   headers,payload:{version:2,key:'ABC-123',confirmed:true}});
  assert.equal(good.statusCode,200);
  assert.equal(f.calls[0]?.action,'archive');
 }finally{await app.close();}
});
test('SQL foreign key dependency refuses permanent deletion; revoked manager is denied',async()=>{
 const f=fixture();
 f.governance.lifecycle=async()=>{throw new RpcError('23503');};
 f.governance.workforce=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},projectGovernance:f.governance});
 try{
  const linked=await app.inject({method:'POST',url:'/api/projects/'+project+'/lifecycle/delete',
   headers,payload:{version:2,key:'ABC-123',confirmed:true}});
  assert.equal(linked.statusCode,400);
  assert.equal(linked.json().code,'PROJECT_HAS_DEPENDENCIES');
  const revoked=await app.inject({method:'POST',url:'/api/projects/'+project+'/workforce/remove',
   headers,payload:{version:2,userId:target}});
  assert.equal(revoked.statusCode,403);
  assert.equal(revoked.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
