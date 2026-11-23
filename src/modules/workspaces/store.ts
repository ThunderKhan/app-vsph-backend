export interface WorkspaceCountStore {
 count(actor:string,platformOwner:boolean):Promise<{count:number}>;
}
