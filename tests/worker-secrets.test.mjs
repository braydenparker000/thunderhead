// scripts/worker-secrets.mjs: the bootstrap file makes the two keys and `none` for the rest; a
// normal deploy adds `none` only for names the live Worker lacks and never remakes a key. The Web
// Push key (P8) is made, a new P-256 private JWK, whenever the live Worker lacks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan, requiredSecrets } from '../scripts/worker-secrets.mjs';

const required = requiredSecrets(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));

test('wrangler.jsonc lists the P1 secrets, the mind-chat (P2), mind-night (P3) and mind-reflex (P4) triggers, the media signing key and the upload tools’ keys (P5)', () => {
  assert.deepEqual(required, [
    'AUTH_PEPPER',
    'IP_HASH_KEY',
    'AUTH_SETUP_FP',
    'AUTH_RESET_FP',
    'ROUTINE_CHAT_URL',
    'ROUTINE_CHAT_TOKEN',
    'ROUTINE_NIGHT_URL',
    'ROUTINE_NIGHT_TOKEN',
    'ROUTINE_REFLEX_URL',
    'ROUTINE_REFLEX_TOKEN',
    'R2_SIGN_ACCESS_KEY_ID',
    'R2_SIGN_SECRET',
    'MUSIC_UPLOAD_PUBLIC_KEYS',
    'VAPID_PRIVATE_JWK',
  ]);
});

/** A normal deploy's plan without the Web Push key, after checking it is a fresh P-256 private JWK wherever it is made. */
function planned(live) {
  const { VAPID_PRIVATE_JWK: made, ...rest } = plan(required, { bootstrap: false, live });
  if (!live.some((s) => s.name === 'VAPID_PRIVATE_JWK')) {
    const j = JSON.parse(made);
    assert.deepEqual([j.kty, j.crv, typeof j.d, typeof j.x, typeof j.y], ['EC', 'P-256', 'string', 'string', 'string']);
    assert.notEqual(made, plan(required, { bootstrap: false, live }).VAPID_PRIVATE_JWK);
  } else assert.equal(made, undefined);
  return rest;
}

test('bootstrap: random keys, none for every other name', () => {
  const a = plan(required, { bootstrap: true });
  const b = plan(required, { bootstrap: true });
  assert.match(a.AUTH_PEPPER, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.AUTH_PEPPER, b.AUTH_PEPPER);
  assert.notEqual(a.AUTH_PEPPER, a.IP_HASH_KEY);
  assert.equal(a.AUTH_SETUP_FP, 'none');
  assert.equal(a.AUTH_RESET_FP, 'none');
  assert.equal(a.ROUTINE_CHAT_URL, 'none');
  assert.equal(JSON.parse(a.VAPID_PRIVATE_JWK).crv, 'P-256');
});

test('normal deploy: none only for missing names; a missing key fails', () => {
  const live = ['AUTH_PEPPER', 'IP_HASH_KEY', 'AUTH_SETUP_FP'].map((name) => ({ name, type: 'secret_text' }));
  // The first P2 deploy onto a P1 Worker: the mind-chat trigger arrives as `none` (not connected).
  assert.deepEqual(planned(live), {
    AUTH_RESET_FP: 'none',
    ROUTINE_CHAT_URL: 'none',
    ROUTINE_CHAT_TOKEN: 'none',
    ROUTINE_NIGHT_URL: 'none',
    ROUTINE_NIGHT_TOKEN: 'none',
    ROUTINE_REFLEX_URL: 'none',
    ROUTINE_REFLEX_TOKEN: 'none',
    R2_SIGN_ACCESS_KEY_ID: 'none',
    R2_SIGN_SECRET: 'none',
    MUSIC_UPLOAD_PUBLIC_KEYS: 'none',
  });
  // The first P3 deploy onto a P2 Worker whose mind-chat trigger is set: only the night pair is
  // added, as `none`, and the chat pair is left as the owner set it.
  const p2 = [...live, ...['AUTH_RESET_FP', 'ROUTINE_CHAT_URL', 'ROUTINE_CHAT_TOKEN'].map((name) => ({ name }))];
  assert.deepEqual(planned(p2), {
    ROUTINE_NIGHT_URL: 'none',
    ROUTINE_NIGHT_TOKEN: 'none',
    ROUTINE_REFLEX_URL: 'none',
    ROUTINE_REFLEX_TOKEN: 'none',
    R2_SIGN_ACCESS_KEY_ID: 'none',
    R2_SIGN_SECRET: 'none',
    MUSIC_UPLOAD_PUBLIC_KEYS: 'none',
  });
  // The first P4 stage D deploy onto a P3 Worker: the reflex pair (and the later signing key).
  const p3 = [...p2, ...['ROUTINE_NIGHT_URL', 'ROUTINE_NIGHT_TOKEN'].map((name) => ({ name }))];
  assert.deepEqual(planned(p3), {
    ROUTINE_REFLEX_URL: 'none',
    ROUTINE_REFLEX_TOKEN: 'none',
    R2_SIGN_ACCESS_KEY_ID: 'none',
    R2_SIGN_SECRET: 'none',
    MUSIC_UPLOAD_PUBLIC_KEYS: 'none',
  });
  // The first P5 step 2 deploy onto a P4 Worker: only the signing key, as `none` until SETUP.md N1.
  const p4 = [...p3, ...['ROUTINE_REFLEX_URL', 'ROUTINE_REFLEX_TOKEN'].map((name) => ({ name }))];
  assert.deepEqual(planned(p4), {
    R2_SIGN_ACCESS_KEY_ID: 'none',
    R2_SIGN_SECRET: 'none',
    MUSIC_UPLOAD_PUBLIC_KEYS: 'none',
  });
  // The first P5 step 3 deploy onto step 2: only the upload tools' keys, `none` until SETUP.md N4.
  const p5 = [...p4, ...['R2_SIGN_ACCESS_KEY_ID', 'R2_SIGN_SECRET'].map((name) => ({ name }))];
  assert.deepEqual(planned(p5), { MUSIC_UPLOAD_PUBLIC_KEYS: 'none' });
  // The first P8 deploy onto P7: only the Web Push key, made then (checked in `planned`).
  const all = [...p5, { name: 'MUSIC_UPLOAD_PUBLIC_KEYS' }];
  assert.deepEqual(planned(all), {});
  assert.deepEqual(planned([...all, { name: 'VAPID_PRIVATE_JWK' }]), {});
  assert.throws(() => plan(required, { bootstrap: false, live: live.slice(1) }), /AUTH_PEPPER/);
});
