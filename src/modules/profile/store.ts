export interface AccountProfileStore {
 command(actor:string,sessionHash:string,action:'get'|'save',data:Record<string,unknown>):Promise<unknown>;
}
