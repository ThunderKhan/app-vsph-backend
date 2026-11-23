import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config.js';
import { HttpError } from '../../errors.js';
import { verifyIdentity } from './verify-identity.js';
import { createSupabaseIdentityProvider } from './supabase-identity-provider.js';
import type { ProviderUser } from './identity-provider.js';
import { sessionCookies, sessionSetCookie, expireCookies } from './cookies.js';
import { PORTAL_COOKIE, EMPLOYEE_SETUP_COOKIE, SESSION_HOURS, hashSessionToken,
  newSessionToken, applicationCookie } from './session-tokens.js';
import { resolvePortalSession, type ResolvedPortalSession } from './portal-session.js';
import type { AuthStore, Application, ProductContext } from './store.js';
import { supabaseAuthStore } from './supabase-store.js';
import { adapter, canCreateRecord, diagnostics } from '../products/adapters.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = /^[A-Z][A-Z0-9_]{1,39}$/;
const credentials = z.strictObject({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(4096),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  totpFactorId: z.string().regex(uuid).optional(),
});
const applicationLogin = credentials.extend({
  app: z.string().regex(code),
  organizationId: z.string().regex(uuid),
});
export type IdentityVerifier = (input:unknown,expectedUserId?:string) =>
  Promise<{user:ProviderUser;assurance:'aal1'|'aal2'}>;
export type AuthDependencies={ store?:AuthStore; verify?:IdentityVerifier };

