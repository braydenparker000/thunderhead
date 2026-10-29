// Stage A.5–A.7 unit checks: what MEMORY.md §13 says is never stored is refused (keys, tokens,
// passwords, card and bank numbers) without catching everyday words ("pass", "pin",
// "PIN-protected") or ordinary numbers that happen to pass Luhn (ISBNs, timestamps, order
// numbers); `fresh` turns only workerd's missing-method error into a 503; and the renders build
// each date formatter once.
import { describe, expect, it } from 'vitest';
import { neverStored } from '../../../shared/contract/never-stored.ts';
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
    ['a password with a digit', 'My password is hunter2'],
    ['a quoted password', "The wifi password is 'open sesame'"],
    ['a passcode', 'The passcode was 1234'],
    ['a passphrase', 'passphrase: correct horse battery staple'],
    ['a PIN', 'my pin: 4412'],
    ['a PIN in capitals', 'My PIN is 4821'],
    ['a PIN code', 'pin code is 2468'],
    ['a security code', 'cvv 123'],
    // Stage A.7: a password said in one word is that word, and what it is for may come between.
    ['a one-word password', 'My password is Summer'],
    ['a one-word password at the end of a sentence', 'My password is Summer. Remember that.'],
    ['a long one-word password', 'password is correcthorsebatterystaple'],
    ['a passcode for something', 'The passcode for the gate is 4821'],
    ['a passphrase for something', 'The passphrase for the vault is correct horse battery staple'],
    ['a PIN for something', 'PIN for the card is 4821'],
    // Stage B.6: a describing word is exempt only when it is all that follows `is` or `was`.
    ['a password after a describing word', 'my password is new. It is Tr0ub4dor&3'],
    ['a password after a describing word and a semicolon', 'my password was reset; use hunter2'],
    ['a password after a describing word and a comma', 'password is strong, it is Pa55word!'],
    ['a password after a describing sentence', 'my password was strong. Now: x9!kq'],
    ['a describing word given as the value after a colon', 'Wi-Fi password: secure'],
    ['a describing word given as the value after =', 'password=simple'],
    ['a describing word with a symbol after a colon', 'password: Strong!'],
    ['a one-word password that starts like a describing word', 'my password is weak1'],
    ['a card number', 'Card 4111 1111 1111 1111 exp 12/29'],
    ['a card with dashes', 'Card 4111-1111-1111-1111'],
    ['an Amex number', 'Amex 3782 822463 10005'],
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
    // Stage A.6: the review's false positives, kept word for word.
    'The bridge pin is loose on the old guitar',
    'The second pass was cleaner than the first',
    'My bus pass is in the blue drawer',
    'Pin: practise scales before the piece',
    'Reading ISBN 9780141439518 this month',
    'Practised at 1793269074337 ms',
    'Code: the metronome app is open source',
    'Wants a passport photo: book it Friday',
    'The password manager is the blue app',
    'Practised the piece; the second pass was cleaner.',
    'PIN numbers are printed on the letter',
    // Stage A.7: hyphenated adjectives and a password word with no value after it.
    'Keeps a PIN-protected notebook',
    'A password-protected file',
    'Changed the wifi password on 2026-10-29',
    'My password is in the blue drawer',
    'A PIN is required to open it',
    'The password for my bank is long and complicated',
    // Stage B.5: a word that describes the password is not one.
    'Her password was reset',
    'My password is weak.',
    'The passcode was changed',
    'password is case-sensitive',
    'Tracking 1234567812345670 arrives Monday',
    // Stage B.6: the same with capitals, and with what it is for in between.
    'My password is WEAK',
    'The password for the gate was changed.',
    "The owner's password was reset yesterday",
  ])('keeps "%s"', (text) => {
    expect(neverStored(text)).toBeNull();
  });

  it('a Luhn-valid number is a card only when written like one or starting like one', () => {
    const luhnOk = '1234567812345670'; // passes Luhn; no card network starts with 1
    expect(neverStored(`Order ${luhnOk}`)).toBeNull();
    expect(neverStored(`Order ${luhnOk.replace(/(\d{4})(?=\d)/g, '$1 ')}`)).toBe('card');
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
        laws: 'laws: mind/CONSTITUTION.md missing',
        decisions: [],
        tainted: false,
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
        watchdogs: [],
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
