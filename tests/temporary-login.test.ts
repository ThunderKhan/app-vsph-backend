import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import type {AuthStore} from '../src/modules/auth/store.js';

const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function appFor(metadata:Record<string,unknown>|undefined, allow=true) {
  let temporaryCalls=0,normalPortals=0;
  const store:AuthStore={
    activeProfile:async()=>null,portalSession:async()=>null,
    createPortal:async()=>{normalPortals++;},revokePortal:async()=>{},
    temporaryLogin:async()=>{temporaryCalls++;return allow;},
    temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
    listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
    createAppSession:async()=>{},appSession:async()=>null,revokeAppSession:async()=>{},
    revokeAppByToken:async()=>{},
  };
  const app=buildApp(env,{auth:{store,verify:async()=>({
    user:{id:userId,email:'test@example.invalid',app_metadata:metadata},assurance:'aal1',
  })}});
  return {app,getCalls:()=>({temporaryCalls,normalPortals})};
}
test('verified provider enrollment creates ONLY 10 minute setup session',async()=>{
  const f=appFor({vsph_employee_enrollment:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
  try{
    const result=await f.app.inject({method:'POST',url:'/api/auth/login',
      headers:{origin:env.PUBLIC_ORIGIN},
      payload:{email:'test@example.invalid',password:'temporary-test-secret'}});
    assert.equal(result.statusCode,200,result.body);
    assert.deepEqual(result.json(),{passwordChangeRequired:true,redirect:'/employee-password'});
    assert.match(String(result.headers['set-cookie']),/vsph\.employee\.setup=[A-Za-z0-9_-]{43};/);
    assert.match(String(result.headers['set-cookie']),/Max-Age=600/);
    assert.deepEqual(f.getCalls(),{temporaryCalls:1,normalPortals:0});
  }finally{await f.app.close();}
});
test('no provider enrollment or revoked SQL eligibility cannot mint temporary session',async()=>{
 for(const f of [appFor(undefined),appFor({vsph_employee_enrollment:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},false)]) {
  try{
    const result=await f.app.inject({method:'POST',url:'/api/auth/login',
      headers:{origin:env.PUBLIC_ORIGIN},payload:{email:'test@example.invalid',password:'temp-test'}});
    assert.equal(result.statusCode,403);
    assert.equal(result.headers['set-cookie'],undefined);
    assert.equal(f.getCalls().normalPortals,0);
  }finally{await f.app.close();}
 }
});
