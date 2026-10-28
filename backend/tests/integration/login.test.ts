// Sign-in, sessions and sign-out (SIGN-IN.md §5, §11; API.md §11.2–11.3), in order, on one owner
// set up in beforeAll.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeviceMe, ErrorBody, SessionItem, SessionsResponse, SignedIn } from '../../../shared/contract/api';
import { tokenHash } from '../../src/areas/auth/crypto';
import { newToken } from '../../src/areas/auth/tokens';
import { PRINCIPAL_CACHE_MS } from '../../src/http/auth';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, HOUR } from '../../src/lib/time';
import { api, apiJson, auth, authSql, login, loginOk, PASSWORD, rowsDuring, setupOwner, USERNAME } from '../helpers';

const sessions = (token: string) => apiJson<SessionsResponse>('GET', '/v1/auth/sessions', { token });
const me = (token: string) => apiJson<DeviceMe & ErrorBody>('GET', '/v1/auth/me', { token });
const signout = (token: string, scope: string) => api('POST', '/v1/auth/signout', { token, body: { scope } });

let owner: SignedIn;
beforeAll(async () => {
  owner = await setupOwner();
});

describe('login', () => {
  it('gives one error for a wrong password and for an unknown username', async () => {
    for (const r of [
      await apiJson<ErrorBody>('POST', '/v1/auth/login', {
        ip: '192.0.2.21',
        body: { username: USERNAME, password: 'not it at all', device: {} },
      }),
      await apiJson<ErrorBody>('POST', '/v1/auth/login', {
        ip: '192.0.2.22',
        body: { username: 'someone-else', password: PASSWORD, device: {} },
      }),
    ]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('wrong_username_or_password');
      expect(r.body.error.request_id).toBeTruthy();
    }
  });

  it('returns {token, session_id, idle_days}; ignores case and spaces in the username', async () => {
    const res = await api('POST', '/v1/auth/login', {
      ip: '192.0.2.23',
      body: {
        username: '  EXAMPLE-Owner ',
        password: PASSWORD,
        device: { platform: 'Windows', browser: 'Edge', standalone: true },
      },
    });
    expect(res.status).toBe(200);
    const grant = (await res.json()) as SignedIn;
    expect(Object.keys(grant).sort()).toEqual(['idle_days', 'session_id', 'token']);
    const { body } = await sessions(grant.token);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: grant.session_id,
      label: 'Windows · Edge app',
      this_device: true,
      standalone: true,
    });
  });

  it('refuses a password over 128 characters before hashing', async () => {
    const r = await apiJson<ErrorBody>('POST', '/v1/auth/login', {
      body: { username: USERNAME, password: 'x'.repeat(129), device: {} },
    });
    expect([r.status, r.body.error.code]).toEqual([422, 'password_too_long']);
  });

  it('tells the other devices with one new_device notice, not the new one', async () => {
    const before = (await me(owner.token)).body.notices.length;
    const b = await loginOk('192.0.2.24');
    const mine = (await me(owner.token)).body.notices;
    expect(mine.length).toBe(before + 1);
    expect(mine[0]).toMatchObject({
      kind: 'new_device',
      about_session_id: b.session_id,
      args: { label: 'Android · Chrome' },
    });
    expect((await me(b.token)).body.notices.filter((n) => n.kind === 'new_device')).toEqual([]);
    // "Not me — sign it out" revokes B at once.
    expect(
      (await api('POST', `/v1/auth/notices/${mine[0].id}/ack`, { token: owner.token, body: { answer: 'not_me' } }))
        .status,
    ).toBe(204);
    const r = await me(b.token);
    expect([r.status, r.body.error.code, r.body.error.details]).toEqual([
      401,
      'session_revoked',
      { reason: 'signed_out_elsewhere' },
    ]);
    expect((await me(owner.token)).body.notices.find((n) => n.id === mine[0].id)).toBeUndefined();
  });

  it('refuses missing, malformed and unknown tokens', async () => {
    expect((await api('GET', '/v1/auth/sessions')).status).toBe(401);
    expect((await api('GET', '/v1/auth/sessions', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await api('GET', '/v1/auth/sessions', { headers: { Authorization: owner.token } })).status).toBe(401);
    expect((await sessions(newToken('th1'))).status).toBe(401);
  });
});

