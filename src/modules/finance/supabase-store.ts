import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {FinanceCommandStore} from './store.js';
export function supabaseFinanceStore(env:Env):FinanceCommandStore {
 return {async run(actor,action,id,data){
  const result=await serviceDatabase(env).rpc('finance_command',{
   p_actor:actor,p_action:action,p_id:id,p_data:data,
  });
  if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
  if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))
   throw Error('Invalid finance command result');
  return result.data;
 }};
}
