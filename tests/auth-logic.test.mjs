// The sign-in logic without a browser (SIGN-IN.md §3.3, §6.2, §7.1, §11): codes and
// fingerprints match the Worker's, the client state machine takes every arrow with a fake API,
// and the words for times, places and notices come out right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError } from '../frontend/th/api.js';
import { confirmsLastFive, fingerprint, groupCode, makeCode, normalizeCode } from '../frontend/th/codes.js';
import { LINES, lineFor, REASON_LINES } from '../frontend/th/copy.js';
import { createSignin, failure, safeNext, signedOutReason, waitLabel } from '../frontend/th/flow.js';
import { lastActive, lastUsed, noticeCard, place } from '../frontend/th/format.js';
import { fromUserAgent } from '../frontend/th/device.js';
import { apiOrigin, configJs, withApi } from '../scripts/site-config.mjs';
import { readFile } from 'node:fs/promises';

const apiError = (status, code, extra = {}) => new ApiError(status, { code, message: code, request_id: 'r', ...extra });

test('codes are 25 Crockford characters and fold like the Worker does', () => {
  const code = makeCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{25}$/);
  assert.equal(normalizeCode('7kq2m-xw4tr 9dhpa-3nb6e-qy8vc'), '7KQ2MXW4TR9DHPA3NB6EQY8VC');
  assert.equal(normalizeCode('OOOOO-IIIII-LLLLL-00000-11111'), '00000111111111100000' + '11111');
  assert.equal(normalizeCode('UUUUU-UUUUU-UUUUU-UUUUU-UUUUU'), null, 'U is never valid');
  assert.equal(normalizeCode('too short'), null);
  assert.equal(groupCode('7KQ2MXW4TR9DHPA3NB6EQY8VC'), '7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC');
  assert.ok(confirmsLastFive('7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC', 'qy8vc'));
  assert.ok(confirmsLastFive('7KQ2M-XW4TR-9DHPA-3NB6E-QY80C', 'qy8oc'), 'O typed for 0');
  assert.ok(!confirmsLastFive('7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC', 'QY8V'));
});

test("a fingerprint is thfp_ + base64url(SHA-256(code)), as the Worker computes it", async () => {
  const code = makeCode();
  const fp = await fingerprint(code);
  assert.equal(fp, `thfp_${createHash('sha256').update(code).digest('base64url')}`);
  assert.match(fp, /^thfp_[A-Za-z0-9_-]{43}$/);
});

test('next is only ever a path on this site', () => {
  assert.equal(safeNext('/settings/agents/?new=ci'), '/settings/agents/?new=ci');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '', null, undefined]) assert.equal(safeNext(bad), '/');
});

test('the countdown reads seconds under a minute, then m:ss', () => {
  assert.equal(waitLabel(8), 'Try again in 8 s');
  assert.equal(waitLabel(2.2), 'Try again in 3 s');
  assert.equal(waitLabel(59), 'Try again in 59 s');
  assert.equal(waitLabel(128), 'Try again in 2:08');
});

test('the state machine takes every arrow of §3.3', async () => {
  let clock = 0, saved = null, answer;
  const store = { read: async () => saved, write: async (s) => { saved = s; } };
  const api = { login: async (body) => { if (answer instanceof Error) throw answer; assert.ok(body.device); return answer; } };
  const m = createSignin({ api, store, device: async () => ({ platform: 'Android' }), now: () => clock, online: () => true });

  assert.equal((await m.boot()).state, 'signed_out', 'BOOT, no token → SIGNED_OUT');

  answer = apiError(401, 'wrong_username_or_password');
  let v = await m.submit({ username: 'example', password: 'nope' });
  assert.equal(v.state, 'signed_out', 'SUBMITTING, 401 → SIGNED_OUT');
  assert.equal(v.line, LINES.wrong_username_or_password);
  await m.submit({ username: 'example', password: 'nope' });
  assert.equal((await m.submit({ username: 'example', password: 'nope' })).wrong, 3);

  answer = apiError(429, 'rate_limited', { retry_after: 3, scope: 'source' });
  v = await m.submit({ username: 'example', password: 'nope' });
  assert.equal(v.state, 'waiting', '429 → WAITING');
  assert.equal(v.line, LINES.rate_source);
  assert.equal(Math.ceil(v.waitLeft), 3);
  assert.equal((await m.submit({ username: 'example', password: 'x' })).state, 'waiting', 'no submit while waiting');
  clock = 2000;
  assert.equal(m.tick().state, 'waiting');
  clock = 3000;
  assert.equal(m.tick().state, 'signed_out', 'countdown 0 → SIGNED_OUT, nothing submitted');

  answer = apiError(429, 'rate_limited', { retry_after: 30, scope: 'account' });
  assert.equal((await m.submit({ username: 'example', password: 'x' })).line, LINES.rate_account);
  clock = 40_000;
  m.tick();

  answer = new TypeError('Failed to fetch');
  assert.equal((await m.submit({ username: 'example', password: 'x' })).line, LINES.network, 'network → SIGNED_OUT + line');
  answer = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  assert.equal((await m.submit({ username: 'example', password: 'x' })).line, LINES.timeout);
  answer = new ApiError(502, { code: 'unavailable', message: 'HTTP 502', request_id: '' });
  assert.equal((await m.submit({ username: 'example', password: 'x' })).line, LINES.auth_unavailable, 'non-JSON 5xx');
  answer = apiError(409, 'setup_required');
  assert.equal((await m.submit({ username: 'example', password: 'x' })).redirect, '/setup/');
  answer = apiError(426, 'client_outdated');
  assert.equal((await m.submit({ username: 'example', password: 'x' })).reload, true);

  answer = { token: 'token-from-the-fake-api', session_id: 's1', idle_days: 90 };
  v = await m.submit({ username: 'example', password: 'right' });
  assert.equal(v.state, 'signed_in', '200 → SIGNED_IN');
  assert.equal(saved.token, 'token-from-the-fake-api');
  assert.equal(v.wrong, 0);

  const m2 = createSignin({ api, store, device: async () => ({}), now: () => clock });
  assert.equal((await m2.boot()).state, 'signed_in', 'BOOT, token → SIGNED_IN');
  let wiped = false;
  v = await m2.revoked(async () => { wiped = true; saved = null; });
  assert.ok(wiped);
  assert.equal(v.state, 'signed_out', 'WIPING → SIGNED_OUT');
});

