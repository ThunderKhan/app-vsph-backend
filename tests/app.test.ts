import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config.js';
const env = parseEnv({ NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000' });

test('unconfigured health never claims readiness', async () => {
  const app = buildApp(env);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'not_configured', database: false,
      releaseReady: false, scope: 'database-connectivity-only' });
  } finally { await app.close(); }
});
test('API rejects malformed credentials, missing provider, and cross-origin writes', async () => {
  const app = buildApp(env);
  try {
    const missing = await app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' }, payload: { email: 'a@test.invalid' } });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, 'INVALID_CREDENTIAL_FIELDS');
    const unavailable = await app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: 'a@test.invalid', password: 'test-only-not-real' } });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.headers['set-cookie'], undefined);
    const forbidden = await app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { origin: 'https://evil.invalid' }, payload: {} });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().code, 'ORIGIN_DENIED');
  } finally { await app.close(); }
});
test('configured readiness reflects only a real injected connectivity result', async () => {
  const configured = parseEnv({ NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'not-a-real-secret',
    SUPABASE_PUBLISHABLE_KEY: 'not-a-real-public-key' });
  const app = buildApp(configured, { checkDatabase: async () => false });
  try {
    const result = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().releaseReady, false);
  } finally { await app.close(); }
});
test('environment fails closed on partial credentials and untrusted origin', () => {
  assert.throws(() => parseEnv({ SUPABASE_URL: 'https://example.supabase.co' }));
  assert.throws(() => parseEnv({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://localhost:3000' }));
  assert.throws(() => parseEnv({ PUBLIC_ORIGIN: 'https://evil.test/path' }));
});
