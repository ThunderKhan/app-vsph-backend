import type {Env} from '../../config.js';
import {serviceDatabase} from '../../repositories/supabase.js';
import {RpcError} from '../../repositories/rpc-errors.js';
import type {WorkspaceCountStore} from './store.js';

export function supabaseWorkspaceCountStore(env:Env):WorkspaceCountStore {
 return {async count(actor,platformOwner){
  const db=serviceDatabase(env);
  if(platformOwner){
   const {count,error}=await db.from('organizations').select('*',{count:'exact',head:true});
   if(error)throw new RpcError(error.code??'UNKNOWN');
   if(count===null||!Number.isSafeInteger(count)||count<0)throw Error('Invalid workspace count');
   return {count};
  }
  const membership=await db.from('organization_memberships').select('organization_id')
   .eq('user_id',actor).eq('status','active');
  if(membership.error)throw new RpcError(membership.error.code??'UNKNOWN');
  if(!Array.isArray(membership.data))throw Error('Invalid workspace memberships');
  const ids=membership.data.map(x=>x.organization_id);
  if(ids.length===0)return {count:0};
  const orgs=await db.from('organizations').select('id').in('id',ids).eq('status','active');
  if(orgs.error)throw new RpcError(orgs.error.code??'UNKNOWN');
  if(!Array.isArray(orgs.data))throw Error('Invalid workspace organizations');
  return {count:orgs.data.length};
 }};
}
