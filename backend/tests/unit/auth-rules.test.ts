// Pure auth helpers: token format and checksum (SECURITY.md §5.1 acceptance), codes and
// fingerprints, source keys, back-off arithmetic (SIGN-IN.md §6.1), password rules and the
// breach check against a fake range service (the real one is never called in tests).
import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_RE,
  fingerprint,
  ipPrefix,
  newRecoveryCode,
  normalizeCode,
  sourceKey,
  tokenHash,
} from '../../src/areas/auth/crypto';
import { HIBP_RANGE, hibpCheck, passwordProblem, usernameOk } from '../../src/areas/auth/passwords';
import { afterFailure, type Counter, type Kind, waitMs } from '../../src/areas/auth/throttle';
import { checkToken, crc32, newLiveTicket, newToken } from '../../src/areas/auth/tokens';
import { DAY, HOUR, MINUTE, SECOND } from '../../src/lib/time';

describe('tokens', () => {
  it('1,000 tokens: right format, unique, checksum valid; a mutated character fails', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = newToken('th1');
      expect(t).toMatch(/^th1_[0-9A-Za-z]{49}$/);
      expect(checkToken(t)).toBe('th1');
      seen.add(t);
      const at = 4 + (i % 49);
      const swapped = t.slice(0, at) + (t[at] === 'A' ? 'B' : 'A') + t.slice(at + 1);
      expect(checkToken(swapped)).toBeNull();
    }
    expect(seen.size).toBe(1000);
  });

  it('agent prefixes and the live ticket; a prefix swap breaks the checksum', () => {
    for (const p of ['thm', 'ths', 'thc'] as const) expect(checkToken(newToken(p))).toBe(p);
    const t = newToken('thm');
    expect(checkToken(`th1${t.slice(3)}`)).toBeNull();
    expect(newLiveTicket()).toMatch(/^thw_[0-9A-Za-z]{22}$/);
    expect(crc32('123456789')).toBe(0xcbf43926); // the standard CRC-32 check value
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('codes, fingerprints, source keys', () => {
  it('codes are 25 Crockford characters; typing is forgiving', () => {
    const code = newRecoveryCode();
    const plain = code.replace(/-/g, '');
    expect(normalizeCode(` ${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')} `)).toBe(plain);
    expect(normalizeCode('UUUUUUUUUUUUUUUUUUUUUUUUU')).toBeNull();
    expect(normalizeCode(plain.slice(1))).toBeNull();
  });

  it('fingerprints are thfp_ + base64url(SHA-256(code)), 48 characters', () => {
    const fp = fingerprint('0123456789ABCDEFGHJKMNPQR');
    expect(fp).toMatch(FINGERPRINT_RE);
    expect(fp).toHaveLength(48);
  });

  it('groups IPv6 by /64, keeps IPv4 whole, rotates daily with the key', () => {
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0:0');
    expect(ipPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    const day = '2026-10-28';
    expect(sourceKey('2001:db8::1', 'k', day)).toBe(sourceKey('2001:db8::9:9', 'k', day));
    expect(sourceKey('192.0.2.1', 'k', day)).not.toBe(sourceKey('192.0.2.1', 'k', '2026-10-29'));
    expect(sourceKey('192.0.2.1', 'k', day)).not.toBe(sourceKey('192.0.2.1', 'other', day));
  });
});

describe('back-off numbers (SIGN-IN.md §6.1)', () => {
  const t0 = Date.UTC(2026, 9, 28, 12);
  const failN = (kind: Kind, who: string, n: number): Counter => {
    let c: Counter | null = null;
    for (let i = 0; i < n; i++) c = afterFailure(c, t0, kind, who);
    return c as Counter;
  };
  const wait = (kind: Kind, who: string, n: number, at = t0) => waitMs(failN(kind, who, n), at, kind, who);

  it('sign-in per source: 5 free, then 2, 4, 8 … s, at most 15 min; quiet 24 h forgets', () => {
    expect([1, 5].map((n) => wait('signin', 'src', n))).toEqual([0, 0]);
    expect([6, 7, 8, 15, 40].map((n) => wait('signin', 'src', n))).toEqual(
      [2, 4, 8, 15 * 60, 15 * 60].map((s) => s * SECOND),
    );
    expect(afterFailure(failN('signin', 'src', 12), t0 + DAY, 'signin', 'src').fails).toBe(1);
  });

  it('sign-in account-wide: after 20 in 24 h, one try per 30 s, never longer', () => {
    expect(wait('signin', 'acct', 19)).toBe(0);
    expect(wait('signin', 'acct', 20)).toBe(30 * SECOND);
    expect(wait('signin', 'acct', 5000)).toBe(30 * SECOND);
  });

  it('codes: 5 per source per hour; account-wide 30 s × 2^(n−20) up to 5 min, never a day', () => {
    for (const kind of ['recover', 'setup'] as const) {
      expect(wait(kind, 'src', 4)).toBe(0);
      expect(wait(kind, 'src', 5)).toBe(HOUR);
      expect(wait(kind, 'src', 5, t0 + HOUR)).toBe(0);
      expect(wait(kind, 'acct', 19)).toBe(0);
      expect([20, 21, 22, 23, 24, 500].map((n) => wait(kind, 'acct', n))).toEqual(
        [30, 60, 120, 240, 300, 300].map((s) => s * SECOND),
      );
    }
  });

  it('password check in Settings: 5 per session, then 2^(n−5) s up to 15 min', () => {
    expect(wait('pwcheck', 'session', 5)).toBe(0);
    expect(wait('pwcheck', 'session', 6)).toBe(2 * SECOND);
    expect(wait('pwcheck', 'session', 30)).toBe(15 * MINUTE);
  });

  it('reset tickets requested by the mind: 3 in 30 days', () => {
    expect(wait('reset', 'acct', 2)).toBe(0);
    expect(wait('reset', 'acct', 3)).toBe(30 * DAY);
  });
});

describe('password and username rules (SIGN-IN.md §9.2)', () => {
  it('length 15–128 after NFKC, no username or app name, not the current one', () => {
    expect(passwordProblem('fifteen chars!!', 'example-owner')).toBeNull();
    expect(passwordProblem('é'.repeat(15), 'example-owner')).toBeNull(); // 15 characters after NFKC
    expect(passwordProblem('short one', 'example-owner')).toBe('password_too_short');
    expect(passwordProblem('x'.repeat(129), 'example-owner')).toBe('password_too_long');
    expect(passwordProblem('my EXAMPLE-OWNER password', 'example-owner')).toBe('password_guessable');
    expect(passwordProblem('ThunderHead forever and ever', 'example-owner')).toBe('password_guessable');
    expect(passwordProblem('the same long passphrase', 'u', 'the same long passphrase')).toBe('password_same');
  });

  it('usernames: 3–32 of a–z 0–9 . _ -', () => {
    expect(['abc', 'example.owner_1-x', 'a'.repeat(32)].every(usernameOk)).toBe(true);
    expect(['ab', 'a'.repeat(33), 'with space', 'Upper', 'ü-name'].some(usernameOk)).toBe(false);
  });

  it('the breach check sends only a 5-character prefix with padding, and reads the count', async () => {
    const calls: { url: string; padding: string | null }[] = [];
    const fake = (suffixLine: (suffix: string) => string) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, padding: new Headers(init?.headers).get('Add-Padding') });
        return new Response(`0000000000000000000000000000000000A:0\n${suffixLine(u)}\n`);
      }) as typeof fetch;
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const hit = hibpCheck(fake(() => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824'));
    expect(await hit('password')).toBe(true);
    expect(calls[0]).toEqual({ url: `${HIBP_RANGE}5BAA6`, padding: 'true' });
    expect(await hibpCheck(fake(() => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:0'))('password')).toBe(false); // padding row
    expect(await hibpCheck(fake(() => 'FFFF:3'))('password')).toBe(false);
    const down = hibpCheck((async () => new Response('', { status: 503 })) as typeof fetch);
    expect(await down('password')).toBeNull(); // no answer: accepted (SIGN-IN.md §9.2)
  });
});
