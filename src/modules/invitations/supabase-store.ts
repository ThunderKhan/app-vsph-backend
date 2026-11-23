import type { Env } from '../../config.js';
import { serviceDatabase } from '../../repositories/supabase.js';
import type { InvitationStore } from './store.js';

export function supabaseInvitationStore(env:Env):InvitationStore {
  const client=()=>serviceDatabase(env);
  async function command(action:string,id:string,tokenHash:string,
    actorId:string|null,acceptanceId?:string):Promise<unknown> {
    const {data,error}=await client().rpc('provisioning_command',{
      p_actor:actorId,p_action:action,p_id:id,
      p_data:{tokenHash,...(acceptanceId?{acceptanceId}:{})},
    });
    if(error)throw new Error('Invitation RPC failed:'+error.code);
    return data;
  }
  function record(value:unknown):{newIdentity:boolean;userId?:string} {
    if(!value||typeof value!=='object'||Array.isArray(value)||
      !('newIdentity' in value)||typeof value.newIdentity!=='boolean')
      throw new Error('Invalid invitation RPC response');
    const obj=value as Record<string,unknown>;
    return {newIdentity:value.newIdentity,...(typeof obj.userId==='string'?{userId:obj.userId}:{})};
  }
  return {
    inspect:async(id,hash,actor)=>record(await command('inspect',id,hash,actor)),
    reserve:async(id,hash,actor,acceptanceId)=>{
      const result=record(await command('reserve_accept',id,hash,actor,acceptanceId));
      return {newIdentity:result.newIdentity,userId:result.userId??''};
    },
    async setNewIdentityPassword(userId,password) {
      const result=await client().auth.admin.updateUserById(userId,{password,email_confirm:true});
      if(result.error)throw new Error('Invited account provider update failed');
    },
    finish:async(id,hash,actor,acceptanceId)=>{
      await command('finish_accept',id,hash,actor,acceptanceId);
    },
    markFailed:async(id,hash,actor,acceptanceId)=>{
      await command('accept_failed',id,hash,actor,acceptanceId);
    },
  };
}
