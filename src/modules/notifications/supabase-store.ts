import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {NotificationStore} from './store.js';
export function supabaseNotificationStore(env:Env):NotificationStore {
 return {async command(actor,action,data){
  const result=await serviceDatabase(env).rpc('notification_command',{
   p_actor:actor,p_action:action,p_id:null,p_data:data,
  });
  if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
  return result.data;
 }};
}
