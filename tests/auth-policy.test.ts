import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken, newSessionToken, applicationCookie } from '../src/modules/auth/session-tokens.js';
import { permittedContexts } from '../src/modules/auth/entitlements.js';
import { resolvePortalSession } from '../src/modules/auth/portal-session.js';
import { verifyIdentity } from '../src/modules/auth/verify-identity.js';
import type { IdentityProvider } from '../src/modules/auth/identity-provider.js';

const now = Date.parse('2026-11-12T00:00:00Z');
test('legacy 256-bit opaque token is hashed, never stored raw', () => {
  const raw = newSessionToken();
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashSessionToken(raw), /^[a-f0-9]{64}$/);
  assert.notEqual(raw, hashSessionToken(raw));
  assert.equal(applicationCookie('CRM'), 'vsph.crm.sid');
});
test('portal session rejects revoked, expired, cross-user, or disabled identities', async () => {
  const raw = newSessionToken(), hash = hashSessionToken(raw);
  const user = { id: 'actor', full_name: 'Actor', email: 'a@example.test',
    platform_role: null, status: 'active' };
  const record = { token_hash: hash, user_id: 'actor', profile: user,
    expires_at: '2026-11-12T01:00:00Z' };
  const store = (row: typeof record | null) => ({ findByTokenHash: async () => row });
  assert.equal((await resolvePortalSession(raw, store(record), now)).user.id, 'actor');
  for (const bad of [null, { ...record, user_id: 'other' },
    { ...record, expires_at: '2026-11-12T00:00:00Z' },
    { ...record, profile: { ...user, status: 'disabled' } }]) {
    await assert.rejects(resolvePortalSession(raw, store(bad), now));
  }
});
test('cross-tenant product access requires every active entitlement', () => {
  const input = {
    user: { id:'user', status:'active' }, app: { id:'crm', status:'active' },
    organizations: [{ id:'A', status:'active' }],
    subscriptions: [{ organization_id:'A',application_id:'crm',status:'active' }],
    grants: [{ organization_id:'A',application_id:'crm',status:'enabled' }],
    memberships: [{ organization_id:'A',user_id:'user',status:'active' }],
    roles: [{ organization_id:'A',user_id:'user',application_id:'crm',role_code:'manager' }],
    nowMs: now,
  };
  assert.equal(permittedContexts(input).length, 1);
  for (const field of ['subscriptions','grants','memberships','roles'] as const) {
    assert.equal(permittedContexts({ ...input, [field]: [] }).length, 0, field);
  }
  assert.equal(permittedContexts({ ...input,
    memberships: [{organization_id:'B',user_id:'user',status:'active'}] }).length, 0);
  assert.equal(permittedContexts({ ...input, user: { id:'user',status:'disabled' } }).length, 0);
});
function provider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    signIn: async () => ({data:{userId:'actor',sessionToken:true},error:null}),
    getUser: async () => ({data:{id:'actor',email:'a@example.test'},error:null}),
    getAssurance: async () => ({data:{currentLevel:'aal1',nextLevel:'aal1'},error:null}),
    listFactors: async () => ({data:[],error:null}),
    verifyFactor: async () => ({data:{verified:true},error:null}),
    getUserAfterMfa: async () => ({data:{id:'actor',email:'a@example.test'},error:null}),
    signOutLocal: async () => ({data:null,error:null}), ...overrides,
  };
}
test('identity verifier checks subject, signs out, and requires enrolled TOTP', async () => {
  let signedOut = 0;
  const ordinary = provider({signOutLocal: async () => {signedOut++;return {data:null,error:null};}});
  assert.equal((await verifyIdentity({email:'a@example.test',password:'secret'},()=>ordinary)).user.id,'actor');
  assert.equal(signedOut,1);
  await assert.rejects(verifyIdentity({email:'a@example.test',password:'secret'},
    ()=>ordinary,{expectedUserId:'other'}),{code:'IDENTITY_MISMATCH'});
  assert.equal(signedOut,2);
  const required=provider({
    getAssurance:async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null}),
    listFactors:async()=>({data:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name:'Authenticator',type:'totp',status:'verified'}],error:null}),
  });
  await assert.rejects(verifyIdentity({email:'a@example.test',password:'secret'},()=>required),
    {code:'MFA_REQUIRED'});
  await assert.rejects(verifyIdentity({email:'a@example.test',password:'secret'},()=>provider({
    signOutLocal:async()=>({data:null,error:{status:503}}),
  })),{code:'AUTH_UNAVAILABLE'});
});
