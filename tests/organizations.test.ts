import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {parseEnv} from '../src/config.js';
import {hashSessionToken} from '../src/modules/auth/session-tokens.js';
import {RpcError} from '../src/repositories/rpc-errors.js';
import type {AuthStore} from '../src/modules/auth/store.js';
import type {OrganizationStore} from '../src/modules/organizations/store.js';
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const appId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const raw='A'.repeat(43),hash=hashSessionToken(raw);
const get={cookie:'vsph.portal.sid='+raw};
const write={...get,origin:env.PUBLIC_ORIGIN};
function fixture(){
 const calls:Array<{fn:string;actor:string;action:string;id:string|null;data:Record<string,unknown>}>=[];
 const profile={id:actor,full_name:'Org owner',email:'owner@example.invalid',
  status:'active',platform_role:'user'};
 const auth:AuthStore={
  activeProfile:async()=>profile,portalSession:async token=>token===hash?{
   token_hash:hash,user_id:actor,expires_at:'2099-01-01T00:00:00Z',profile}:null,
  createPortal:async()=>{},revokePortal:async()=>{},temporaryLogin:async()=>false,
  temporaryLogout:async()=>{},appByCode:async()=>null,contexts:async()=>[],
  listedApps:async()=>[],listRecords:async()=>[],sessionCommand:async()=>null,
  createAppSession:async()=>{},appSession:async()=>null,
  revokeAppSession:async()=>{},revokeAppByToken:async()=>{},
 };
 const store:OrganizationStore={
  command:async(who,action,id,data)=>{
   calls.push({fn:'organization_command',actor:who,action,id,data});
   return {ok:true};
  },
  invitation:async(who,action,id,data)=>{
   calls.push({fn:'organization_invitation',actor:who,action,id,data});
   return {id:key,state:'queued'};
  },
 };
 return {auth,store,calls};
}
test('organization access requires a current actor and never trusts user-supplied tenant context',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},organizations:f.store});
 try{
  const anon=await app.inject({method:'GET',url:'/api/organizations/'+org});
  assert.equal(anon.statusCode,401);
  const forged=await app.inject({method:'GET',url:'/api/organizations?actor='+member,headers:get});
  assert.equal(forged.statusCode,400);
  const invalid=await app.inject({method:'GET',url:'/api/organizations/nope',headers:get});
  assert.equal(invalid.statusCode,400);
  assert.equal(f.calls.length,0);
  const list=await app.inject({method:'GET',url:'/api/organizations?afterId='+member,headers:get});
  assert.equal(list.statusCode,200,list.body);
  assert.deepEqual(f.calls[0],{fn:'organization_command',actor,
   action:'list',id:null,data:{afterId:member}});
  const members=await app.inject({method:'GET',url:'/api/organizations/'+org+'/members',headers:get});
  assert.equal(members.statusCode,200,members.body);
  assert.deepEqual(f.calls[1],{fn:'organization_command',actor,
   action:'members',id:org,data:{}});
 }finally{await app.close();}
});
test('versioned organization mutations require confirmation and trusted origin',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},organizations:f.store});
 try{
  const update=await app.inject({method:'POST',url:'/api/organizations/'+org+'/profile',
   headers:write,payload:{version:4,name:'  Example organization  '}});
  assert.equal(update.statusCode,200,update.body);
  assert.deepEqual(f.calls[0]?.data,{version:4,name:'Example organization'});
  for(const body of [{version:1,userId:member,role:'admin',status:'active'},
   {version:1,userId:member,role:'owner',status:'active',confirmed:true},
   {version:1,userId:member,role:'admin',status:'active',confirmed:true,actor:member}]){
   const denied=await app.inject({method:'POST',url:'/api/organizations/'+org+'/member',
    headers:write,payload:body});
   assert.equal(denied.statusCode,400,denied.body);
  }
  const valid=await app.inject({method:'POST',url:'/api/organizations/'+org+'/role',
   headers:write,payload:{version:3,userId:member,applicationId:appId,role:'viewer',confirmed:true}});
  assert.equal(valid.statusCode,200,valid.body);
  assert.equal(f.calls[1]?.action,'role');
  const csrf=await app.inject({method:'POST',url:'/api/organizations/'+org+'/profile',
   headers:{...write,origin:'https://evil.invalid'},payload:{version:4,name:'Example'}});
  assert.equal(csrf.statusCode,403);
  assert.equal(f.calls.length,2);
 }finally{await app.close();}
});
test('delegated invitation queue requires explicit product roles and durable UUID key',async()=>{
 const f=fixture(),app=buildApp(env,{auth:{store:f.auth},organizations:f.store});
 const payload={name:'  Invitee  ',email:'  EXAMPLE@example.invalid ',
  memberRole:'member',products:[{applicationId:appId,role:'user'}]};
 try{
  const withoutKey=await app.inject({method:'POST',url:'/api/organizations/'+org+'/invitations',
   headers:write,payload});
  assert.equal(withoutKey.statusCode,400);
  const escalated=await app.inject({method:'POST',url:'/api/organizations/'+org+'/invitations',
   headers:{...write,'idempotency-key':key},payload:{...payload,
    products:[{applicationId:appId,role:'super_admin'}]}});
  assert.equal(escalated.statusCode,400);
  assert.equal(f.calls.length,0);
  const queued=await app.inject({method:'POST',url:'/api/organizations/'+org+'/invitations',
   headers:{...write,'idempotency-key':key},payload});
  assert.equal(queued.statusCode,202,queued.body);
  assert.match(queued.json().message,/not confirmed/);
  assert.deepEqual(f.calls[0],{fn:'organization_invitation',actor,
   action:'queue',id:org,data:{key,request:{kind:'member',organizationId:org,
    adminName:'Invitee',adminEmail:'example@example.invalid',memberRole:'member',
    products:payload.products,delegated:true}}});
  const reissue=await app.inject({method:'POST',url:'/api/organizations/'+org+
   '/invitations/'+member+'/reissue',headers:write,
   payload:{generation:2,confirmed:true}});
  assert.equal(reissue.statusCode,200);
  assert.equal(f.calls[1]?.action,'reissue');
 }finally{await app.close();}
});
test('SQL revocation and role hierarchy denials are never treated as success',async()=>{
 const f=fixture();f.store.command=async()=>{throw new RpcError('42501');};
 f.store.invitation=async()=>{throw new RpcError('40001');};
 const app=buildApp(env,{auth:{store:f.auth},organizations:f.store});
 try{
  const denied=await app.inject({method:'GET',url:'/api/organizations/'+org,headers:get});
  assert.equal(denied.statusCode,403);
  assert.equal(denied.json().code,'ACCESS_DENIED');
  const stale=await app.inject({method:'POST',url:'/api/organizations/'+org+
   '/invitations/'+member+'/cancel',headers:write,
   payload:{generation:1,confirmed:true}});
  assert.equal(stale.statusCode,409);
  assert.equal(stale.json().code,'CONFLICT');
 }finally{await app.close();}
});
