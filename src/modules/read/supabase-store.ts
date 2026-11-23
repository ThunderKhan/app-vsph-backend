import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {PortalReadStore} from './store.js';
export function supabaseReadStore(env:Env):PortalReadStore {
 const db=()=>serviceDatabase(env);
 async function cmd(name:string,args:Record<string,unknown>):Promise<unknown> {
  const {data,error}=await db().rpc(name,args);
  if(error)throw new RpcError(error.code??'UNKNOWN');
  return data;
 }
 return {
  project:(actor,action,id,data)=>cmd('project_command',{
    p_actor:actor,p_action:action,p_id:id,p_data:data,
  }),
  managerOverview:actor=>cmd('project_workforce_command',{
    p_actor:actor,p_action:'overview',p_project:null,p_data:{},
  }),
  search:(actor,projectId,data)=>cmd('project_search',{
    p_actor:actor,p_action:'list',p_id:projectId,p_data:data,
  }),
  hrAccess:(actor,sessionHash)=>cmd('hrms_access',{
    p_actor:actor,p_action:'get',p_id:null,p_data:{currentHash:sessionHash},
  }),
  financeDashboard:actor=>cmd('finance_report',{
    p_actor:actor,p_action:'dashboard',p_id:null,p_data:{},
  }),
 };
}
