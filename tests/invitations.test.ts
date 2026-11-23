import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import type {InvitationStore} from '../src/modules/invitations/store.js';
import type {AuthStore} from '../src/modules/auth/store.js';

const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const invitationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload={invitationId,token:'A'.repeat(43)},headers={origin:env.PUBLIC_ORIGIN};
function fake(newIdentity:boolean) {
 const calls:string[]=[];
 let reserved=false,accepted=false;
 const invitations:InvitationStore={
  inspect:async()=>{calls.push('inspect');if(accepted)throw Error('already accepted');return {newIdentity};},
  reserve:async()=>{calls.push('reserve');if(reserved)throw Error('already reserved');
    reserved=true;return {newIdentity,userId};},
  setNewIdentityPassword:async()=>{calls.push('provider');},
  finish:async()=>{calls.push('finish');accepted=true;},
  markFailed:async()=>{calls.push('failed');reserved=false;},
 };
 const auth:AuthStore={
  activeProfile:async()=>null,portalSession:async()=>null,createPortal:async()=>{},
  revokePortal:async()=>{},temporaryLogout:async()=>{},temporaryLogin:async()=>false,appByCode:async()=>null,
  contexts:async()=>[],listedApps:async()=>[],listRecords:async()=>[],
  sessionCommand:async()=>null,createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 return {invitations,auth,calls};
}
test('anonymous inspection validates strictly and never stores raw invitation proof',async()=>{
 const fakeStore=fake(true);
 const app=buildApp(env,{auth:{store:fakeStore.auth},invitations:fakeStore.invitations});
 try{
  const invalid=await app.inject({method:'POST',url:'/api/invitations/inspect',
    headers,payload:{...payload,token:'bad'}});
  assert.equal(invalid.statusCode,400);assert.deepEqual(fakeStore.calls,[]);
  const good=await app.inject({method:'POST',url:'/api/invitations/inspect',headers,payload});
  assert.equal(good.statusCode,200,good.body);
  assert.deepEqual(good.json(),{newIdentity:true});
  assert.deepEqual(fakeStore.calls,['inspect']);
 }finally{await app.close();}
});
test('new identity accept reserves before provider and finish, with replay denied',async()=>{
 const f=fake(true),app=buildApp(env,{auth:{store:f.auth},invitations:f.invitations});
 try{
  const invalid=await app.inject({method:'POST',url:'/api/invitations/accept',
    headers,payload:{...payload,password:'weak'}});
  assert.equal(invalid.statusCode,400);
  const success=await app.inject({method:'POST',url:'/api/invitations/accept',
    headers,payload:{...payload,password:'strong-enough-password'}});
  assert.equal(success.statusCode,200,success.body);
  assert.equal(success.json().message,'Invitation accepted for this customer workspace. Sign in to continue.');
  assert.deepEqual(f.calls,['inspect','reserve','provider','finish']);
  const replay=await app.inject({method:'POST',url:'/api/invitations/accept',
    headers,payload:{...payload,password:'strong-enough-password'}});
  assert.equal(replay.statusCode,503);
  assert.equal(f.calls.filter(x=>x==='provider').length,1);
 }finally{await app.close();}
});
test('provider failure invokes durable failed action, never success',async()=>{
 const f=fake(true);
 f.invitations.setNewIdentityPassword=async()=>{f.calls.push('provider-fail');throw Error('provider down');};
 const app=buildApp(env,{auth:{store:f.auth},invitations:f.invitations});
 try{
  const failed=await app.inject({method:'POST',url:'/api/invitations/accept',
    headers,payload:{...payload,password:'strong-enough-password'}});
  assert.equal(failed.statusCode,503);assert.deepEqual(f.calls,['inspect','reserve','provider-fail','failed']);
 }finally{await app.close();}
});
test('existing identities cannot have their passwords replaced through acceptance',async()=>{
 const f=fake(false);
 f.invitations.setNewIdentityPassword=async()=>{throw Error('existing account changed');};
 const app=buildApp(env,{auth:{store:f.auth},invitations:f.invitations});
 try{
  const ok=await app.inject({method:'POST',url:'/api/invitations/accept',headers,payload});
  assert.equal(ok.statusCode,200,ok.body);
  assert.deepEqual(f.calls,['inspect','reserve','finish']);
 }finally{await app.close();}
});
test('cross-origin acceptance cannot reach SQL or provider',async()=>{
 const f=fake(true),app=buildApp(env,{auth:{store:f.auth},invitations:f.invitations});
 try{
  const blocked=await app.inject({method:'POST',url:'/api/invitations/accept',
    headers:{origin:'https://attacker.invalid'},payload:{...payload,password:'strong-enough-password'}});
  assert.equal(blocked.statusCode,403);assert.deepEqual(f.calls,[]);
 }finally{await app.close();}
});
