import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import {EnrollmentPasswordRejected,type EnrollmentStore,type ReservedEmployee,
 type EmployeeInvitation,type EnrollmentIdentity} from './store.js';

async function bounded<T>(operation:()=>Promise<T>):Promise<T>{
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation(),new Promise<T>((_,reject)=>{
   timeout=setTimeout(()=>reject(new Error('Identity provider timeout')),15000);
 })]);}finally{if(timeout)clearTimeout(timeout);}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reserved(value:unknown):ReservedEmployee {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid reservation response');
 const x=value as Record<string,unknown>;
 if(typeof x.id!=='string'||!uuid.test(x.id)||typeof x.authUserId!=='string'||
    !uuid.test(x.authUserId)||typeof x.email!=='string'||!x.email)
   throw Error('Invalid reservation response');
 return {id:x.id,authUserId:x.authUserId,email:x.email};
}
function inspected(value:unknown):EmployeeInvitation {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid inspection response');
 const x=value as Record<string,unknown>;
 if(typeof x.name!=='string'||!x.name.trim()||x.name.length>150||
    typeof x.email!=='string'||!x.email.trim()||x.email.length>254||
    typeof x.expiresAt!=='string'||x.expiresAt.length>40||
    !Number.isFinite(Date.parse(x.expiresAt)))
   throw Error('Invalid inspection response');
 return {name:x.name,email:x.email,expiresAt:x.expiresAt};
}
export function supabaseEnrollmentStore(env:Env):EnrollmentStore {
 const client=()=>serviceDatabase(env);
 async function command(action:string,id:string,tokenHash:string,acceptanceId?:string):Promise<unknown>{
   const {data,error}=await client().rpc('internal_employee_enrollment',{
     p_actor:null,p_action:action,p_id:id,p_data:{
       tokenHash,...(acceptanceId?{acceptanceId}:{})
     },
   });
   if(error)throw new RpcError(error.code??'UNKNOWN');
   return data;
 }
 return {
   inspect:async(id,hash)=>inspected(await command('inspect',id,hash)),
   reserve:async(id,hash,acceptanceId)=>reserved(await command('reserve',id,hash,acceptanceId)),
   async identity(id) {
     return bounded(async()=>{
       const result=await client().auth.admin.getUserById(id);
       if(result.error||!result.data?.user)throw Error('Identity unavailable');
       return result.data.user as EnrollmentIdentity;
     });
   },
   async setPassword(id,password){
     await bounded(async()=>{
       const result=await client().auth.admin.updateUserById(id,{password,email_confirm:true});
       if(result.error&&[400,422].includes(result.error.status??0))
         throw new EnrollmentPasswordRejected('Choose a stronger personal password.');
       if(result.error||result.data?.user?.id!==id)
         throw Error('Identity provider write unavailable');
     });
   },
   reject:async(id,hash,acceptanceId)=>{await command('reject',id,hash,acceptanceId);},
   finish:async(id,hash,acceptanceId)=>{await command('finish',id,hash,acceptanceId);},
   failed:async(id,hash,acceptanceId)=>{await command('failed',id,hash,acceptanceId);},
 };
}
