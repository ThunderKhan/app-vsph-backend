import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {ProviderPasswordRejected,type CredentialStore} from '../src/modules/credentials/store.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';

const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const enrollmentId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const raw='A'.repeat(43);
const headers={origin:env.PUBLIC_ORIGIN,cookie:'vsph.employee.setup='+raw};
const payload={password:'strong-personal-password',confirmed:true};
function fixture(factors:Array<{status:string}>=[]) {
 const steps:string[]=[];
 const store:CredentialStore={
  status:async hash=>{steps.push('status');assert.equal(hash,hashSessionToken(raw));return {confirmed:true};},
  reserve:async hash=>{steps.push('reserve');assert.equal(hash,hashSessionToken(raw));
    return {id,userId,email:'test@example.invalid',enrollmentId,assurance:'aal1'};},
  getIdentity:async()=>{steps.push('identity');return {id:userId,email:'test@example.invalid',
    email_confirmed_at:'2026-11-23T01:00:00Z',
    app_metadata:{vsph_employee_enrollment:enrollmentId},factors};},
  updatePassword:async()=>{steps.push('provider');},
  finish:async()=>{steps.push('finish');},
  reject:async()=>{steps.push('reject');},
  failed:async()=>{steps.push('failed');},
 };
 return {store,steps};
}
test('setup status rejects missing cookie and hashes valid proof',async()=>{
 const f=fixture(),app=buildApp(env,{credentials:f.store});
 try{
  const missing=await app.inject({method:'GET',url:'/api/employee-credentials/status'});
  assert.equal(missing.statusCode,401);assert.deepEqual(f.steps,[]);
  const ok=await app.inject({method:'GET',url:'/api/employee-credentials/status',
    headers:{cookie:headers.cookie}});
  assert.equal(ok.statusCode,200);assert.deepEqual(f.steps,['status']);
 }finally{await app.close();}
});
test('replacement validates proof and finishes only after bound provider update',async()=>{
 const f=fixture(),app=buildApp(env,{credentials:f.store});
 try{
  const invalid=await app.inject({method:'POST',url:'/api/employee-credentials/replace',
   headers,payload:{password:'short',confirmed:true}});
  assert.equal(invalid.statusCode,400);assert.deepEqual(f.steps,[]);
  const ok=await app.inject({method:'POST',url:'/api/employee-credentials/replace',headers,payload});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.steps,['reserve','identity','provider','finish']);
  assert.match(String(ok.headers['set-cookie']),/vsph\.employee\.setup=;.*Max-Age=0/);
 }finally{await app.close();}
});
test('new factor requires reauthentication, never updates password',async()=>{
 const f=fixture([{status:'verified'}]),app=buildApp(env,{credentials:f.store});
 try{
  const blocked=await app.inject({method:'POST',url:'/api/employee-credentials/replace',headers,payload});
  assert.equal(blocked.statusCode,401);assert.equal(blocked.json().code,'IDENTITY_STEP_UP_REQUIRED');
  assert.deepEqual(f.steps,['reserve','identity','reject']);
 }finally{await app.close();}
});
test('password rejection returns safe response after rejecting reservation',async()=>{
 const f=fixture();f.store.updatePassword=async()=>{f.steps.push('provider');throw new ProviderPasswordRejected();};
 const app=buildApp(env,{credentials:f.store});
 try{
  const rejected=await app.inject({method:'POST',url:'/api/employee-credentials/replace',headers,payload});
  assert.equal(rejected.statusCode,400);assert.equal(rejected.json().code,'PASSWORD_REJECTED');
  assert.deepEqual(f.steps,['reserve','identity','provider','reject']);
 }finally{await app.close();}
});
test('unavailable provider transitions to failed without issuing cookie',async()=>{
 const f=fixture();f.store.updatePassword=async()=>{f.steps.push('provider');throw Error('down');};
 const app=buildApp(env,{credentials:f.store});
 try{
  const failed=await app.inject({method:'POST',url:'/api/employee-credentials/replace',headers,payload});
  assert.equal(failed.statusCode,503);assert.equal(failed.json().code,'CREDENTIAL_RECOVERY_REQUIRED');
  assert.equal(failed.headers['set-cookie'],undefined);
  assert.deepEqual(f.steps,['reserve','identity','provider','failed']);
 }finally{await app.close();}
});
test('missing schema cannot trigger provider update',async()=>{
 const f=fixture();f.store.reserve=async()=>{f.steps.push('reserve');throw new RpcError('PGRST202');};
 const app=buildApp(env,{credentials:f.store});
 try{
  const result=await app.inject({method:'POST',url:'/api/employee-credentials/replace',headers,payload});
  assert.equal(result.statusCode,503);assert.equal(result.json().code,'SCHEMA_NOT_READY');
  assert.deepEqual(f.steps,['reserve']);
 }finally{await app.close();}
});
