// Back-off through the real endpoints (SIGN-IN.md §6.1 acceptance). Time moves by ageing the
// stored counters, so nothing here waits on a real clock.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import * as flows from '../../src/areas/auth/flows';
import { noBreachCheck } from '../../src/areas/auth/passwords';
import { MINUTE, SECOND } from '../../src/lib/time';
import { Db, Meter } from '../../src/objects/base';
import {
  ageCounters,
  api,
  auth,
  authSql,
  counter,
  DEVICE,
  inAuth,
  login,
  PASSWORD,
  rowsDuring,
  setupOwner,
  USERNAME,
} from '../helpers';

const wrong = (ip: string, username = USERNAME) =>
  api('POST', '/v1/auth/login', { ip, body: { username, password: 'definitely not it, sorry', device: DEVICE } });

async function expectLimited(res: Response, maxSeconds: number, scope?: 'source' | 'account') {
  expect(res.status).toBe(429);
  const body = (await res.json()) as ErrorBody;
  expect(body.error.code).toBe('rate_limited');
  const retry = Number(res.headers.get('Retry-After'));
  expect(body.error.retry_after).toBe(retry);
  if (scope) expect(body.error.scope).toBe(scope);
  expect(retry).toBeGreaterThan(0);
  expect(retry).toBeLessThanOrEqual(maxSeconds);
  return retry;
}

const srcRow = async () => (await counter('signin:')).filter((r) => r.key !== 'signin:acct')[0];
const reset = () => authSql('DELETE FROM throttle');

beforeAll(async () => {
  await setupOwner();
  await reset();
});

describe('per source', () => {
  const A = '192.0.2.50';

  it('5 failures, then the 6th waits 2 s; an early attempt is not counted', async () => {
    for (let i = 0; i < 6; i++) expect((await wrong(A)).status).toBe(401);
    expect(await srcRow()).toMatchObject({ fails: 6 });
    expect(await expectLimited(await wrong(A), 2, 'source')).toBe(2);
    await ageCounters(1 * SECOND);
    expect(await expectLimited(await wrong(A), 1, 'source')).toBe(1); // still 1 s, not extended
    expect(await srcRow()).toMatchObject({ fails: 6 });
  });

  it('refuses even the right password while waiting, without hashing or writing', async () => {
    const t0 = Date.now();
    const rows = await rowsDuring(auth(), async () => expectLimited(await login(A), 2));
    expect(rows.written).toBe(0);
    expect(Date.now() - t0).toBeLessThan(150);
  });

  it('gives the same 429 for an unknown username', async () => {
    await expectLimited(await wrong(A, 'nobody-here'), 2);
  });

  it('then 4 s, 8 s, and never more than 15 min', async () => {
    await ageCounters(2 * SECOND);
    expect((await wrong(A)).status).toBe(401);
    expect(await expectLimited(await wrong(A), 4)).toBe(4);
    await ageCounters(4 * SECOND);
    expect((await wrong(A)).status).toBe(401);
    expect(await expectLimited(await wrong(A), 8)).toBe(8);
    await authSql(
      "UPDATE throttle SET fails = 30, next_allowed_at = 0 WHERE key LIKE 'signin:%' AND key <> 'signin:acct'",
    );
    expect((await wrong(A)).status).toBe(401);
    expect(await expectLimited(await wrong(A), 15 * 60)).toBe(15 * 60);
  });

  it('does not slow down other sources; IPv6 /64 is one source', async () => {
    expect((await login('192.0.2.52')).status).toBe(200);
    await reset();
    for (let i = 0; i < 6; i++) expect((await wrong(`2001:db8::${i + 1}`)).status).toBe(401);
    await expectLimited(await wrong('2001:db8::abcd'), 2);
    expect((await wrong('2001:db8:0:1::1')).status).toBe(401);
  });

  it('forgets a source after 24 h of quiet', async () => {
    await ageCounters(24 * 60 * MINUTE);
    expect((await wrong('2001:db8::1')).status).toBe(401);
    expect(Math.max(...(await counter('signin:')).filter((r) => r.key !== 'signin:acct').map((r) => r.fails))).toBe(1);
  });

  it('a success from A clears A and the account counter', async () => {
    await reset();
    for (let i = 0; i < 3; i++) await wrong(A);
    expect((await login(A)).status).toBe(200);
    expect(await authSql('SELECT key FROM throttle')).toEqual([]);
  });
});

describe('account-wide floor', () => {
  it('20 failures over sources B–U, then the right password from V within 30 s gets 429 account ≤ 30 s', async () => {
    await reset();
    for (let i = 0; i < 20; i++) expect((await wrong(`192.0.2.${60 + i}`)).status).toBe(401);
    expect(await expectLimited(await login('192.0.2.90'), 30, 'account')).toBeLessThanOrEqual(30);
    await ageCounters(30 * SECOND);
    expect((await login('192.0.2.90')).status).toBe(200); // never more than 30 s
  });

  it('never makes the owner wait more than 30 s, however many failures', async () => {
    await reset();
    const now = Date.now();
    await authSql("INSERT INTO throttle VALUES ('signin:acct', 5000, ?, ?, 0)", now, now);
    expect((await wrong('192.0.2.91')).status).toBe(401);
    expect(await expectLimited(await login('192.0.2.92'), 30, 'account')).toBeLessThanOrEqual(30);
  });

  it('commits the attempt before the hash runs, so a request cut off mid-hash still counts', async () => {
    await reset();
    const seen: unknown[] = [];
    const result = await inAuth((_o, state) => {
      const db = new Db(state.storage.sql, new Meter());
      const storage = new Proxy(state.storage, {
        get(target, prop) {
          if (prop === 'sync')
            return () => {
              seen.push(db.all("SELECT key = 'signin:acct' AS acct, fails FROM throttle ORDER BY acct"));
              return target.sync();
            };
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const deps = {
        db,
        storage,
        pepper: env.AUTH_PEPPER,
        ipKey: env.IP_HASH_KEY,
        setupFp: null,
        resetFp: null,
        breached: noBreachCheck,
      };
      return flows.login(
        deps,
        { username: USERNAME, password: PASSWORD, device: {} },
        { ip: '192.0.2.93', country: null, region: null },
      );
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      [
        { acct: 0, fails: 1 },
        { acct: 1, fails: 1 },
      ],
    ]);
    expect(await authSql('SELECT key FROM throttle')).toEqual([]);
  });
});
