// The reset ticket (SIGN-IN.md §10 acceptance): the GitHub path through AUTH_RESET_FP (the only
// way to open one: no key can, owner 2026-11-21), the 24 h wait, cancel from any device, and use.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthStateResponse, DeviceMe, ErrorBody, SignedInWithCode } from '../../../shared/contract/api';
import { fingerprint, newRecoveryCode, normalizeCode } from '../../src/areas/auth/crypto';
import { noBreachCheck } from '../../src/areas/auth/passwords';
import * as reset from '../../src/areas/auth/reset';
import { HOUR, MINUTE } from '../../src/lib/time';
import { Db, Meter } from '../../src/objects/base';
import { api, apiJson, authSql, DEVICE, inAuth, makeAgent, setupOwner, USERNAME } from '../helpers';

const code = () => normalizeCode(newRecoveryCode()) as string;
const NEW_PASSWORD = 'reset to a fresh long phrase 9';
const use = (c: string, ip = '192.0.2.150') =>
  apiJson<ErrorBody & SignedInWithCode>('POST', '/v1/auth/recover', {
    ip,
    body: { username: USERNAME, code: c, new_password: NEW_PASSWORD, device: DEVICE },
  });
type Ticket = { ticket_id: string; usable_after: number; expires_at: number };
const deps = (s: DurableObjectState, resetFp: string) => ({
  db: new Db(s.storage.sql, new Meter()),
  storage: s.storage,
  pepper: env.AUTH_PEPPER,
  ipKey: env.IP_HASH_KEY,
  setupFp: null,
  resetFp,
  breached: noBreachCheck,
});
/** The GitHub path as the cron runs it: AUTH_RESET_FP set to `fp`. The ticket it opened, or null. */
async function github(fp: string): Promise<Ticket | null> {
  const opened = await inAuth((_o, s) => reset.prune(deps(s, fp)).reset_opened);
  if (!opened) return null;
  const [t] = await authSql<{ id: string; usable_after: number; expires_at: number }>(
    'SELECT id, usable_after, expires_at FROM tickets WHERE fingerprint = ?',
    fp,
  );
  return { ticket_id: t.id, usable_after: t.usable_after, expires_at: t.expires_at };
}
const state = (fp: string) => apiJson<AuthStateResponse>('GET', `/v1/auth/state?reset_fp=${fp}`);
/** Moves a ticket `ms` into the past. */
const age = (id: string, ms: number) =>
  authSql(
    'UPDATE tickets SET requested_at = requested_at - ?, usable_after = usable_after - ?, expires_at = expires_at - ? WHERE id = ?',
    ms,
    ms,
    ms,
    id,
  );

let owner: SignedInWithCode;
const minds: [string, string][] = [];
beforeAll(async () => {
  owner = await setupOwner();
  for (const role of ['mind:chat', 'mind:night', 'mind:reflex', 'muse', 'ci'] as const)
    minds.push([role, await makeAgent(owner.token, role)]);
});

describe('reset ticket from the GitHub path', () => {
  const A = code();
  let ticket: Ticket;

  it('opens a ticket usable after 24 h, expiring 72 h later, with a notice on every device', async () => {
    const t0 = Date.now();
    const opened = await github(fingerprint(A));
    expect(opened).not.toBeNull();
    ticket = opened as Ticket;
    expect(Math.abs(ticket.usable_after - (t0 + 24 * HOUR))).toBeLessThan(5000);
    expect(ticket.expires_at - ticket.usable_after).toBe(72 * HOUR);
    const me = await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: owner.token });
    expect(me.body.notices[0]).toMatchObject({ kind: 'reset_pending', args: { ticket_id: ticket.ticket_id } });
    expect((await state(fingerprint(A))).body).toEqual({
      setup: 'done',
      reset: 'pending',
      usable_after: ticket.usable_after,
    });
    expect((await state(fingerprint(code()))).body).toEqual({ setup: 'done', reset: 'none' });
  });

  it('opens no second ticket while one is open', async () => {
    const other = fingerprint(code());
    expect(await github(other)).toBeNull();
    expect((await state(other)).body.reset).toBe('none');
  });

  it('at 23 h 59 min the code gets 425 reset_not_ready with usable_after; at 24 h it works', async () => {
    await age(ticket.ticket_id, 23 * HOUR + 59 * MINUTE);
    const early = await use(A);
    expect([early.status, early.body.error.code]).toEqual([425, 'reset_not_ready']);
    expect(early.body.error.details).toEqual({ usable_after: expect.any(Number) });
    await age(ticket.ticket_id, MINUTE);
    const ok = await use(A, '192.0.2.151');
    expect(ok.status).toBe(200);
    const old = await apiJson<ErrorBody>('GET', '/v1/auth/me', { token: owner.token });
    expect(old.body.error.details).toEqual({ reason: 'reset_used' });
    const me = await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: ok.body.token });
    expect(me.body.notices.map((n) => n.kind)).toEqual(['reset_used']);
    expect((await use(A, '192.0.2.152')).body.error.code).toBe('reset_used');
    expect((await state(fingerprint(A))).body.reset).toBe('used');
    owner = ok.body;
  });
});

describe('cancel and the GitHub path', () => {
  it('a cancel from any session voids the ticket and its fingerprint for good', async () => {
    const B = code();
    const t = (await github(fingerprint(B))) as Ticket;
    expect(
      (await api('POST', '/v1/auth/breakglass/cancel', { token: owner.token, body: { ticket_id: t.ticket_id } }))
        .status,
    ).toBe(204);
    expect((await use(B, '192.0.2.160')).body.error.code).toBe('reset_cancelled');
    expect(await github(fingerprint(B))).toBeNull();
    expect((await state(fingerprint(B))).body.reset).toBe('cancelled');
    const again = await apiJson<ErrorBody>('POST', '/v1/auth/breakglass/cancel', {
      token: owner.token,
      body: { ticket_id: t.ticket_id },
    });
    expect([again.status, again.body.error.code]).toEqual([410, 'reset_cancelled']);
    const kinds = (await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: owner.token })).body.notices.map(
      (n) => n.kind,
    );
    expect(kinds).not.toContain('reset_pending');
  });

  it('a new AUTH_RESET_FP opens a ticket the first time Auth sees it', async () => {
    const C = code();
    const out = await inAuth((_o, s) => reset.state(deps(s, fingerprint(C)), null, fingerprint(C)));
    expect(out).toMatchObject({ setup: 'done', reset: 'pending', noticed: true });
    expect(
      await authSql("SELECT source FROM tickets WHERE kind = 'reset' AND fingerprint = ?", fingerprint(C)),
    ).toEqual([{ source: 'github' }]);
    await authSql('UPDATE tickets SET cancelled_at = 1 WHERE fingerprint = ?', fingerprint(C));
  });

  it('no key or session can start a reset: the mind route is gone for every principal', async () => {
    for (const [role, key] of [...minds, ['device', owner.token] as [string, string]]) {
      const r = await apiJson<ErrorBody>('POST', '/v1/auth/breakglass', {
        token: key,
        body: { fingerprint: fingerprint(code()) },
      });
      expect([r.status, r.body.error.code], role).toEqual([404, 'not_found']);
    }
    expect(await authSql("SELECT count(*) AS n FROM tickets WHERE source = 'mind'")).toEqual([{ n: 0 }]);
  });
});
