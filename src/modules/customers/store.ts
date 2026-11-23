export type CustomerAction='list'|'read'|'member'|'role';
export type CustomerLifecycleAction='preview'|'status'|'entitlement'|'subscription'|'access';
export interface CustomerStore {
 command(actor:string,action:CustomerAction,id:string|null,data:Record<string,unknown>):Promise<unknown>;
 lifecycle(actor:string,action:CustomerLifecycleAction,id:string,data:Record<string,unknown>):Promise<unknown>;
 queueInvitation(actor:string,key:string,request:Record<string,unknown>):Promise<unknown>;
}
