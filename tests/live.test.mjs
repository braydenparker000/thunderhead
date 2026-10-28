// Checks the deployed site from outside: the expected commit is live, pages carry their CSP,
// and missing files get a real 404. Runs only when SITE_URL is set (the Deploy workflow sets
// it, plus EXPECTED_COMMIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const site = process.env.SITE_URL?.replace(/\/$/, '');
const expected = process.env.EXPECTED_COMMIT;
const opts = { skip: !site && 'SITE_URL not set' };
const get = (path, init) => fetch(site + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });

test('the expected commit is live', opts, async () => {
  let live = '';
  for (let attempt = 1; attempt <= 12; attempt++) {
    try { live = (await (await get(`/release.json?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).json()).commit; } catch {}
    if (!expected || live === expected) break;
    await new Promise(r => setTimeout(r, 5000));
  }
  if (expected) assert.equal(live, expected);
  else assert.match(live, /^[0-9a-f]{40}$/);
});

test('the home page arrives with its CSP and the right type', opts, async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /http-equiv="Content-Security-Policy"/);
  for (const [path, type] of [['/apps/home/home.js', /javascript/], ['/apps/home/home.css', /text\/css/], ['/ui/fonts/Inter.woff2', /font\/woff2/]]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type') ?? '', type, `${path} content type`);
  }
});

test('missing files get a 404', opts, async () => {
  assert.equal((await get('/no-such-file.js')).status, 404);
});

test('the sign-in pages are there with their own CSP', opts, async () => {
  for (const path of ['/signin/', '/setup/', '/recover/']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src /, path);
  }
  const config = await get('/config.js');
  assert.equal(config.status, 200);
  assert.match(await config.text(), /export const CONFIG = /);
});
