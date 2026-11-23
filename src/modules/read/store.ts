export interface PortalReadStore {
  project(actor:string,action:'list'|'detail',id:string|null,data:Record<string,unknown>):Promise<unknown>;
  managerOverview(actor:string):Promise<unknown>;
  search(actor:string,projectId:string|null,data:Record<string,unknown>):Promise<unknown>;
  hrAccess(actor:string,sessionHash:string):Promise<unknown>;
  financeDashboard(actor:string):Promise<unknown>;
}
