export type CredentialReservation={
 id:string; userId:string; email:string; enrollmentId:string; assurance:'aal1'|'aal2';
};
export type CredentialIdentity={
 id:string;email?:string|null;email_confirmed_at?:string|null;
 app_metadata?:Record<string,unknown>;factors?:Array<{status:string}>;
};
export class ProviderPasswordRejected extends Error{}
/** RPC owns single-use reservation and recovery; Auth provider owns password write only. */
export interface CredentialStore {
 status(setupHash:string):Promise<unknown>;
 reserve(setupHash:string,passwordHash:string,nonce:string):Promise<CredentialReservation>;
 getIdentity(id:string):Promise<CredentialIdentity>;
 updatePassword(id:string,password:string):Promise<void>;
 finish(setupHash:string,nonce:string):Promise<void>;
 reject(setupHash:string,nonce:string):Promise<void>;
 failed(id:string,nonce:string):Promise<void>;
}
