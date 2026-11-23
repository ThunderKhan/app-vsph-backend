import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import {EnrollmentPasswordRejected,type EnrollmentStore} from '../src/modules/employee-enrollment/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const raw='A'.repeat(43),proof={id,token:raw};
const headers={origin:env.PUBLIC_ORIGIN};
const valid={...proof,password:'long-enough-test-password',confirmed:true};
function fake(){
 const steps:string[]=[];
 let reserved=false,finished=false;
 const store:EnrollmentStore={
  inspect:async(invite,hash)=>{
    steps.push('inspect');assert.equal(invite,id);assert.match(hash,/^[a-f0-9]{64}$/);
    if(finished)throw new RpcError('42501');
    return {name:'New employee',email:'invitee@example.invalid',expiresAt:'2099-01-01T00:00:00Z'};
  },
  reserve:async(invite,hash,nonce)=>{
    steps.push('reserve');assert.equal(invite,id);assert.match(hash,/^[a-f0-9]{64}$/);
    assert.match(nonce,/^[a-f0-9-]{36}$/);
    if(reserved)throw new RpcError('40001');
    reserved=true;
    return {id,authUserId:userId,email:'invitee@example.invalid'};
  },
  identity:async()=>{
    steps.push('identity');
    return {id:userId,email:'invitee@example.invalid',
      email_confirmed_at:null,app_metadata:{vsph_employee_enrollment:id},factors:[]};
  },
  setPassword:async()=>{steps.push('password');},
  finish:async()=>{steps.push('finish');finished=true;},
  reject:async()=>{steps.push('reject');reserved=false;},
  failed:async()=>{steps.push('failed');},
 };
 return {steps,store};
}
test('employee proof validation and anonymous inspect preserve exact Next.js contract',async()=>{
 const f=fake(),app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const malformed=await app.inject({method:'POST',url:'/api/employee-enrollment/inspect',
   headers,payload:{id,token:'bad'}});
  assert.equal(malformed.statusCode,400);assert.deepEqual(f.steps,[]);
  const unexpected=await app.inject({method:'POST',url:'/api/employee-enrollment/inspect',
   headers,payload:{...proof,organizationId:id}});
  assert.equal(unexpected.statusCode,400);
  const result=await app.inject({method:'POST',url:'/api/employee-enrollment/inspect',headers,payload:proof});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().name,'New employee');
  assert.equal(result.json().email,'invitee@example.invalid');
  assert.deepEqual(f.steps,['inspect']);
 }finally{await app.close();}
});
test('accepted proof reserves, verifies unconfirmed identity, updates password, finishes once',async()=>{
 const f=fake(),app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const accepted=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(accepted.statusCode,200,accepted.body);
  assert.equal(accepted.json().message,
    'Your employee account is ready. Sign in with your work email and the password you just chose.');
  assert.deepEqual(f.steps,['reserve','identity','password','finish']);
  const replay=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(replay.statusCode,409);
  assert.equal(f.steps.filter(step=>step==='password').length,1);
 }finally{await app.close();}
});
test('wrong identity or already verified factors never trigger password update',async()=>{
 const f=fake();
 f.store.identity=async()=>{f.steps.push('identity');return {id:userId,email:'other@example.invalid',
   app_metadata:{vsph_employee_enrollment:id},email_confirmed_at:null,factors:[]};};
 const app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const response=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(response.statusCode,503);
  assert.deepEqual(f.steps,['reserve','identity','failed']);
 }finally{await app.close();}
});
test('provider password rejection releases by reject, never finishes',async()=>{
 const f=fake();
 f.store.setPassword=async()=>{f.steps.push('password');throw new EnrollmentPasswordRejected();};
 const app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const res=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(res.statusCode,400);
  assert.equal(res.json().code,'PASSWORD_REJECTED');
  assert.deepEqual(f.steps,['reserve','identity','password','reject']);
 }finally{await app.close();}
});
test('ambiguous provider outage quarantines reservation, no fake 200',async()=>{
 const f=fake();f.store.setPassword=async()=>{f.steps.push('password');throw Error('provider timeout');};
 const app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const res=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(res.statusCode,503);
  assert.equal(res.json().code,'ENROLLMENT_RECOVERY_REQUIRED');
  assert.deepEqual(f.steps,['reserve','identity','password','failed']);
 }finally{await app.close();}
});
test('expired/revoked issuer SQL denial and cross-origin reject before provider',async()=>{
 const f=fake();f.store.reserve=async()=>{f.steps.push('reserve');throw new RpcError('42501');};
 const app=buildApp(env,{employeeEnrollment:f.store});
 try{
  const blocked=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',headers,payload:valid});
  assert.equal(blocked.statusCode,403);
  assert.deepEqual(f.steps,['reserve']);
  f.steps.length=0;
  const csrf=await app.inject({method:'POST',url:'/api/employee-enrollment/accept',
   headers:{origin:'https://evil.invalid'},payload:valid});
  assert.equal(csrf.statusCode,403);
  assert.deepEqual(f.steps,[]);
 }finally{await app.close();}
});
