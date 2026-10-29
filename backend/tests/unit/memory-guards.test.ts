// Stage A.5 unit checks: what MEMORY.md §13 says is never stored is refused (keys, tokens,
// passwords, card and bank numbers) without catching ordinary numbers; `fresh` turns only
// workerd's missing-method error into a 503; and the renders build each date formatter once.
import { describe, expect, it } from 'vitest';
import { neverStored } from '../../../shared/contract/memory.ts';
import { renderProfile } from '../../src/areas/memory/profile';
import type { FactRow } from '../../src/areas/memory/store';
import { type BriefInput, buildBrief } from '../../src/areas/mind/brief';
import { fresh } from '../../src/objects/rpc';

describe('never stored (MEMORY.md §13)', () => {
  it.each([
    ['a mind key', `My key is thm_${'A1b2C3d4E5'.repeat(4)}abcZz9Yy8`],
    ['a device token', `th1_${'x'.repeat(30)}`],
    ['a fingerprint', `thfp_${'Q'.repeat(43)}`],
    ['a provider key', `sk-proj-${'a1'.repeat(16)}`],
    ['a GitHub token', `ghp_${'a'.repeat(36)}`],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36P'],
    // Built at run time, so the repository's own credential scan never sees a key header here.
    ['a private key', ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ')],
    ['a recovery code', '7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC'],
    ['a password', 'Password is hunter2-Correct-Horse'],
    ['a PIN', 'my pin: 4412'],
    ['a card number', 'Card 4111 1111 1111 1111 exp 12/29'],
    ['a card without spaces', '5555555555554444'],
    ['an IBAN', 'Pay to GB82 WEST 1234 5698 7654 32'],
  ])('refuses %s', (_name, text) => {
    expect(neverStored(text)).not.toBeNull();
  });

  it.each([
    'Wants the second piece at 100 bpm by the end of the month',
    'Practises 30 minutes after lunch, 5 days a week',
    'Was born in 1990 and moved in 2012',
    'Phone time 06:30 to 07:15',
    'Order number 1234567890123456 is not a card (fails Luhn)',
    'Likes the passing lane on the motorway',
    'The password manager is called Vault',
  ])('keeps "%s"', (text) => {
    expect(neverStored(text)).toBeNull();
  });
});

describe('fresh() only for the method an older object lacks', () => {
  it("maps workerd's exact error to 503, and lets every other TypeError through as the bug it is", async () => {
    await expect(
      fresh(Promise.reject(new TypeError('The RPC receiver does not implement "profile".'))),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(fresh(Promise.reject(new TypeError('r.decisions.map is not a function')))).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(fresh(Promise.reject(new TypeError('x does not implement y')))).rejects.toBeInstanceOf(TypeError);
  });
});

describe('the renders build each date formatter once (briefing CPU)', () => {
  it('2,000 facts and a full briefing construct at most a handful of Intl.DateTimeFormat', () => {
    const Real = Intl.DateTimeFormat;
    let made = 0;
    const Counting = function (this: unknown, ...a: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      made++;
      return new Real(...a);
    } as unknown as typeof Intl.DateTimeFormat;
    const now = Date.UTC(2026, 10, 3, 12);
    const rows: FactRow[] = Array.from({ length: 2_000 }, (_, i) => ({
      seq: i,
      id: `0192f0c4-0000-7000-8000-${i.toString(16).padStart(12, '0')}`,
      kind: 'preference',
      about: 'owner',
      subject: null,
      text: `Synthetic preference ${i}`,
      tags_json: null,
      source: 'user',
      confidence: 0.95,
      evidence_json: '[]',
      valid_from: null,
      valid_to: null,
      recorded_at: now - i * 60_000,
      superseded_at: null,
      superseded_by: null,
      last_confirmed: now,
      sensitivity: 0,
      pinned: 0,
      may_raise: 1,
      written_by: 'owner',
      ledger_id: null,
      lineage_id: `l${i}`,
    }));
    Intl.DateTimeFormat = Counting;
    try {
      const tz = 'Pacific/Chatham'; // a zone no other test formats in, so the caches start empty
      renderProfile(rows, now, tz);
      const input = {
        role: 'chat',
        constitution: 'none',
        now,
        tz,
        day: '2026-11-03',
        wakeReason: null,
        wakesToday: 0,
        prewarmsLeft: 8,
        backoffUntil: 0,
        threadId: null,
        waiting: [],
        todayTail: [],
        todayEarlier: [],
        note: null,
        yesterday: { threadId: null, tail: [], note: null },
        ledger: [],
        errorsOpen: 0,
        rules: rows.slice(0, 60).map((r) => ({ ...r, kind: 'rule' as const })),
        threads: [],
        profile: '',
        days: [],
        night: null,
      } satisfies BriefInput;
      buildBrief(input);
      buildBrief(input);
      expect(made).toBeLessThanOrEqual(4);
    } finally {
      Intl.DateTimeFormat = Real;
    }
  });
});
