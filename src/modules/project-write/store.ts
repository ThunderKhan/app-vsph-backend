export type ProjectWriteAction='create'|'update'|'milestone.create'|'milestone.update'|
 'task.create'|'task.update'|'comment.create'|'deliverable.create';
export interface ProjectWriteStore {
 command(actor:string,action:ProjectWriteAction,id:string|null,
  data:Record<string,unknown>):Promise<unknown>;
 createWithManager(actor:string,data:Record<string,unknown>):Promise<unknown>;
}
