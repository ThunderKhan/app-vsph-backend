/** Authoritative role checks, idempotency and current roster version stay in SQL. */
export type ManagerEnrollmentRecord={id:string;authUserId:string;email:string;version:number;replayed?:false};
export type ManagerReplay={id:string;replayed:true};
export interface ManagerEnrollmentStore {
  deliveryAccess(actor:string):Promise<void>;
  review(actor:string,sessionHash:string,employeeId:string):Promise<unknown>;
  command(actor:string,action:'start'|'renew'|'ready'|'cancel',
    id:string,data:Record<string,unknown>):Promise<unknown>;
  provision(record:ManagerEnrollmentRecord):Promise<void>;
}
