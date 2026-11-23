import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ProjectWriteStore} from './store.js';
export function supabaseProjectWriteStore(env:Env):ProjectWriteStore{
 const db=()=>serviceDatabase(env);
 async function execute(name:string,args:Record<string,unknown>):Promise<unknown>{
  const {data,error}=await db().rpc(name,args);
  if(error)throw new RpcError(error.code??'UNKNOWN');
  return data;
 }
 return {
  command:(actor,action,id,data)=>execute('project_command',{
   p_actor:actor,p_action:action,p_id:id,p_data:data,
  }),
  createWithManager:(actor,data)=>execute('project_creation_command',{
   p_actor:actor,p_action:'create',p_data:data,
  }),
 };
}
