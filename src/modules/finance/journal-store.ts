export type JournalKind='invoices'|'receipts';
export interface FinanceJournalStore {
 list(actor:string,kind:JournalKind,filters:Record<string,unknown>):Promise<unknown>;
}
