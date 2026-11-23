/** Frozen services/rpc.js safe SQLSTATE response mapping; never expose raw database messages. */
export class RpcError extends Error {
  readonly name='RpcError';
  constructor(public readonly state:string){super('Database command failed');}
}
const states:Record<string,number>={
  '42501':403,'P0002':404,'23505':409,'40001':409,'22023':400,
  '22P02':400,'22007':400,'22008':400,'23502':400,'23514':400,'23503':400,
};
const schemaStates=new Set(['42703','42P01','42883','PGRST202','PGRST204','PGRST205']);
export function classifyRpcError(error:RpcError):{status:number;body:{message:string;code:string}} {
 if(schemaStates.has(error.state))return {status:503,body:{code:'SCHEMA_NOT_READY',
   message:'Database schema is not ready for this application version.'}};
 const status=states[error.state];
 if(!status)return {status:503,body:{code:'SERVICE_UNAVAILABLE',message:'Service temporarily unavailable.'}};
 return {status,body:{code:status===409?'CONFLICT':status===403?'ACCESS_DENIED':status===404?'NOT_FOUND':'INVALID_REQUEST',
   message:status===409?'Conflict: reload and reconcile the current state.':
     status===403?'Access denied or invitation unavailable.':
     'Invalid request or unavailable record.'}};
}
