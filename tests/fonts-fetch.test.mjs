// scripts/fonts.mjs gets the shell's face from Fontshare on every check and deploy. One reset
// connection there failed a whole CI run (2026-10-31), so its fetch tries again; these pin how.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patient } from '../scripts/fonts.mjs';

const reset = () => Object.assign(new TypeError('fetch failed'), { cause: new Error('read ECONNRESET') });

test('a dropped connection is tried again after 2, 4 and 8 seconds, then answers', async () => {
  const waits = [];
  let calls = 0;
  const get = async () => (++calls < 4 ? Promise.reject(reset()) : new Response('ok'));
  const res = await patient('https://example.test/a', 1000, 4, async (n) => waits.push(n), get);
  assert.equal(await res.text(), 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test('after the last try the error stands', async () => {
  let calls = 0;
  const get = async () => { calls++; throw reset(); };
  await assert.rejects(patient('https://example.test/b', 1000, 3, async () => {}, get), /fetch failed/);
  assert.equal(calls, 3);
});

test('a 5xx is tried again; a 4xx is final at once', async () => {
  let calls = 0;
  const flaky = async () => new Response('', { status: ++calls < 2 ? 503 : 200 });
  assert.equal((await patient('https://example.test/c', 1000, 4, async () => {}, flaky)).status, 200);
  assert.equal(calls, 2);
  calls = 0;
  const gone = async () => { calls++; return new Response('', { status: 404 }); };
  assert.equal((await patient('https://example.test/d', 1000, 4, async () => {}, gone)).status, 404);
  assert.equal(calls, 1);
});
