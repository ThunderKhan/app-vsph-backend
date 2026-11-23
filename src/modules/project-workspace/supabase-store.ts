import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ProjectWorkspaceStore} from './store.js';
export function supabaseProjectWorkspaceStore(env:Env):ProjectWorkspaceStore {
 return {async command(actor,action,projectId,data){
   const result=await serviceDatabase(env).rpc('project_workspace_command',{
     p_actor:actor,p_action:action,p_project:projectId,p_data:data,
   });
   if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
   return result.data;
 }};
}