describe('sessions and sign-out', () => {
  it('signs this device out (204) and the old token learns why', async () => {
    const g = await loginOk('192.0.2.31');
    expect((await signout(g.token, 'this')).status).toBe(204);
    const r = await me(g.token);
    expect([r.status, r.body.error.code, r.body.error.details]).toEqual([
      401,
      'session_revoked',
      { reason: 'signed_out_here' },
    ]);
  });

  it('renames and signs out another device by id; DELETE is 204 even when gone', async () => {
    const other = await loginOk('192.0.2.32');
    expect((await sessions(other.token)).status).toBe(200); // now cached in this isolate
    const renamed = await apiJson<SessionItem>('PATCH', `/v1/auth/sessions/${other.session_id}`, {
      token: owner.token,
      body: { label: ' Kitchen tablet ' },
    });
    expect(renamed.body).toMatchObject({ id: other.session_id, label: 'Kitchen tablet', this_device: false });
    expect(
      (await api('PATCH', `/v1/auth/sessions/${other.session_id}`, { token: owner.token, body: { label: '' } })).status,
    ).toBe(422);
    expect((await api('DELETE', `/v1/auth/sessions/${other.session_id}`, { token: owner.token })).status).toBe(204);
    const r = await me(other.token);
    expect([r.status, r.body.error.details]).toEqual([401, { reason: 'signed_out_elsewhere' }]);
    expect((await api('DELETE', `/v1/auth/sessions/${uuidv7()}`, { token: owner.token })).status).toBe(204);
    expect((await api('DELETE', '/v1/auth/sessions/not-an-id', { token: owner.token })).status).toBe(422);
    expect(
      (await api('PATCH', `/v1/auth/sessions/${other.session_id}`, { token: owner.token, body: { label: 'x' } }))
        .status,
    ).toBe(404);
  });

  it('expires a session after 90 idle days with 401 session_expired', async () => {
    const g = await loginOk('192.0.2.33');
    await authSql('UPDATE sessions SET idle_expires_at = ? WHERE id = ?', Date.now() - 1, g.session_id);
    const r = await me(g.token);
    expect([r.status, r.body.error.code]).toEqual([401, 'session_expired']);
  });

  it('after 30 days a revoked token gets plain 401 unauthorized, and the cron deletes the row', async () => {
    const g = await loginOk('192.0.2.34');
    await signout(g.token, 'this');
    await authSql('UPDATE sessions SET revoked_at = ? WHERE id = ?', Date.now() - 31 * DAY, g.session_id);
    expect((await me(g.token)).body.error.code).toBe('unauthorized');
    await auth().prune();
    expect(await authSql('SELECT id FROM sessions WHERE id = ?', g.session_id)).toEqual([]);
  });

  it('renews last_seen_at at most once an hour, and caches checks per isolate', async () => {
    const g = await loginOk('192.0.2.35');
    const hourAgo = Date.now() - HOUR - 1;
    await authSql(
      'UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?',
      hourAgo,
      hourAgo + DAY,
      g.session_id,
    );
    const first = await rowsDuring(auth(), () => me(g.token));
    const second = await rowsDuring(auth(), () => me(g.token));
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    const [row] = await authSql<{ idle_expires_at: number }>(
      'SELECT idle_expires_at FROM sessions WHERE id = ?',
      g.session_id,
    );
    expect(Math.abs(row.idle_expires_at - (Date.now() + 90 * DAY))).toBeLessThan(5000);
    expect(await rowsDuring(auth(), () => auth().verify(tokenHash(g.token), false, null))).toEqual({
      read: 1,
      written: 0,
    });
  });

  it('honours a sign-out made elsewhere within 60 s', async () => {
    expect(PRINCIPAL_CACHE_MS).toBeLessThanOrEqual(60_000);
    const g = await loginOk('192.0.2.36');
    expect((await sessions(g.token)).status).toBe(200);
    await authSql(
      "UPDATE sessions SET revoked_at = ?, revoked_reason = 'signed_out_elsewhere' WHERE id = ?",
      Date.now(),
      g.session_id,
    );
    expect((await sessions(g.token)).status).toBe(200); // this isolate's cache still has it
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + PRINCIPAL_CACHE_MS + 1);
      expect((await sessions(g.token)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs out the others, then everywhere', async () => {
    const a = await loginOk('192.0.2.37');
    expect((await signout(owner.token, 'others')).status).toBe(204);
    expect((await me(a.token)).body.error.details).toEqual({ reason: 'signed_out_elsewhere' });
    expect((await sessions(owner.token)).body.items.map((s) => s.id)).toEqual([owner.session_id]);
    const b = await loginOk('192.0.2.38');
    expect((await signout(b.token, 'all')).status).toBe(204);
    expect((await me(owner.token)).body.error.details).toEqual({ reason: 'signed_out_elsewhere' });
    expect((await me(b.token)).body.error.details).toEqual({ reason: 'signed_out_here' });
    expect(
      await authSql('SELECT id FROM sessions WHERE revoked_at IS NULL AND idle_expires_at > ?', Date.now()),
    ).toEqual([]);
    expect((await signout(b.token, 'bogus')).status).toBe(401);
    expect((await login('192.0.2.39')).status).toBe(200);
  });

  it('caps active sessions at 50: sign-in 51 revokes the one idle longest with device_limit', async () => {
    const first = await loginOk('192.0.2.40');
    await authSql('UPDATE sessions SET last_seen_at = 0 WHERE id = ?', first.session_id);
    const active = 'SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL AND idle_expires_at > ?';
    const n = (await authSql<{ n: number }>(active, Date.now()))[0].n;
    // Seed the rest of the 50 directly: 50 real sign-ins would spend 50 password hashes.
    for (let i = n; i < 50; i++)
      await authSql(
        `INSERT INTO sessions (token_hash, id, label, created_at, last_seen_at, idle_expires_at, credential_version)
         VALUES (?, ?, 'seeded', ?, ?, ?, 1)`,
        `seed-${i}`,
        uuidv7(),
        Date.now(),
        Date.now(),
        Date.now() + DAY,
      );
    await loginOk('192.0.2.41');
    expect(await auth().verify(tokenHash(first.token), false, null)).toMatchObject({
      code: 'session_revoked',
      details: { reason: 'device_limit' },
    });
    expect((await authSql<{ n: number }>(active, Date.now()))[0].n).toBe(50);
  });
});
