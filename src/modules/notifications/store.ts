export type NotificationAction='dispatch'|'inbox'|'retry'|'preferences'|'preferences.save'|'read';
export interface NotificationStore{
 command(actor:string,action:NotificationAction,data:Record<string,unknown>):Promise<unknown>;
}
