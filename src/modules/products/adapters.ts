/** Frozen source products/adapters.js. No arbitrary database product can select a table. */
export type ProductTable='crm_contacts'|'music_requests';
type Adapter={key:string;table:ProductTable;heading:string;columns:readonly string[];roles:readonly string[]};
const registry:Record<string,Adapter>=Object.freeze({
  CRM:Object.freeze({key:'crm',table:'crm_contacts',heading:'CRM Contacts',
    columns:['Contact','Email','Company'],roles:['super_admin','admin','manager','user']}),
  MUSIC:Object.freeze({key:'music',table:'music_requests',heading:'Music Requests',
    columns:['Song','Artist','Status'],roles:['super_admin','admin','manager','staff','user']}),
});
export const adapter=(code:string):Adapter|null => Object.hasOwn(registry,code)?registry[code]??null:null;
export const canCreateRecord=(code:string,role:string)=>Boolean(adapter(code)?.roles.includes(role));
export function diagnostics(code:string) {
  const selected=adapter(code);
  return {adapter:selected?.key??'portal-only',recordsConfigured:Boolean(selected),
    heading:selected?.heading??'Product workspace',columns:selected?.columns??[],
    launchPath:'/apps/'+encodeURIComponent(code.toLowerCase())+'/launch',
    externalHealth:'unverified'};
}
