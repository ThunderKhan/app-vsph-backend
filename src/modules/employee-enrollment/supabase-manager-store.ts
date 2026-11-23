import {randomBytes} from 'node:crypto';
import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {ManagerEnrollmentStore} from './manager-store.js';

async function bounded<T>(operation:()=>Promise<T>):Promise<T>{
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation(),new Promise<T>((_,reject)=>{
   timeout=setTimeout(()=>reject(new Error('Identity provider timeout')),15000);
 })]);}finally{if(timeout)clearTimeout(timeout);}
}
export function supabaseManagerEnrollmentStore(env:Env):ManagerEnrollmentStore {
 const db=()=>serviceDatabase(env);
 async function rpc(name:string,actor:string,action:string,id:string|null,
   data:Record<string,unknown>):Promise<unknown>{
   const result=await db().rpc(name,{p_actor:actor,p_action:action,p_id:id,p_data:data});
   if(result.error)throw new RpcError(result.error.code??'UNKNOWN');
   return result.data;
 }
 return {
   deliveryAccess:async actor=>{
     await rpc('internal_employee_command',actor,'access',null,{});
   },
   review:(actor,hash,id)=>rpc('internal_employee_enrollment',actor,'review',id,{currentHash:hash}),
   command:(actor,action,id,data)=>rpc('internal_employee_enrollment',actor,action,id,data),
   async provision(record){
     await bounded(async()=>{
       let response=await db().auth.admin.getUserById(record.authUserId);
       if(response.error?.status===404) {
         response=await db().auth.admin.createUser({
           id:record.authUserId,email:record.email,
           password:randomBytes(48).toString('base64url'),
           email_confirm:false,
           app_metadata:{vsph_employee_enrollment:record.id},
         });
       }
       const identity=response.data?.user;
       if(response.error||!identity||identity.id!==record.authUserId||
          identity.email?.toLowerCase()!==record.email.toLowerCase()||
          identity.app_metadata?.vsph_employee_enrollment!==record.id||
          Boolean(identity.email_confirmed_at))
         throw Error('Unverified employee identity provisioning');
     });
   },
 };
}
