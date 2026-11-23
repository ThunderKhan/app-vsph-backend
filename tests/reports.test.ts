import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import {projectCsv} from '../src/modules/reports/csv.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ProjectReportStore} from '../src/modules/reports/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const cookie={cookie:'vsph.portal.sid='+raw};
function fixture(){
 const calls:Array<{actor:string;projectId:string|null;filters:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Manager',email:'manager@example.invalid',
  status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,temporaryLogout:async()=>{},
  appByCode:async()=>null,contexts:async()=>[],listedApps:async()=>[],listRecords:async()=>[],
  sessionCommand:async()=>null,createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const reports:ProjectReportStore={list:async(user,id,filters)=>{
  calls.push({actor:user,projectId:id,filters});
  return {generatedAt:'2026-11-23T00:00:00Z',deploymentStatus:'unverified',
   projects:[{id:project,key:'P-101',name:'Normal project'}]};
 }};
 return {auth,reports,calls};
}
test('reporting requires portal and no tenant/actor injection into SQL',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},reports:f.reports});
 try{
  const anonymous=await app.inject({method:'GET',url:'/api/project-reports'});
  assert.equal(anonymous.statusCode,401);
  const forged=await app.inject({method:'GET',url:'/api/project-reports?actor=someone',
   headers:cookie});
  assert.equal(forged.statusCode,400);
  const good=await app.inject({method:'GET',url:'/api/project-reports?projectId='+project+
   '&status=active',headers:cookie});
  assert.equal(good.statusCode,200);
  assert.deepEqual(f.calls,[{actor,projectId:project,filters:{status:'active'}}]);
 }finally{await app.close();}
});
test('CSV scope remains capped and client-controlled spreadsheet formulas are escaped',()=>{
 const csv=projectCsv({generatedAt:'2026-11-23',deploymentStatus:'unverified',
  projects:[{id:project,name:' =HYPERLINK("evil")',key:'\t+SUM(1,1)',
   owner_name:'"Quoted" name',privatePassword:'must not export'}]});
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/' =HYPERLINK/);
 assert.match(csv,/'\t\+SUM/);
 assert.match(csv,/'""Quoted"" name/);
 assert.doesNotMatch(csv,/must not export/);
 assert.throws(()=>projectCsv({projects:Array.from({length:101},()=>({id:project}))}));
});
test('authorized CSV API returns immutable allowlist, no privileged raw fields',async()=>{
 const f=fixture();
 f.reports.list=async()=>({generatedAt:'2026-11-23',deploymentStatus:'unverified',
  projects:[{id:project,key:'PR-1',name:'Review',privatePassword:'s3cr3t'}]});
 const app=buildApp(env,{auth:{store:f.auth},reports:f.reports});
 try{
  const response=await app.inject({method:'GET',url:'/api/project-reports/export.csv',headers:cookie});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['x-vsph-export-scope'],'first-100-authorized-matching-projects');
  assert.match(String(response.headers['content-type']),/text\/csv/);
  assert.doesNotMatch(response.body,/s3cr3t/);
 }finally{await app.close();}
});
test('SQL tenant denial is a 403, never an empty report',async()=>{
 const f=fixture();f.reports.list=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:f.auth},reports:f.reports});
 try{
  const response=await app.inject({method:'GET',url:'/api/project-reports',headers:cookie});
  assert.equal(response.statusCode,403);
  assert.equal(response.json().code,'ACCESS_DENIED');
 }finally{await app.close();}
});
