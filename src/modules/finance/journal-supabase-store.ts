import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {FinanceJournalStore} from './journal-store.js';

export function supabaseFinanceJournalStore(env:Env):FinanceJournalStore {
 return {async list(actor,kind,filters){
  const {data,error}=await serviceDatabase(env).rpc('finance_journal',{
   p_actor:actor,p_action:kind,p_id:null,p_data:filters,
  });
  if(error)throw new RpcError(error.code??'UNKNOWN');
  if(!data||typeof data!=='object'||Array.isArray(data))
   throw Error('Invalid journal response');
  return data;
 }};
}
