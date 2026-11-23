export interface ProjectGovernanceStore {
 workforce(actor:string,action:'directory'|'assign'|'remove'|'manager.grant'|'manager.revoke',
  projectId:string,data:Record<string,unknown>):Promise<unknown>;
 lifecycle(actor:string,action:'archive'|'delete',projectId:string,data:Record<string,unknown>):Promise<unknown>;
 clientMember(actor:string,projectId:string,data:Record<string,unknown>):Promise<unknown>;
}
