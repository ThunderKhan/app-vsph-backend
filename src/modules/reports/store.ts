export interface ProjectReportStore {
 list(actor:string,projectId:string|null,filters:Record<string,unknown>):Promise<unknown>;
}
