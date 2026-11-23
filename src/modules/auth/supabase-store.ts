import type { Env } from '../../config.js';
import { serviceDatabase } from '../../repositories/supabase.js';
import { permittedContexts } from './entitlements.js';
import type { PortalProfile, PortalSessionRecord } from './portal-session.js';
import type { AuthStore, Application, AppSession, ProductContext } from './store.js';

function checked<T>(result: { data: T | null; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new Error('Database operation failed' + (result.error.code?':'+result.error.code:''));
  return result.data as T;
}
export function supabaseAuthStore(env: Env): AuthStore {
  const db = () => serviceDatabase(env);
  return {
    async activeProfile(id) {
      const row = checked(await db().from('profiles').select('id,full_name,email,status,platform_role')
        .eq('id',id).eq('status','active').maybeSingle());
      return row as PortalProfile|null;
    },
    async portalSession(hash) {
      const row = checked(await db().from('portal_sessions')
        .select('token_hash,user_id,expires_at,profile:profiles!inner(id,full_name,email,status,platform_role)')
        .eq('token_hash',hash).maybeSingle());
      return row as PortalSessionRecord|null;
    },
    async createPortal(token_hash,user_id,expires_at) {
      checked(await db().from('portal_sessions').insert({token_hash,user_id,expires_at}));
    },
    async revokePortal(hash) {
      checked(await db().from('portal_sessions').delete().eq('token_hash',hash));
      // Checked-in schema uses ON DELETE CASCADE from app_sessions to portal_sessions.
    },
    async temporaryLogout(hash) {
      const result=await db().rpc('internal_employee_credentials',{p_actor:null,p_action:'logout',
        p_id:null,p_data:{setupHash:hash}});
      if (result.error && !['42501','40001','PGRST202','42883'].includes(result.error.code))
        throw new Error('Temporary session revocation failed');
    },
    async appByCode(code) {
      const row=checked(await db().from('applications')
        .select('id,code,name,login_path,status,visibility').eq('code',code).maybeSingle());
      return row as Application|null;
    },
    async contexts(user,app):Promise<ProductContext[]> {
      if (user.status!=='active'||app.status!=='active'||app.code==='OUTREACH') return [];
      const [memberResult,roleResult]=await Promise.all([
        db().from('organization_memberships').select('organization_id,user_id,status')
          .eq('user_id',user.id).eq('status','active').limit(501),
        db().from('user_app_roles').select('organization_id,application_id,user_id,role_code')
          .eq('user_id',user.id).eq('application_id',app.id).limit(501),
      ]);
      const memberships=checked(memberResult), roles=checked(roleResult);
      if (memberships.length>500||roles.length>500) throw new Error('Product context limit exceeded');
      const memberIds=new Set(memberships.map(x=>x.organization_id));
      const ids=[...new Set(roles.filter(x=>memberIds.has(x.organization_id)).map(x=>x.organization_id))];
      if (!ids.length)return [];
      const contexts:ProductContext[]=[];
      for (let i=0;i<ids.length;i+=50) {
        const batch=ids.slice(i,i+50);
        const [sr,gr,or]=await Promise.all([
          db().from('subscriptions').select('organization_id,application_id,status,starts_at,ends_at')
            .eq('application_id',app.id).in('organization_id',batch),
          db().from('organization_app_access').select('organization_id,application_id,status')
            .eq('application_id',app.id).in('organization_id',batch),
          db().from('organizations').select('id,name,slug,status')
            .in('id',batch).eq('status','active'),
        ]);
        contexts.push(...permittedContexts({
          user, app, subscriptions:checked(sr), grants:checked(gr),
          organizations:checked(or), memberships,roles,
        }));
      }
      return contexts;
    },
    async listedApps() {
      return checked(await db().from('applications')
        .select('id,code,name,login_path,status,visibility').eq('status','active')
        .eq('visibility','listed').order('name')) as Application[];
    },
    async createAppSession(row) {
      checked(await db().from('app_sessions').insert(row));
    },
    async appSession(tokenHash,portalHash,userId) {
      return checked(await db().from('app_sessions').select('token_hash,portal_token_hash,user_id,application_id,organization_id,expires_at')
        .eq('token_hash',tokenHash).eq('portal_token_hash',portalHash)
        .eq('user_id',userId).maybeSingle()) as AppSession|null;
    },
    async revokeAppSession(tokenHash,portalHash) {
      checked(await db().from('app_sessions').delete().eq('token_hash',tokenHash)
        .eq('portal_token_hash',portalHash));
    },
    async revokeAppByToken(tokenHash) {
      checked(await db().from('app_sessions').delete().eq('token_hash',tokenHash));
    },
  };
}
