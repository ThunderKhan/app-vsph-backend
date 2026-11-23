export interface ProjectCustomAppsStore {
 command(actor:string,action:'list'|'create'|'update',project:string,
  applicationId:string|null,data:Record<string,unknown>):Promise<unknown>;
}
