import type { PortalProfile, PortalSessionRecord } from './portal-session.js';
export type Application = { id:string; code:string; name:string; login_path:string; status:string; visibility?:string };
export type ProductContext = { id:string; name:string; slug?:string; status:string; role:string };
export type AppSession = { token_hash:string; portal_token_hash:string; user_id:string;
  application_id:string; organization_id:string; expires_at:string };
export interface AuthStore {
  activeProfile(id:string):Promise<PortalProfile|null>;
  portalSession(tokenHash:string):Promise<PortalSessionRecord|null>;
  createPortal(tokenHash:string,userId:string,expiresAt:string):Promise<void>;
  revokePortal(tokenHash:string):Promise<void>;
  temporaryLogout(setupHash:string):Promise<void>;
  appByCode(code:string):Promise<Application|null>;
  contexts(user:PortalProfile, app:Application):Promise<ProductContext[]>;
  listedApps():Promise<Application[]>;
  listRecords(table:'crm_contacts'|'music_requests',organizationId:string):Promise<Record<string,unknown>[]>;
  createAppSession(row:AppSession):Promise<void>;
  appSession(tokenHash:string,portalHash:string,userId:string):Promise<AppSession|null>;
  revokeAppSession(tokenHash:string,portalHash:string):Promise<void>;
  revokeAppByToken(tokenHash:string):Promise<void>;
}
