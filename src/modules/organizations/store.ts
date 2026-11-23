export type OrganizationAction='list'|'read'|'members'|'profile'|'member'|'role';
export type OrganizationInvitationAction='list'|'queue'|'cancel'|'reissue';
export interface OrganizationStore {
 command(actor:string,action:OrganizationAction,id:string|null,data:Record<string,unknown>):Promise<unknown>;
 invitation(actor:string,action:OrganizationInvitationAction,id:string,
  data:Record<string,unknown>):Promise<unknown>;
}
