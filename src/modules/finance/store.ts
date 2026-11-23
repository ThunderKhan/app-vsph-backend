export type FinanceAction='invoice.create'|'payment.record'|'payment.reverse'|'invoice.void';
/** Entire financial transaction runs inside the frozen finance_command SQL RPC. */
export interface FinanceCommandStore {
 run(actor:string,action:FinanceAction,id:string,data:Record<string,unknown>):Promise<unknown>;
}
