export type WorkspaceOperation='list'|'checklist.add'|'checklist.toggle'|'risk.add'|
 'risk.resolve'|'resource.add'|'resource.archive'|'update.publish';
export interface ProjectWorkspaceStore {
 command(actorId:string,action:WorkspaceOperation,projectId:string,
  data:Record<string,unknown>):Promise<unknown>;
}
