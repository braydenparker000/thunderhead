// Auth's notices reach an open home within seconds (SIGN-IN.md §10.1, §11.4): a route that creates
// or clears a notice writes one `notice` change in Core's feed, and so does the cron when it opens
// the GitHub path's reset ticket, even from a recovery that fails. Only devices see those changes:
// an agent key's GET /v1/changes and live wait leave them out while their cursor moves past them.
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangesResponse, DeviceMe, LiveWaitResponse, SignedInWithCode } from '../../../shared/contract/api';
import { fingerprint, newRecoveryCode, normalizeCode } from '../../src/areas/auth/crypto';
import { runCron } from '../../src/areas/ops/cron';
import { api, apiJson, authSql, DEVICE, makeAgent, PASSWORD, setupOwner, USERNAME } from '../helpers';

let owner: SignedInWithCode;
let chat = '';
beforeAll(async () => {
  owner = await setupOwner();
  chat = await makeAgent(owner.token, 'mind:chat');
});

const feedSeq = async () =>
  (await apiJson<ChangesResponse>('GET', '/v1/changes?after=0&limit=500', { token: owner.token })).body.next_after;
/** Waits for a `notice` change after `seq` (the route writes it after its response). */
const noticeAfter = (seq: number) =>
  vi.waitFor(
    async () => {
      const r = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${seq}`, { token: owner.token });
      expect(r.body.items.map((c) => c.kind)).toContain('notice');
    },
    { timeout: 5000, interval: 50 },
  );
const resetFp = () => fingerprint(normalizeCode(newRecoveryCode()) as string);
const pending = async () =>
  (await apiJson<DeviceMe>('GET', '/v1/auth/me', { token: owner.token })).body.notices.find(
    (n) => n.kind === 'reset_pending',
  );

describe('a notice change in the feed', () => {
  const was = env.AUTH_RESET_FP;
  afterEach(() => {
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = was;
  });

  it('when a new agent key makes a notice', async () => {
    const seq = await feedSeq();
    await makeAgent(owner.token, 'mind:night');
    await noticeAfter(seq);
  });

  it('when the cron opens the GitHub path ticket, and when a device cancels it', async () => {
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = resetFp();
    const seq = await feedSeq();
    await runCron(env);
    await noticeAfter(seq);
    const n = await pending();
    expect(n).toBeDefined();
    const at = await feedSeq();
    const r = await api('POST', '/v1/auth/breakglass/cancel', {
      token: owner.token,
      body: { ticket_id: n?.args.ticket_id },
    });
    expect(r.status).toBe(204);
    await noticeAfter(at);
    expect(await pending()).toBeUndefined();
  });

  it('when GET /v1/auth/state opens the GitHub path ticket, never in the answer', async () => {
    const fp = resetFp();
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = fp;
    const seq = await feedSeq();
    const r = await apiJson<Record<string, unknown>>('GET', `/v1/auth/state?reset_fp=${fp}`);
    expect(r.body).toEqual({ setup: 'done', reset: 'pending', usable_after: expect.any(Number) });
    await noticeAfter(seq);
    await authSql('UPDATE tickets SET cancelled_at = 1 WHERE fingerprint = ?', fp);
  });

  it('when a failed recovery is the call that opens the GitHub path ticket', async () => {
    const fp = resetFp();
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = fp;
    const seq = await feedSeq();
    const r = await apiJson<{ error: { code: string } }>('POST', '/v1/auth/recover', {
      ip: '192.0.2.170',
      body: {
        username: USERNAME,
        code: normalizeCode(newRecoveryCode()),
        new_password: 'a fresh long phrase 77',
        device: DEVICE,
      },
    });
    expect([r.status, r.body.error.code]).toEqual([401, 'wrong_username_or_code']);
    expect(await authSql('SELECT source FROM tickets WHERE fingerprint = ?', fp)).toEqual([{ source: 'github' }]);
    await noticeAfter(seq);
    await authSql('UPDATE tickets SET cancelled_at = 1 WHERE fingerprint = ?', fp);
  });

  it('when a password change makes a notice for the other devices', async () => {
    const seq = await feedSeq();
    const r = await api('POST', '/v1/auth/password', {
      token: owner.token,
      body: { current_password: PASSWORD, new_password: 'another long fresh phrase 42', sign_out_others: false },
    });
    expect(r.status).toBe(200);
    await noticeAfter(seq);
  });
});

describe('notice changes are for devices only', () => {
  it('a mind key reading the same range never sees one, and its cursor moves past it', async () => {
    const fp = resetFp();
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = fp;
    const seq = await feedSeq();
    await runCron(env);
    (env as { AUTH_RESET_FP: string }).AUTH_RESET_FP = 'none';
    await noticeAfter(seq);
    await authSql('UPDATE tickets SET cancelled_at = 1 WHERE fingerprint = ?', fp);
    const mine = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${seq}`, { token: owner.token });
    expect(mine.body.items.map((c) => c.kind)).toContain('notice');
    const theirs = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${seq}`, { token: chat });
    expect(theirs.status).toBe(200);
    expect(theirs.body.items.map((c) => c.kind)).not.toContain('notice');
    expect(theirs.body.next_after).toBe(mine.body.next_after);
    const next = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${theirs.body.next_after}`, { token: chat });
    expect(next.body.items.map((c) => c.kind)).not.toContain('notice');
    const all = await apiJson<ChangesResponse>('GET', '/v1/changes?after=0&limit=500', { token: chat });
    expect(all.body.items.map((c) => c.kind)).not.toContain('notice');
    // The live wait: a take over only a notice says nothing changed, and still moves the cursor.
    const last = mine.body.items.filter((c) => c.kind === 'notice').at(-1)?.seq ?? 0;
    const take = await apiJson<LiveWaitResponse>('GET', `/v1/live/wait?after=${last - 1}&timeout=1`, { token: chat });
    expect(take.body.kinds).not.toContain('notice');
    expect(take.body.seq).toBeGreaterThanOrEqual(last);
  });
});
