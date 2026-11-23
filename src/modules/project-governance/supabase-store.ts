import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ProjectGovernanceStore} from './store.js';
export function supabaseProjectGovernanceStore(env:Env):ProjectGovernanceStore {
 const db=()=>serviceDatabase(env);
 async function rpc(name:string,args:Record<string,unknown>):Promise<unknown>{
  const {data,error}=await db().rpc(name,args);
  if(error)throw new RpcError(error.code??'UNKNOWN');
  return data;
 }
 return {
  workforce:(actor,action,id,data)=>rpc('project_workforce_command',{
   p_actor:actor,p_action:action,p_project:id,p_data:data,
  }),
  lifecycle:(actor,action,id,data)=>rpc('project_lifecycle_command',{
   p_actor:actor,p_action:action,p_project:id,p_data:data,
  }),
  clientMember:(actor,id,data)=>rpc('project_command',{
   p_actor:actor,p_action:'member.save',p_id:id,p_data:data,
  }),
 };
}
