// scripts/worker-secrets.mjs: the bootstrap file makes the two keys and `none` for the rest; a
// normal deploy adds `none` only for names the live Worker lacks and never remakes a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan, requiredSecrets } from '../scripts/worker-secrets.mjs';

const required = requiredSecrets(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));

test('wrangler.jsonc lists the P1 secrets and the P2 mind-chat trigger', () => {
  assert.deepEqual(required, [
    'AUTH_PEPPER',
    'IP_HASH_KEY',
    'AUTH_SETUP_FP',
    'AUTH_RESET_FP',
    'ROUTINE_CHAT_URL',
    'ROUTINE_CHAT_TOKEN',
  ]);
});

test('bootstrap: random keys, none for every other name', () => {
  const a = plan(required, { bootstrap: true });
  const b = plan(required, { bootstrap: true });
  assert.match(a.AUTH_PEPPER, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.AUTH_PEPPER, b.AUTH_PEPPER);
  assert.notEqual(a.AUTH_PEPPER, a.IP_HASH_KEY);
  assert.equal(a.AUTH_SETUP_FP, 'none');
  assert.equal(a.AUTH_RESET_FP, 'none');
  assert.equal(a.ROUTINE_CHAT_URL, 'none');
});

test('normal deploy: none only for missing names; a missing key fails', () => {
  const live = ['AUTH_PEPPER', 'IP_HASH_KEY', 'AUTH_SETUP_FP'].map((name) => ({ name, type: 'secret_text' }));
  // The first P2 deploy onto a P1 Worker: the mind-chat trigger arrives as `none` (not connected).
  assert.deepEqual(plan(required, { bootstrap: false, live }), {
    AUTH_RESET_FP: 'none',
    ROUTINE_CHAT_URL: 'none',
    ROUTINE_CHAT_TOKEN: 'none',
  });
  const all = [...live, ...['AUTH_RESET_FP', 'ROUTINE_CHAT_URL', 'ROUTINE_CHAT_TOKEN'].map((name) => ({ name }))];
  assert.deepEqual(plan(required, { bootstrap: false, live: all }), {});
  assert.throws(() => plan(required, { bootstrap: false, live: live.slice(1) }), /AUTH_PEPPER/);
});
