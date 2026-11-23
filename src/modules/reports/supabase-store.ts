import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ProjectReportStore} from './store.js';
export function supabaseProjectReportStore(env:Env):ProjectReportStore{
 return {async list(actor,projectId,filters){
   const {data,error}=await serviceDatabase(env).rpc('project_report',{
     p_actor:actor,p_action:'list',p_id:projectId,p_data:filters,
   });
   if(error)throw new RpcError(error.code??'UNKNOWN');
   return data;
 }};
}
