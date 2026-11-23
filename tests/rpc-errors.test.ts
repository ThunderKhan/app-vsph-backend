import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RpcError,classifyRpcError} from '../src/repositories/rpc-errors.js';
test('legacy RPC errors preserve safe HTTP status boundaries',()=>{
 for(const [state,status] of [['42501',403],['P0002',404],['23505',409],
   ['40001',409],['22023',400],['42P01',503],['PGRST202',503]] as const)
   assert.equal(classifyRpcError(new RpcError(state)).status,status);
 assert.equal(classifyRpcError(new RpcError('unexpected')).status,503);
});
