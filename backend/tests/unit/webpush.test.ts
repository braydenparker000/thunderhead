// Web Push's own code (backend/src/lib/webpush.ts; SECURITY.md §10) checked from the phone's side:
// a payload encrypted here decrypts with the phone's key and auth secret by RFC 8291's steps; the
// VAPID header's JWT verifies with the public key it names, for the push service's origin, with the
// site as `sub`; only known push services are accepted. And the push rules (BEHAVIOR.md §3.4, VL-3)
// on a fixed clock: 06:29 is quiet hours, a third nudge is over budget, 90 minutes is too soon, a
// topic pushed in 14 days is a repeat; a nudge waits while a phone shows Thunderhead or the owner
// just wrote; a sign-in notice waits only for quiet hours; a test always goes.
import { describe, expect, it } from 'vitest';
import { mayGo, type PushContext, refusal } from '../../src/areas/push/rules';
import { QUIET_DEFAULT } from '../../src/areas/settings/quiet';
import { encrypt, fromB64u, pushService, vapid, vapidHeader, vapidPublic } from '../../src/lib/webpush';
import { phone, received } from '../push-helpers';

const enc = new TextEncoder();

describe('Web Push', () => {
  it('a payload decrypts on the phone', async () => {
    const p = await phone();
    const body = await encrypt('{"k":"nudge","id":"abc12345"}', p.keys.p256dh, p.keys.auth);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await received(p, body)).toBe('{"k":"nudge","id":"abc12345"}');
  });

  it('the VAPID header verifies with the key it names', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const secret = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    const v = await vapid(secret);
    if (!v) throw new Error('no key');
    expect(vapidPublic(secret)).toBe(v.publicKey);
    expect(await vapid('none')).toBeNull();
    const now = Date.UTC(2026, 9, 30, 12);
    const h = await vapidHeader(v, 'https://fcm.googleapis.com/fcm/send/abc', 'https://site.example.test', now);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h) ?? [];
    expect(k).toBe(v.publicKey);
    const [head, claims, sig] = jwt.split('.');
    const pub = await crypto.subtle.importKey('raw', fromB64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        fromB64u(sig),
        enc.encode(`${head}.${claims}`),
      ),
    ).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(fromB64u(claims)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://site.example.test',
    });
  });

  it('only known push services', () => {
    expect(pushService('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(pushService('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://evil.example/x',
      'https://127.0.0.1/x',
      'nope',
    ])
      expect(pushService(bad)).toBe(false);
  });
});

describe('push rules (VL-3)', () => {
  const at = (h: number, m: number) => Date.UTC(2026, 9, 30, h, m);
  const ctx = (now: number, more: Partial<PushContext> = {}): PushContext => ({
    now,
    tz: 'UTC',
    quiet: QUIET_DEFAULT,
    quiet_until: 0,
    looking: false,
    owner_at: null,
    ...more,
  });
  const none = { today: 0, last_at: null, repeat: false };

  it('refuses at 06:29, a third a day, 90 minutes after another, a repeated topic', () => {
    expect(refusal(ctx(at(6, 29)), none)).toBe('quiet_hours');
    expect(refusal(ctx(at(6, 30)), none)).toBeNull();
    expect(refusal(ctx(at(12, 0)), { ...none, today: 2 })).toBe('push_budget');
    expect(refusal(ctx(at(12, 0)), { ...none, today: 1, last_at: at(10, 30) })).toBe('push_gap');
    expect(refusal(ctx(at(12, 0)), { ...none, today: 1, last_at: at(10, 0) })).toBeNull();
    expect(refusal(ctx(at(12, 0)), { ...none, repeat: true })).toBe('nudge_repeat');
    expect(refusal(ctx(at(22, 0)), none)).toBe('quiet_hours');
  });

  it('a nudge waits for a pause; a notice for quiet hours to end; a test goes', () => {
    expect(mayGo('nudge', ctx(at(12, 0)))).toBe(true);
    expect(mayGo('nudge', ctx(at(12, 0), { looking: true }))).toBe(false);
    expect(mayGo('nudge', ctx(at(12, 0), { owner_at: at(11, 57) }))).toBe(false);
    expect(mayGo('nudge', ctx(at(12, 0), { owner_at: at(11, 55) }))).toBe(true);
    expect(mayGo('security', ctx(at(5, 0)))).toBe(false);
    expect(mayGo('security', ctx(at(12, 0), { looking: true }))).toBe(true);
    expect(mayGo('test', ctx(at(3, 0), { looking: true }))).toBe(true);
  });

  it('while the owner has said "go quiet" no nudge is taken or sent; notices and tests are not held', () => {
    const quiet = { quiet_until: at(14, 0) };
    expect(refusal(ctx(at(12, 0), quiet), none)).toBe('quiet');
    expect(mayGo('nudge', ctx(at(12, 0), quiet))).toBe(false);
    expect(mayGo('security', ctx(at(12, 0), quiet))).toBe(true);
    expect(mayGo('test', ctx(at(12, 0), quiet))).toBe(true);
    expect(refusal(ctx(at(14, 0), quiet), none)).toBeNull();
    expect(mayGo('nudge', ctx(at(14, 0), quiet))).toBe(true);
  });
});
