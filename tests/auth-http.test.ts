import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config.js';
import type { AuthStore } from '../src/modules/auth/store.js';
import { hashSessionToken } from '../src/modules/auth/session-tokens.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user={id,full_name:'Test User',email:'test@example.invalid',status:'active',platform_role:'user'};
const env=parseEnv({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:3000'});
function state() {
  const sessions=new Map<string,{token_hash:string;user_id:string;expires_at:string;profile:typeof user}>();
  const apps=new Map<string,{token_hash:string;portal_token_hash:string;user_id:string;
    application_id:string;organization_id:string;expires_at:string}>();
  const application={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',code:'CRM',name:'CRM',status:'active',
    login_path:'/apps/crm/login',visibility:'listed'};
  const store:AuthStore={
    activeProfile:async () => user,
    portalSession:async hash=>sessions.get(hash)??null,
    createPortal:async(token_hash,user_id,expires_at)=>{sessions.set(token_hash,{token_hash,user_id,expires_at,profile:user});},
    revokePortal:async hash=>{sessions.delete(hash);for(const [key,a] of apps)if(a.portal_token_hash===hash)apps.delete(key);},
    temporaryLogout:async()=>{},
    appByCode:async code=>code==='CRM'?application:null,
    contexts:async()=>[{id:org,name:'Org A',status:'active',role:'manager'}],
    listedApps:async()=>[application],
    listRecords:async()=>[],
    createAppSession:async row=>{apps.set(row.token_hash,row);},
    appSession:async hash=>apps.get(hash)??null,
    revokeAppSession:async hash=>{apps.delete(hash);},
    revokeAppByToken:async hash=>{apps.delete(hash);},
  };
  return {store,sessions,apps};
}
test('portal login cookie, private me and server-side logout revocation',async()=>{
  const s=state(),app=buildApp(env,{auth:{store:s.store,
    verify:async()=>({user:{id,email:user.email},assurance:'aal1'})}});
  try{
    const login=await app.inject({method:'POST',url:'/api/auth/login',
      headers:{origin:env.PUBLIC_ORIGIN},payload:{email:user.email,password:'not-real'}});
    assert.equal(login.statusCode,200,login.body);
    assert.equal(login.json().user.id,id);
    const raw=/vsph\.portal\.sid=([^;]+)/.exec(String(login.headers['set-cookie']))?.[1];
    assert.ok(raw);
    assert.equal(s.sessions.has(hashSessionToken(raw)),true);
    const me=await app.inject({method:'GET',url:'/api/auth/me',headers:{cookie:'vsph.portal.sid='+raw}});
    assert.equal(me.statusCode,200);
    assert.equal(me.json().user.id,id);
    const logout=await app.inject({method:'POST',url:'/api/auth/logout',
      headers:{origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw},payload:{}});
    assert.equal(logout.statusCode,200);
    assert.equal(logout.json().message,'Signed out.');
    assert.equal(s.sessions.size,0);
    const denied=await app.inject({method:'GET',url:'/api/auth/me',headers:{cookie:'vsph.portal.sid='+raw}});
    assert.equal(denied.statusCode,401);
  }finally{await app.close();}
});
test('app login enforces portal, tenant, and identity before issuing app cookie',async()=>{
  const s=state(),app=buildApp(env,{auth:{store:s.store,
    verify:async(_credentials,expected)=>{if(expected&&expected!==id)throw Error('wrong user');return {user:{id,email:user.email},assurance:'aal1'};}}});
  try{
    const denied=await app.inject({method:'POST',url:'/api/auth/app-login',
      headers:{origin:env.PUBLIC_ORIGIN},payload:{email:user.email,password:'x',app:'CRM',organizationId:org}});
    assert.equal(denied.statusCode,401);
    const login=await app.inject({method:'POST',url:'/api/auth/login',
      headers:{origin:env.PUBLIC_ORIGIN},payload:{email:user.email,password:'x'}});
    const raw=/vsph\.portal\.sid=([^;]+)/.exec(String(login.headers['set-cookie']))?.[1];assert.ok(raw);
    const wrongTenant=await app.inject({method:'POST',url:'/api/auth/app-login',
      headers:{origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw},
      payload:{email:user.email,password:'x',app:'CRM',organizationId:id}});
    assert.equal(wrongTenant.statusCode,403);
    const authorized=await app.inject({method:'POST',url:'/api/auth/app-login',
      headers:{origin:env.PUBLIC_ORIGIN,cookie:'vsph.portal.sid='+raw},
      payload:{email:user.email,password:'x',app:'CRM',organizationId:org}});
    assert.equal(authorized.statusCode,200,authorized.body);
    assert.match(String(authorized.headers['set-cookie']),/vsph\.crm\.sid=/);
    assert.equal(s.apps.size,1);
  }finally{await app.close();}
});
