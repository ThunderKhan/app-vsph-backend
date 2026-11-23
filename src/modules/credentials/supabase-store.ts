import type { Env } from '../../config.js';
import { serviceDatabase } from '../../repositories/supabase.js';
import { RpcError } from '../../repositories/rpc-errors.js';
import { ProviderPasswordRejected, type CredentialIdentity, type CredentialReservation,
  type CredentialStore } from './store.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function credentialRecord(raw:unknown):CredentialReservation {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid credential reservation');
  const r=raw as Record<string,unknown>;
  if(typeof r.id!=='string'||!uuid.test(r.id)||
    typeof r.userId!=='string'||!uuid.test(r.userId)||
    typeof r.email!=='string'||typeof r.enrollmentId!=='string'||!uuid.test(r.enrollmentId)||
    (r.assurance!=='aal1'&&r.assurance!=='aal2'))
    throw Error('Invalid credential reservation');
  return {id:r.id,userId:r.userId,email:r.email,enrollmentId:r.enrollmentId,assurance:r.assurance};
}
async function bounded<T>(op:()=>Promise<T>):Promise<T>{
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([op(),new Promise<T>((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('Provider timeout')),15000);
  })]);}finally{if(timeout)clearTimeout(timeout);}
}
export function supabaseCredentialStore(env:Env):CredentialStore {
  const db=()=>serviceDatabase(env);
  const rpc=async(action:string,id:string|null,data:Record<string,unknown>)=>{
    const {data:result,error}=await db().rpc('internal_employee_credentials',{
      p_actor:null,p_action:action,p_id:id,p_data:data,
    });
    if(error)throw new RpcError(error.code??'UNKNOWN');
    return result as unknown;
  };
  return {
    status:async hash=>rpc('status',null,{setupHash:hash}),
    reserve:async(hash,passwordHash,nonce)=>
      credentialRecord(await rpc('reserve',null,{setupHash:hash,temporaryHash:passwordHash,nonce})),
    async getIdentity(id) {
      return await bounded(async()=>{
        const {data,error}=await db().auth.admin.getUserById(id);
        if(error||!data?.user)throw Error('Identity unavailable');
        return data.user as CredentialIdentity;
      });
    },
    async updatePassword(id,password){
      await bounded(async()=>{
        const result=await db().auth.admin.updateUserById(id,{password});
        if(result.error&&[400,422].includes(result.error.status??0))
          throw new ProviderPasswordRejected('Choose a stronger personal password.');
        if(result.error||result.data?.user?.id!==id)throw Error('Provider credential write unavailable');
      });
    },
    finish:async(hash,nonce)=>{await rpc('finish',null,{setupHash:hash,nonce});},
    reject:async(hash,nonce)=>{await rpc('reject',null,{setupHash:hash,nonce});},
    failed:async(id,nonce)=>{await rpc('failed',id,{nonce});},
  };
}
