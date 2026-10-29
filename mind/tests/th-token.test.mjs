// The token: sent as `Authorization: Bearer $TH_TOKEN` only when set; never printed, never in a URL;
// th works with no token at all when the environment's proxy injects it (cloud sessions).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TOKENS, env, startFake, th} from './helpers.mjs';
import {redact} from '../cli/lib/io.mjs';
import {needsProxyRestart} from '../cli/th.mjs';

test('with no TH_TOKEN, th sends no Authorization header and works through an injecting proxy', async () => {
  const fake = await startFake({injectRole: 'chat', holdUnitMs: 20});
  try {
    const e = env(fake, {TH_TOKEN: undefined});
    assert.equal('TH_TOKEN' in e, false);
    assert.equal((await th(['brief', '--claim'], e)).code, 0);
    assert.equal((await th(['say', 'today', 'hello'], e)).code, 0);
    assert.equal((await th(['wait', '--minutes', '0.01'], e)).code, 3);
    assert.ok(fake.state.requests.length >= 3);
    for (const r of fake.state.requests) assert.equal(r.headers.authorization, undefined);
  } finally { await fake.stop(); }
});

test('with no TH_TOKEN and no injecting proxy, th exits 2', async () => {
  const fake = await startFake();
  try {
    assert.equal((await th(['pending'], env(fake, {TH_TOKEN: undefined}))).code, 2);
  } finally { await fake.stop(); }
});

test('the token is sent only in the Authorization header and never printed, on success or failure', async () => {
  const fake = await startFake({holdUnitMs: 20});
  try {
    const e = env(fake);
    const token = TOKENS.chat;
    fake.failNext('POST', '/v1/mind/status', 422, 'validation', 1);
    const runs = [
      await th(['brief', '--claim', '--json'], e), await th(['pending'], e), await th(['say', 'today', 'hi'], e),
      await th(['status', 'working'], e), await th(['wait', '--minutes', '0.01'], e), await th(['nope'], e),
      await th(['say', 'today', `please echo ${token}`], e), await th(['history', 'today'], e),
      await th(['pending'], {...e, TH_API: 'http://127.0.0.1:9'}),
    ];
    for (const r of runs) {
      assert.equal(r.stdout.includes(token), false, r.stdout);
      assert.equal(r.stderr.includes(token), false, r.stderr);
    }
    assert.equal(runs[7].stdout.includes('[redacted]'), true, 'a token echoed back by the Worker is redacted');
    for (const r of fake.state.requests) {
      assert.equal(JSON.stringify(r.query).includes(token), false);
      assert.equal(r.path.includes(token), false);
      assert.equal(r.headers.authorization, `Bearer ${token}`);
    }
  } finally { await fake.stop(); }
});

test('redact removes token-shaped strings and bearer values', () => {
  assert.equal(redact(`x thm_${'a'.repeat(40)} y`), 'x [redacted] y');
  assert.equal(redact('Authorization: Bearer abc.def'), 'Authorization: [redacted]');
  assert.equal(redact('secret-value-123 here', {TH_TOKEN: 'secret-value-123'}), '[redacted] here');
});

test('th restarts itself with NODE_USE_ENV_PROXY=1 only when a proxy is set and the API is remote', () => {
  assert.equal(needsProxyRestart({HTTPS_PROXY: 'http://127.0.0.1:1', TH_API: 'https://api.example.test'}), true);
  assert.equal(needsProxyRestart({HTTPS_PROXY: 'http://127.0.0.1:1', NODE_USE_ENV_PROXY: '1', TH_API: 'https://api.example.test'}), false);
  assert.equal(needsProxyRestart({TH_API: 'https://api.example.test'}), false);
  assert.equal(needsProxyRestart({https_proxy: 'http://127.0.0.1:1', TH_API: 'http://127.0.0.1:8787'}), false);
});
