import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookies, sessionSetCookie, expireCookies } from '../src/modules/auth/cookies.js';
import type { FastifyRequest } from 'fastify';
const request=(header:string)=>({headers:{cookie:header}} as FastifyRequest);
test('session cookies are allowlisted, opaque and duplicate-resistant',()=>{
  assert.deepEqual({...sessionCookies(request('vsph.portal.sid='+'a'.repeat(43)+'; attack=anything'))},
    {'vsph.portal.sid':'a'.repeat(43)});
  assert.throws(()=>sessionCookies(request('vsph.portal.sid='+'a'.repeat(43)+'; vsph.portal.sid='+'b'.repeat(43))));
  assert.throws(()=>sessionCookies(request('vsph.portal.sid=invalid')));
});
test('signed cookies preserve legacy prefix and security flags',()=>{
  const header=sessionSetCookie('vsph.portal.sid','A'.repeat(43),true,14400);
  assert.match(header,/HttpOnly; SameSite=Lax; Max-Age=14400; Secure$/);
  assert.equal(expireCookies({'vsph.crm.sid':'x'.repeat(43)},true).length,3);
  assert.throws(()=>sessionSetCookie('malicious','A'.repeat(43),true,14400));
});
