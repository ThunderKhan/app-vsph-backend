import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {OrganizationStore} from './store.js';
export function supabaseOrganizationStore(env:Env):OrganizationStore{
 async function run(name:string,actor:string,action:string,id:string|null,
  data:Record<string,unknown>):Promise<unknown>{
  const result=await serviceDatabase(env).rpc(name,{
   p_actor:actor,p_action:action,p_id:id,p_data:data,
  });
  if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
  if(result.data===null||result.data===undefined)throw Error('Invalid organization response');
  return result.data;
 }
 return {
  command:(actor,action,id,data)=>run('organization_command',actor,action,id,data),
  invitation:(actor,action,id,data)=>run('organization_invitation',actor,action,id,data),
 };
}
