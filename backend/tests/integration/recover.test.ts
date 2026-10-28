// Forgotten password (SIGN-IN.md §8) and its back-off: the recovery code resets the password,
// signs every session out and is used up; codes never lock the account for a day.
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeviceMe, ErrorBody, SignedInWithCode } from '../../../shared/contract/api';
import { HOUR, SECOND } from '../../src/lib/time';
import {
  ageCounters,
  api,
  apiJson,
  authSql,
  DEVICE,
  login,
  loginOk,
  makeAgent,
  setupOwner,
  USERNAME,
} from '../helpers';

const NEW_PASSWORD = 'a brand new long passphrase 7';
const WRONG = 'AAAAAAAAAAAAAAAAAAAAAAAAA';

const recover = (code: string, ip = '192.0.2.90', over: Record<string, unknown> = {}) =>
  api('POST', '/v1/auth/recover', {
    ip,
    body: { username: USERNAME, code, new_password: NEW_PASSWORD, device: DEVICE, ...over },
  });

let owner: SignedInWithCode;
let agent: string;
beforeAll(async () => {
  owner = await setupOwner();
  agent = await makeAgent(owner.token, 'mind:chat');
});

describe('recovery code', () => {
  it('refuses a wrong code or username with one error', async () => {
    for (const res of [
      await recover(WRONG),
      await recover(owner.recovery_code, '192.0.2.90', { username: 'someone-else' }),
      await recover('not even a code'),
    ]) {
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrorBody).error.code).toBe('wrong_username_or_code');
    }
  });

  it('refuses a weak new password with its code, without counting a try', async () => {
    const res = await apiJson<ErrorBody>('POST', '/v1/auth/recover', {
      ip: '192.0.2.91',
      body: { username: USERNAME, code: owner.recovery_code, new_password: 'short', device: DEVICE },
    });
    expect([res.status, res.body.error.code]).toEqual([422, 'password_too_short']);
    expect(await authSql("SELECT key FROM throttle WHERE key LIKE 'recover:%' AND key <> 'recover:acct'")).toHaveLength(
      1,
    );
  });

  let recovered: SignedInWithCode;
  it('accepts the code typed sloppily, signs everyone out, keeps agent keys, issues a new code', async () => {
    const other = await loginOk('192.0.2.92');
    const sloppy = owner.recovery_code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const res = await recover(sloppy, '192.0.2.93');
    expect(res.status).toBe(200);
    recovered = (await res.json()) as SignedInWithCode;
    expect(Object.keys(recovered).sort()).toEqual(['idle_days', 'recovery_code', 'session_id', 'token']);
    expect(recovered.recovery_code).not.toBe(owner.recovery_code);
    for (const old of [owner.token, other.token]) {
      const r = await apiJson<ErrorBody>('GET', '/v1/auth/me', { token: old });
      expect([r.status, r.body.error.code, r.body.error.details]).toEqual([
        401,
        'session_revoked',
        { reason: 'recovery_used' },
      ]);
    }
    const me = await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: recovered.token });
    expect(me.body.notices.map((n) => n.kind)).toEqual(['recovery_used']);
    expect(me.body.recovery_confirmed).toBe(false);
    expect((await api('GET', '/v1/auth/me', { token: agent })).status).toBe(200);
    expect(await authSql('SELECT version FROM credential')).toEqual([{ version: 2 }]);
  });

  it('changed the password and used up the old code', async () => {
    expect((await login('192.0.2.94')).status).toBe(401);
    expect((await login('192.0.2.95', NEW_PASSWORD)).status).toBe(200);
    expect((await recover(owner.recovery_code, '192.0.2.96')).status).toBe(401);
  });

  it('the new code is confirmed by its last 5 characters', async () => {
    const last5 = recovered.recovery_code.slice(-5).toLowerCase();
    expect(
      (await api('POST', '/v1/auth/recovery-code/confirm', { token: recovered.token, body: { last5: 'ZZZZZ' } }))
        .status,
    ).toBe(422);
    expect(
      (await api('POST', '/v1/auth/recovery-code/confirm', { token: recovered.token, body: { last5 } })).status,
    ).toBe(204);
    expect((await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: recovered.token })).body.recovery_confirmed).toBe(
      true,
    );
  });
});

describe('recovery back-off', () => {
  it('allows 5 tries per source per hour', async () => {
    await authSql('DELETE FROM throttle');
    for (let i = 0; i < 5; i++) expect((await recover(WRONG, '192.0.2.100')).status).toBe(401);
    const res = await recover(WRONG, '192.0.2.100');
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('Retry-After'));
    expect(retry).toBeGreaterThan(HOUR / 1000 - 60);
    expect(retry).toBeLessThanOrEqual(HOUR / 1000);
  });

  it('account-wide: 30 s after failure 20, then 60, 120, 240, and 300 s at most — never a day', async () => {
    await authSql('DELETE FROM throttle');
    const now = Date.now();
    await authSql("INSERT INTO throttle VALUES ('recover:acct', 19, ?, ?, 0)", now, now);
    for (const [i, expected] of [30, 60, 120, 240, 300, 300].entries()) {
      expect((await recover(WRONG, `192.0.2.${110 + i}`)).status).toBe(401);
      const r = await apiJson<ErrorBody>('POST', '/v1/auth/recover', {
        ip: `192.0.2.${120 + i}`,
        body: { username: USERNAME, code: WRONG, new_password: NEW_PASSWORD, device: DEVICE },
      });
      expect([r.status, r.body.error.scope]).toEqual([429, 'account']);
      expect(r.body.error.retry_after).toBe(expected);
      await ageCounters(expected * SECOND);
    }
  });
});