test('offline sign-in says so', async () => {
  const m = createSignin({ api: { login: async () => { throw new TypeError('Failed to fetch'); } }, store: { read: async () => null, write: async () => {} }, device: async () => ({}), online: () => false });
  await m.boot();
  assert.equal((await m.submit({ username: 'a', password: 'b' })).line, LINES.offline);
});

test('a 401 says why this device was signed out', () => {
  assert.equal(signedOutReason(failure(apiError(401, 'session_revoked', { details: { reason: 'signed_out_elsewhere' } }))), 'signed_out_elsewhere');
  assert.equal(signedOutReason(failure(apiError(401, 'session_expired'))), 'expired');
  assert.equal(signedOutReason(failure(apiError(401, 'unauthorized'))), 'unauthorized');
  assert.equal(signedOutReason(failure(apiError(401, 'current_password_wrong'))), null, 'a wrong password is not a sign-out');
  for (const r of ['expired', 'signed_out_elsewhere', 'password_changed', 'recovery_used', 'reset_used', 'device_limit', 'unauthorized']) assert.ok(REASON_LINES[r], r);
  assert.equal(lineFor({ code: 'password_breached', status: 422, kind: 'api' }), 'This password has appeared in a data breach. Choose another.');
  assert.equal(lineFor({ code: 'some_new_code', status: 500, kind: 'api' }), LINES.internal);
});

test('device list and notice words', () => {
  const now = new Date(2026, 9, 28, 15, 0).getTime();
  assert.equal(lastActive(now - 10 * 60_000, now), 'active now');
  assert.equal(lastActive(new Date(2026, 9, 28, 9, 0).getTime(), now), 'active today');
  assert.equal(lastActive(new Date(2026, 9, 27, 22, 0).getTime(), now), 'yesterday');
  assert.equal(lastActive(new Date(2026, 9, 20, 9, 0).getTime(), now), '8 days ago');
  assert.equal(lastActive(new Date(2026, 6, 1, 9, 0).getTime(), now), '1 Jul');
  assert.equal(lastUsed(null, now), 'never used');
  assert.equal(lastUsed(now - 60_000, now), 'last used now');
  const s = { region: 'Region', country: 'XX', last_country: 'XX' };
  assert.equal(place(s), 'Region, XX · approximate');
  assert.equal(place({ region: null, country: null, last_country: null }), 'Location unknown');
  const card = noticeCard({ id: 'n', kind: 'new_device', created_at: now, expires_at: null, about_session_id: 's2', args: { label: 'Windows · Edge', region: 'Region', country: 'XX', at: new Date(2026, 9, 28, 14, 5).getTime() } }, now);
  assert.equal(card.text, 'New sign-in: Windows · Edge · Region, XX · today 14:05');
  assert.deepEqual(card.buttons.map(b => b.label), ['Not me — sign it out', 'That was me']);
  assert.equal(noticeCard({ id: 'n', kind: 'agent_key_created', created_at: now, expires_at: null, about_session_id: null, args: { name: 'ci', role: 'ci', label: 'Android phone · Chrome' } }, now).text, "A new agent key 'ci' (CI) was made on Android phone · Chrome.");
  assert.deepEqual(fromUserAgent('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'), { platform: 'Android', browser: 'Chrome' });
});

test('staging fills the API host into config.js and the CSP of the shell and sign-in pages only', async () => {
  assert.throws(() => apiOrigin('http://api.example'), /https/);
  assert.match(configJs({ api: 'https://api.example/', build: 7, commit: 'abc' }), /"api":"https:\/\/api.example","build":7/);
  const shell = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const signin = await readFile(new URL('../frontend/signin/index.html', import.meta.url), 'utf8');
  assert.match(withApi(shell, 'https://api.example'), /connect-src 'self' https:\/\/api\.example;/);
  assert.match(withApi(signin, 'https://api.example'), /connect-src https:\/\/api\.example;/);
  const other = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'">';
  assert.equal(withApi(other, 'https://api.example'), other, 'a ported page keeps its own CSP');
  assert.equal(withApi(shell, ''), shell);
});
