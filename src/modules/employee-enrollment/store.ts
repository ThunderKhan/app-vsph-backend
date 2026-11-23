/** The existing SQL routine owns capability state, issuer authority, and replay prevention. */
export type EmployeeInvitation={name:string;email:string;expiresAt:string;purpose?:string};
export type ReservedEmployee={id:string;authUserId:string;email:string};
export type EnrollmentIdentity={id:string;email?:string|null;email_confirmed_at?:string|null;
 app_metadata?:Record<string,unknown>;factors?:Array<{status:string}>};
export class EnrollmentPasswordRejected extends Error {
 readonly name='EnrollmentPasswordRejected';
}
export interface EnrollmentStore {
 inspect(id:string,tokenHash:string):Promise<EmployeeInvitation>;
 reserve(id:string,tokenHash:string,acceptanceId:string):Promise<ReservedEmployee>;
 identity(userId:string):Promise<EnrollmentIdentity>;
 setPassword(userId:string,password:string):Promise<void>;
 reject(id:string,tokenHash:string,acceptanceId:string):Promise<void>;
 finish(id:string,tokenHash:string,acceptanceId:string):Promise<void>;
 failed(id:string,tokenHash:string,acceptanceId:string):Promise<void>;
}
