import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {ManagerEnrollmentStore} from '../src/modules/employee-enrollment/manager-store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const employee='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const enrollment='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const token='A'.repeat(43),hash=hashSessionToken(token);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+token,'idempotency-key':key};
const body={rosterVersion:2,confirmed:true};
function fixture(replayed=false){
 const calls:Array<{action:string;actor?:string;id?:string;data?:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'HR',email:'hr@example.invalid',status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,
  portalSession:async input=>input===hash?{token_hash:hash,user_id:actor,
    expires_at:'2099-11-23T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
  revokeAppByToken:async()=>{},
 };
 const manager:ManagerEnrollmentStore={
  deliveryAccess:async who=>{calls.push({action:'access',actor:who});},
  review:async(who,sessionHash,id)=>{calls.push({action:'review',actor:who,id,data:{sessionHash}});
    return {available:true,enrollment:null};},
  command:async(who,action,id,data)=>{
   calls.push({action,actor:who,id,data});
   if(action==='start'||action==='renew'){
     if(replayed)return {id:enrollment,replayed:true};
     return {id:enrollment,authUserId:employee,email:'employee@example.invalid',version:3};
   }
   return {saved:true};
  },
  provision:async record=>{
   calls.push({action:'provider',id:record.id});
   assert.equal(record.authUserId,employee);
  },
 };
 return {auth,manager,calls};
}
test('enrollment manager actions require verified portal before any RPC',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},managedEnrollment:f.manager});
 try{
  const response=await app.inject({method:'GET',url:'/api/employee-enrollment/delivery'});
  assert.equal(response.statusCode,401);
  const denied=await app.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
    headers:{origin:env.PUBLIC_ORIGIN,'idempotency-key':key},payload:body});
  assert.equal(denied.statusCode,401);
  assert.deepEqual(f.calls,[]);
 }finally{await app.close();}
});
test('review, delivery, cancellation pass immutable actor and hash into SQL',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},managedEnrollment:f.manager});
 try{
  const delivery=await app.inject({method:'GET',url:'/api/employee-enrollment/delivery',
   headers:{cookie:headers.cookie}});
  assert.equal(delivery.statusCode,200);assert.equal(delivery.json().emailConfigured,false);
  const review=await app.inject({method:'GET',url:'/api/employee-enrollment/employees/'+employee,
   headers:{cookie:headers.cookie}});
  assert.equal(review.statusCode,200);
  assert.equal(review.json().emailDeliveryAvailable,false);
  const cancel=await app.inject({method:'POST',url:'/api/employee-enrollment/'+enrollment+'/cancel',
    headers,payload:{rosterVersion:2,version:3,confirmed:true}});
  assert.equal(cancel.statusCode,200);
  assert.deepEqual(f.calls.slice(0,3),[
   {action:'access',actor},
   {action:'review',actor,id:employee,data:{sessionHash:hash}},
   {action:'cancel',actor,id:enrollment,data:{rosterVersion:2,version:3,confirmed:true,currentHash:hash}},
  ]);
 }finally{await app.close();}
});
test('new invitation issued only after SQL start+provider+ready, never email claims',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},managedEnrollment:f.manager});
 try{
  const response=await app.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
   headers,payload:body});
  assert.equal(response.statusCode,200,response.body);
  const dto=response.json();
  assert.equal(dto.delivery,'private_manual_handoff');
  assert.equal(dto.id,enrollment);
  assert.equal(dto.version,4);
  const url=new URL(dto.url);
  assert.equal(url.pathname,'/employee-enrollment');
  assert.equal(url.hash.startsWith('#enrollment_id='+enrollment),true);
  assert.equal(f.calls.map(x=>x.action).join(','),'start,provider,ready');
  assert.equal(f.calls[0]?.data?.currentHash,hash);
  assert.equal(f.calls[0]?.data?.key,key);
  assert.match(String(f.calls[0]?.data?.tokenHash),/^[a-f0-9]{64}$/);
 }finally{await app.close();}
});
test('duplicate idempotency request never reveals or resends private invitation',async()=>{
 const f=fixture(true),app=buildApp(env,{auth:{store:f.auth},managedEnrollment:f.manager});
 try{
  const response=await app.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
   headers,payload:body});
  assert.equal(response.statusCode,200,response.body);
  const dto=response.json();assert.equal(dto.replayed,true);assert.equal(dto.url,undefined);
  assert.deepEqual(f.calls.map(x=>x.action),['start']);
 }finally{await app.close();}
});
test('explicit email mode and invalid version fail before SQL, never simulate delivery',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},managedEnrollment:f.manager});
 try{
  const email=await app.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
   headers,payload:{...body,delivery:'email'}});
  assert.equal(email.statusCode,503);assert.equal(email.json().code,'EMAIL_NOT_CONFIGURED');
  const invalid=await app.inject({method:'POST',url:'/api/employee-enrollment/'+enrollment+'/renew',
   headers,payload:{...body,version:0}});
  assert.equal(invalid.statusCode,400);
  assert.equal(f.calls.length,0);
 }finally{await app.close();}
});
test('revoked manager and ambiguous provider error cannot mint a usable link',async()=>{
 const denied=fixture();denied.manager.command=async()=>{throw new RpcError('42501');};
 const app=buildApp(env,{auth:{store:denied.auth},managedEnrollment:denied.manager});
 try{
  const response=await app.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
   headers,payload:body});
  assert.equal(response.statusCode,403);
  assert.deepEqual(denied.calls,[]);
 }finally{await app.close();}
 const unknown=fixture();unknown.manager.provision=async()=>{throw Error('provider down');};
 const recovery=buildApp(env,{auth:{store:unknown.auth},managedEnrollment:unknown.manager});
 try{
  const blocked=await recovery.inject({method:'POST',url:'/api/employee-enrollment/employees/'+employee,
   headers,payload:body});
  assert.equal(blocked.statusCode,503);
  assert.equal(blocked.headers['set-cookie'],undefined);
  assert.deepEqual(unknown.calls.map(x=>x.action),['start']);
 }finally{await recovery.close();}
});