function invalid():never {throw new HttpError(400,'INVALID_CREDENTIAL_FIELDS','Review the email, password and authenticator fields.');}
function principalFields(user: ResolvedPortalSession['user']) {
  return { id:user.id, name:user.full_name, email:user.email, platformRole:user.platform_role };
}
function future():string {return new Date(Date.now()+SESSION_HOURS*3600000).toISOString();}
function accessDenied():never {throw new HttpError(403,'ACCESS_DENIED','Application or customer workspace access denied.');}
function authDenied():never {throw new HttpError(401,'SESSION_REQUIRED','Portal session expired. Please log in.');}
function rateLimiter(max=20,intervalMs=900000) {
  const buckets=new Map<string,{hits:number;until:number}>();
  return async (request:FastifyRequest,reply:FastifyReply) => {
    const now=Date.now(),key=request.ip;
    let value=buckets.get(key);
    if(!value||value.until<=now) {
      if(buckets.size>=10000) {
        for(const [ip,b] of buckets) if(b.until<=now)buckets.delete(ip);
        if(buckets.size>=10000) throw new HttpError(429,'RATE_LIMITED','Too many requests. Try again later.');
      }
      value={hits:0,until:now+intervalMs};buckets.set(key,value);
    }
    value.hits++;
    if(value.hits>max) {
      reply.header('Retry-After',String(Math.ceil((value.until-now)/1000)));
      throw new HttpError(429,'RATE_LIMITED','Too many requests. Try again later.');
    }
  };
}
export function installAuthRoutes(app:FastifyInstance, env:Env,deps:AuthDependencies={}):void {
  const store=deps.store??supabaseAuthStore(env);
  const verify=deps.verify??((input:unknown,expectedUserId?:string)=>
    verifyIdentity(input,()=>createSupabaseIdentityProvider({
      url:env.SUPABASE_URL??'',publishableKey:env.SUPABASE_PUBLISHABLE_KEY??'',
    }),expectedUserId?{expectedUserId}:{}));
  const secure=env.NODE_ENV==='production';
  const requirePortal=async(request:FastifyRequest):Promise<ResolvedPortalSession>=>{
    const raw=sessionCookies(request)[PORTAL_COOKIE];
    if(!raw)return authDenied();
    try {return await resolvePortalSession(raw,{
      findByTokenHash:(hash)=>store.portalSession(hash),
    });}catch{return authDenied();}
  };
  const applicationFor=async(value:string):Promise<Application>=>{
    if(!code.test(value))return accessDenied();
    const found=await store.appByCode(value);
    if(!found||found.status!=='active')throw new HttpError(404,'APPLICATION_UNAVAILABLE','Application unavailable.');
    if(found.code==='OUTREACH')throw new HttpError(503,'INTEGRATION_NOT_READY',
      'Outreach requires its separate verified access boundary.');
    return found;
  };
  const allowedContext=async(principal:ResolvedPortalSession,application:Application,
    organizationId:string):Promise<ProductContext>=>{
    const contexts=await store.contexts(principal.user,application);
    return contexts.find(c=>c.id===organizationId)??accessDenied();
  };
  const requireProduct=async(request:FastifyRequest,codeValue:string)=>{
    const principal=await requirePortal(request);
    const raw=sessionCookies(request)[applicationCookie(codeValue)];
    if(!raw)return authDenied();
    const appSession=await store.appSession(hashSessionToken(raw),principal.session.token_hash,principal.user.id);
    if(!appSession||!(new Date(appSession.expires_at).getTime()>Date.now()))return authDenied();
    const application=await applicationFor(codeValue);
    if(appSession.application_id!==application.id)return accessDenied();
    const organization=await allowedContext(principal,application,appSession.organization_id);
    return {principal,application,organization};
  };
  app.post('/api/auth/login',{preHandler:rateLimiter()},async(request,reply)=>{
    const parsed=credentials.safeParse(request.body);
    if(!parsed.success)return invalid();
    const verified=await verify(parsed.data);
    const user=await store.activeProfile(verified.user.id);
    if(!user||user.status!=='active') {
      // This only follows real Supabase password/MFA verification. The enrollment
      // metadata is provided by the provider, never by the browser.
      const enrollment=verified.user.app_metadata?.vsph_employee_enrollment;
      if(typeof enrollment!=='string'||!uuid.test(enrollment))
        throw new HttpError(403,'ACCOUNT_NOT_ACTIVE','Account is not enabled.');
      const setupRaw=newSessionToken();
      const permitted=await store.temporaryLogin(verified.user.id,verified.assurance,
        hashSessionToken(setupRaw),hashSessionToken(parsed.data.password));
      if(!permitted)throw new HttpError(403,'ACCOUNT_NOT_ACTIVE',
        'Temporary credentials are invalid or expired.');
      reply.header('Set-Cookie',sessionSetCookie(EMPLOYEE_SETUP_COOKIE,setupRaw,secure,600));
      return {passwordChangeRequired:true,redirect:'/employee-password'};
    }
    const raw=newSessionToken(),hash=hashSessionToken(raw);
    await store.createPortal(hash,user.id,future());
    const cookies=sessionCookies(request);
    const old=cookies[PORTAL_COOKIE];
    // Normal portal sessions must not leave an active temporary setup capability.
    if(cookies[EMPLOYEE_SETUP_COOKIE]){
      try{await store.temporaryLogout(hashSessionToken(cookies[EMPLOYEE_SETUP_COOKIE]));}
      catch(error){await store.revokePortal(hash);throw error;}
    }
    if(old){
      try {await store.revokePortal(hashSessionToken(old));}
      catch(error){await store.revokePortal(hash);throw error;}
    }
    reply.header('Set-Cookie',[
      ...expireCookies(cookies,secure),
      sessionSetCookie(PORTAL_COOKIE,raw,secure,SESSION_HOURS*3600),
    ]);
    return {message:'Signed in.',user:principalFields(user)};
  });
  app.get('/api/auth/me',async(request)=>({user:principalFields((await requirePortal(request)).user)}));
  app.post('/api/auth/logout',async(request,reply)=>{
    const cookies=sessionCookies(request);
    if(cookies[EMPLOYEE_SETUP_COOKIE])await store.temporaryLogout(hashSessionToken(cookies[EMPLOYEE_SETUP_COOKIE]));
    if(cookies[PORTAL_COOKIE])await store.revokePortal(hashSessionToken(cookies[PORTAL_COOKIE]));
    else {
      for(const [name,raw] of Object.entries(cookies))
        if(name!==EMPLOYEE_SETUP_COOKIE)await store.revokeAppByToken(hashSessionToken(raw));
    }
    reply.header('Set-Cookie',expireCookies(cookies,secure));
    return {message:'Signed out.'};
  });
  app.post('/api/auth/app-login',{preHandler:rateLimiter()},async(request,reply)=>{
    const principal=await requirePortal(request);
    const parsed=applicationLogin.safeParse(request.body);
    if(!parsed.success)return invalid();
    const body=parsed.data;
    const application=await applicationFor(body.app);
    if(principal.user.email.toLowerCase()!==body.email.trim().toLowerCase())return accessDenied();
    await allowedContext(principal,application,body.organizationId);
    await verify(body,principal.user.id);
    // A second entitlement check catches revocation while verification was in flight.
    await allowedContext(principal,application,body.organizationId);
    const raw=newSessionToken();
    await store.createAppSession({token_hash:hashSessionToken(raw),
      portal_token_hash:principal.session.token_hash,user_id:principal.user.id,
      application_id:application.id,organization_id:body.organizationId,expires_at:future()});
    reply.header('Set-Cookie',sessionSetCookie(applicationCookie(application.code),raw,secure,SESSION_HOURS*3600));
    return {message:'Application signed in.',redirect:`/apps/${application.code.toLowerCase()}/home`};
  });
  app.post('/api/auth/app-logout',async(request,reply)=>{
    const principal=await requirePortal(request);
    const parsed=z.strictObject({app:z.string().regex(code)}).safeParse(request.body);
    if(!parsed.success)return invalid();
    const name=applicationCookie(parsed.data.app),raw=sessionCookies(request)[name];
    if(raw)await store.revokeAppSession(hashSessionToken(raw),principal.session.token_hash);
    reply.header('Set-Cookie',expireCookies({[name]:raw??''},secure).slice(-1));
    return {message:'Application signed out.'};
  });
  app.get('/api/account/sessions',async(request)=>{
    const principal=await requirePortal(request);
    return store.sessionCommand(principal.user.id,'list',null,principal.session.token_hash);
  });
  app.post('/api/account/sessions/revoke-others',async(request)=>{
    const principal=await requirePortal(request);
    return store.sessionCommand(principal.user.id,'revoke_others',null,principal.session.token_hash);
  });
  app.post<{Params:{id:string}}>('/api/account/sessions/:id/revoke',async(request)=>{
    const principal=await requirePortal(request);
    if(!uuid.test(request.params.id))
      throw new HttpError(400,'INVALID_SESSION_ID','Invalid session.');
    return store.sessionCommand(principal.user.id,'revoke',request.params.id,principal.session.token_hash);
  });
  app.get('/api/apps',async(request)=>{
    const principal=await requirePortal(request),apps=await store.listedApps();
    const authorized:Application[]=[];
    for(const application of apps){
      // Outreach requires a separate internal employee grant not modeled as product membership.
      if(application.code==='OUTREACH')continue;
      if(principal.user.platform_role==='super_admin'||(await store.contexts(principal.user,application)).length)
        authorized.push(application);
    }
    return {applications:authorized};
  });
  app.get<{Params:{app:string}}>('/api/apps/:app/contexts',async(request)=>{
    const principal=await requirePortal(request);
    const application=await applicationFor(request.params.app.toUpperCase());
    return {application,organizations:await store.contexts(principal.user,application),email:principal.user.email};
  });
  app.get<{Params:{app:string}}>('/api/apps/:app/context',async(request)=>{
    const {principal,application,organization}=await requireProduct(request,request.params.app.toUpperCase());
    return {application,organization,role:organization.role,
      capabilities:{createRecords:canCreateRecord(application.code,organization.role)},
      integration:diagnostics(application.code),
      user:{name:principal.user.full_name,email:principal.user.email}};
  });
  app.get<{Params:{app:string}}>('/api/apps/:app/records',async(request)=>{
    const {application,organization}=await requireProduct(request,request.params.app.toUpperCase());
    const selected=adapter(application.code);
    if(!selected)return {records:[],configured:false};
    const records=await store.listRecords(selected.table,organization.id);
    return {records};
  });
}
