import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ProjectCustomAppsStore} from './store.js';
export function supabaseProjectCustomAppsStore(env:Env):ProjectCustomAppsStore{
 return {async command(actor,action,project,applicationId,data){
   const result=await serviceDatabase(env).rpc('project_custom_application_command',{
     p_actor:actor,p_action:action,p_project:project,p_id:applicationId,p_data:data,
   });
   if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
   return result.data;
 }};
}
