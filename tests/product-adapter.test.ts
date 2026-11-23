import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adapter,canCreateRecord,diagnostics} from '../src/modules/products/adapters.js';
test('only reviewed products resolve database tables',()=>{
  assert.equal(adapter('CRM')?.table,'crm_contacts');
  assert.equal(adapter('MUSIC')?.table,'music_requests');
  assert.equal(adapter('OTHER'),null);
  assert.equal(adapter('__proto__'),null);
  assert.equal(canCreateRecord('CRM','viewer'),false);
  assert.equal(canCreateRecord('MUSIC','musician'),false);
  assert.equal(canCreateRecord('MUSIC','staff'),true);
  assert.equal(diagnostics('CRM').externalHealth,'unverified');
});
