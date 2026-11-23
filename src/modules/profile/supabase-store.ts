import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {AccountProfileStore} from './store.js';
export function supabaseProfileStore(env:Env):AccountProfileStore {
 return {async command(actor,sessionHash,action,data){
  const {data:result,error}=await serviceDatabase(env).rpc('account_profile',{
    p_actor:actor,p_action:action,p_id:null,p_data:{...data,currentHash:sessionHash},
  });
  if(error)throw new RpcError(error.code??'UNKNOWN');
  return result;
 }};
}
