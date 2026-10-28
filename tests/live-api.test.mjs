// Checks the deployed API from outside, read-only (TESTING.md §11, OPERATIONS.md §5.1 step 6.3):
// health shape and tag, the CORS preflight from the site, 403 from a foreign origin, 401
// without a token. Runs only when WORKER_URL is set (the Deploy workflow sets it, plus
// SITE_ORIGIN and EXPECTED_TAG). It never signs in and never writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const api = process.env.WORKER_URL?.replace(/\/$/, '');
const site = process.env.SITE_ORIGIN;
const tag = process.env.EXPECTED_TAG;
const opts = { skip: !api && 'WORKER_URL not set' };
const get = (path, init) => fetch(api + path, { signal: AbortSignal.timeout(15000), ...init });

test('health has the documented shape and the expected tag', opts, async () => {
  const res = await get('/v1/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['at', 'min_client', 'ok', 'version']);
  assert.equal(body.ok, true);
  if (tag) assert.equal(body.version.tag, tag);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a preflight from the site is allowed exactly', { skip: (!api || !site) && 'WORKER_URL or SITE_ORIGIN not set' }, async () => {
  const res = await get('/v1/auth/login', {
    method: 'OPTIONS',
    headers: { Origin: site, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,th-client' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), site);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
});

test('a foreign origin gets 403 with no CORS headers', opts, async () => {
  const res = await get('/v1/health', { headers: { Origin: 'https://example.com' } });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('a guarded route without a token is 401, an unknown route 404', opts, async () => {
  assert.equal((await get('/v1/auth/sessions')).status, 401);
  assert.equal((await get('/v1/nothing-here')).status, 404);
});
