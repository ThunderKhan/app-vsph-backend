import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {PortalReadStore} from '../src/modules/read/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cookie='A'.repeat(43),hash=hashSessionToken(cookie);
function fixture(role:string|null='super_admin'){
 const events:Array<{action:string;args:unknown[]}>=[];
 const profile={id:actor,full_name:'Test',email:'test@example.invalid',status:'active',platform_role:role};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
    token_hash:hash,user_id:actor,expires_at:'2099-11-23T00:00:00Z',profile,
  }:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const record=(action:string,args:unknown[])=>{events.push({action,args});return {ok:true};};
 const reads:PortalReadStore={
  project:async(...args)=>record('project',args),
  managerOverview:async(...args)=>record('overview',args),
  search:async(...args)=>record('search',args),
  hrAccess:async(...args)=>record('hr',args),
  financeDashboard:async(...args)=>{events.push({action:'finance',args});
    return {summary:{invoicedPaise:123,unexpectedPrivateName:'do not include'},
     monthly:[{month_start:'2026-11-01',collected_paise:25,secret:'ignored'}],
     asOf:'2026-11-23',currency:'INR',basis:'integer_paise'};},
 };
 return {auth,reads,events};
}
test('no portal cookie cannot query SQL RPCs',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},reads:f.reads});
 try{
  for(const url of ['/api/projects','/api/hrms/access','/api/search?q=alpha','/api/finance']){
   const response=await app.inject({method:'GET',url});
   assert.equal(response.statusCode,401,url);
  }
  assert.deepEqual(f.events,[]);
 }finally{await app.close();}
});
test('SQL actor and current session hash come from verified portal, not user input',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},reads:f.reads});
 const headers={cookie:'vsph.portal.sid='+cookie};
 try{
  const list=await app.inject({method:'GET',url:'/api/projects?q=mywork',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.deepEqual(f.events[0],{action:'project',
    args:[actor,'list',null,{q:'mywork',status:'',cursor:null}]});
  const detail=await app.inject({method:'GET',url:'/api/projects/'+project,headers});
  assert.equal(detail.statusCode,200);
  assert.deepEqual(f.events[1],{action:'project',args:[actor,'detail',project,{}]});
  const hr=await app.inject({method:'GET',url:'/api/hrms/access',headers});
  assert.equal(hr.statusCode,200);
  assert.deepEqual(f.events[2],{action:'hr',args:[actor,hash]});
  const wrong=await app.inject({method:'GET',url:'/api/projects?actor=evil',headers});
  assert.equal(wrong.statusCode,400);assert.equal(f.events.length,3);
 }finally{await app.close();}
});
test('finance overview is owner-only, copies no private transaction fields',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},reads:f.reads});
 const headers={cookie:'vsph.portal.sid='+cookie};
 try{
  const response=await app.inject({method:'GET',url:'/api/finance/overview',headers});
  assert.equal(response.statusCode,200);
  const dto=response.json();
  assert.equal(dto.summary.invoicedPaise,123);
  assert.equal(dto.summary.unexpectedPrivateName,undefined);
  assert.equal(dto.monthly[0].secret,undefined);
 }finally{await app.close();}
 const employee=fixture('employee'),restricted=buildApp(env,{auth:{store:employee.auth},reads:employee.reads});
 try{
  const denied=await restricted.inject({method:'GET',url:'/api/finance',
    headers:{cookie:'vsph.portal.sid='+cookie}});
  assert.equal(denied.statusCode,403);
  assert.deepEqual(employee.events,[]);
 }finally{await restricted.close();}
});
test('search validates filters and refuses actor-supplied tenant bypass',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},reads:f.reads});
 const headers={cookie:'vsph.portal.sid='+cookie};
 try{
  const invalid=await app.inject({method:'GET',url:'/api/search?q=x',headers});
  assert.equal(invalid.statusCode,400);
  const forged=await app.inject({method:'GET',url:'/api/search?q=hello&actor=other',headers});
  assert.equal(forged.statusCode,400);
  assert.deepEqual(f.events,[]);
  const good=await app.inject({method:'GET',url:'/api/search?q=hello&kind=task&projectId='+project,headers});
  assert.equal(good.statusCode,200);
  assert.deepEqual(f.events[0],{action:'search',args:[actor,project,{q:'hello',kind:'task'}]});
 }finally{await app.close();}
});
test('SQL denied project is 403, not a fabricated successful empty object',async()=>{
 const f=fixture();f.reads.project=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},reads:f.reads});
 try{
  const result=await app.inject({method:'GET',url:'/api/projects/'+project,
   headers:{cookie:'vsph.portal.sid='+cookie}});
  assert.equal(result.statusCode,403);
  assert.equal(result.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
