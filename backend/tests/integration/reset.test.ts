// The reset ticket (SIGN-IN.md §10 acceptance): the mind's break-glass request and the GitHub
// path through AUTH_RESET_FP, the 24 h wait, cancel from any device, and use.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  AuthStateResponse,
  BreakglassResponse,
  DeviceMe,
  ErrorBody,
  SignedInWithCode,
} from '../../../shared/contract/api';
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
const breakglass = (token: string, fp: string) =>
  apiJson<BreakglassResponse & ErrorBody>('POST', '/v1/auth/breakglass', { token, body: { fingerprint: fp } });
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
let mind: string;
beforeAll(async () => {
  owner = await setupOwner();
  mind = await makeAgent(owner.token, 'mind:chat');
});

describe('reset ticket from the mind', () => {
  const A = code();
  let ticket: BreakglassResponse;

  it('opens a ticket usable after 24 h, expiring 72 h later, with a notice on every device', async () => {
    const t0 = Date.now();
    const r = await breakglass(mind, fingerprint(A));
    expect(r.status).toBe(201);
    ticket = r.body;
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

  it('refuses a second ticket while one is open', async () => {
    const r = await breakglass(mind, fingerprint(code()));
    expect([r.status, r.body.error.code]).toEqual([409, 'reset_already_pending']);
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
    const t = (await breakglass(mind, fingerprint(B))).body;
    expect(
      (await api('POST', '/v1/auth/breakglass/cancel', { token: owner.token, body: { ticket_id: t.ticket_id } }))
        .status,
    ).toBe(204);
    expect((await use(B, '192.0.2.160')).body.error.code).toBe('reset_cancelled');
    expect((await breakglass(mind, fingerprint(B))).body.error.code).toBe('reset_cancelled');
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
    const out = await inAuth((_o, s) =>
      reset.state(
        {
          db: new Db(s.storage.sql, new Meter()),
          storage: s.storage,
          pepper: env.AUTH_PEPPER,
          ipKey: env.IP_HASH_KEY,
          setupFp: null,
          resetFp: fingerprint(C),
          breached: noBreachCheck,
        },
        null,
        fingerprint(C),
      ),
    );
    expect(out).toMatchObject({ setup: 'done', reset: 'pending' });
    expect(
      await authSql("SELECT source FROM tickets WHERE kind = 'reset' AND fingerprint = ?", fingerprint(C)),
    ).toEqual([{ source: 'github' }]);
    await authSql('UPDATE tickets SET cancelled_at = 1 WHERE fingerprint = ?', fingerprint(C));
  });

  it('allows 3 mind-requested tickets in 30 days, then 429', async () => {
    // Tickets so far from the mind: A and B (both counted).
    const D = code();
    const t = (await breakglass(mind, fingerprint(D))).body;
    await api('POST', '/v1/auth/breakglass/cancel', { token: owner.token, body: { ticket_id: t.ticket_id } });
    const r = await breakglass(mind, fingerprint(code()));
    expect([r.status, r.body.error.code]).toEqual([429, 'rate_limited']);
  });
});
