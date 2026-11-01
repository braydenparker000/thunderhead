// The listening pass's limits and its clean-up (JOBS.md §3.3, §3.5), with synthetic songs and results:
// expiry after 72 hours; applying under the bulk lane (paused at its cap; a repeated part counts once);
// files a failed delete left, swept; an apply that fails for good rejecting its job; at most three jobs
// of a kind a day; the quota hold on issuing; and the phone file left alone when nothing was valid.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { LISTEN_LIMITS as L } from '../../../shared/contract/listen.ts';
import { DAY_BUDGET } from '../../../shared/contract/meter.ts';
import { JOBS_KEY } from '../../../shared/contract/routes.ts';
import { forgetHold } from '../../src/areas/meter/hold';
import { listenApplyJob } from '../../src/areas/music/listen-jobs';
import { DAY, utcDay } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import { commit } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';
import { drain, manifest, music, musicSql, pack, put, result, seedTracks } from '../listen-helpers';

const tokens = {} as Record<'D' | 'C' | 'N' | 'I', string>;
/** Jobs issued a day earlier, as far as the daily cap is concerned. */
const aged = () => musicSql('UPDATE external_jobs SET issued_at = issued_at - ?', DAY);

beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.I = await makeAgent(tokens.D, 'ci', JOBS_KEY);
  await seedTracks(60);
});

const next = (token: string, q = 'kind=audio.analysis&max=50') =>
  apiJson<{ job_id: string; kind: string; v: number; shas: string[] }>('GET', `/v1/jobs/next?${q}`, { token });
const status = (id: string, token = tokens.C) =>
  apiJson<{ state: string; count: number; counts: Record<string, unknown> | null }>('GET', `/v1/jobs/${id}`, { token });
const collect = (id: string, token = tokens.I) =>
  apiJson<{ state: string }>('POST', `/v1/jobs/${id}/collect`, { token, body: {} });

describe('expiry', () => {
  it('a spec not collected in 72 hours expires and its songs are due again', async () => {
    await aged();
    const j = await next(tokens.N, 'kind=audio.analysis&max=3');
    const id = j.body.job_id;
    await put(tokens.I, id, 'part-001.jsonl', '{}');
    await musicSql('UPDATE external_jobs SET expires_at = ? WHERE id = ?', Date.now() - 1, id);
    expect((await apiJson('GET', `/v1/jobs/${id}/spec`, { token: tokens.I })).status).toBe(410);
    expect((await collect(id)).status).toBe(410);
    await aged();
    const again = await next(tokens.N, 'kind=audio.analysis&max=3');
    expect((await status(id)).body.state).toBe('expired');
    expect(again.body.shas).toEqual(j.body.shas);
    expect((await env.VAULT.list({ prefix: `jobs/incoming/${id}/` })).objects).toHaveLength(0);
  });
});

describe('applying under the bulk lane', () => {
  it('pauses at the lane’s daily cap, then a repeated part counts once', async () => {
    await aged();
    const j = await next(tokens.N, 'kind=audio.analysis&max=2');
    const id = j.body.job_id;
    const up = await pack(j.body.shas.map((s, i) => result(s, 200 + i)));
    await put(tokens.I, id, 'part-001.jsonl', up.parts[0]);
    await put(tokens.I, id, 'manifest.json', JSON.stringify(manifest(id, up.files)));
    const day = utcDay(Date.now());
    await coreSql(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES ('bulk.day', ?, 0, 'worker')",
      JSON.stringify({ day, rows: L.max_tracks * 80 }),
    );
    expect((await collect(id)).status).toBe(202);
    await drain();
    const job = await coreSql<{ state: string }>('SELECT state FROM jobs WHERE id = ?', `listen.apply:${id}`);
    expect(job[0].state).toBe('paused');
    expect((await status(id)).body.state).toBe('validating');
    await coreSql("UPDATE settings SET value_json = ? WHERE key = 'bulk.day'", JSON.stringify({ day, rows: 0 }));
    await coreSql('UPDATE jobs SET due_at = 0 WHERE id = ?', `listen.apply:${id}`);
    await drain();
    expect((await status(id)).body).toMatchObject({ state: 'applied', counts: { valid: 2, invalid: 0 } });
    // The same part handed over again (a step repeated after a crash) writes and counts nothing.
    expect(await music().listenApply(id, 1, [], { size: 5 })).toBe(0);
    expect((await status(id)).body.counts).toMatchObject({ valid: 2, invalid: 0 });
  });
});

describe('files left behind', () => {
  it("a closed job's files are swept when the next job is asked for; an open job's stay", async () => {
    await aged();
    const closed = await next(tokens.N, 'kind=audio.analysis&max=1');
    await musicSql("UPDATE external_jobs SET state = 'rejected' WHERE id = ?", closed.body.job_id);
    await aged();
    const open = await next(tokens.N, 'kind=audio.analysis&max=1');
    await put(tokens.I, open.body.job_id, 'part-001.jsonl', '{}');
    // As if a delete had failed: files of a rejected job, and of a job long pruned.
    await env.VAULT.put(`jobs/incoming/${closed.body.job_id}/part-001.jsonl`, 'left');
    await env.VAULT.put('jobs/specs/0190a0a0-0000-7000-8000-00000000abcd.order', 'left');
    await aged();
    await next(tokens.N, 'kind=audio.neighbours');
    const left = (await env.VAULT.list({ prefix: 'jobs/' })).objects.map((o) => o.key);
    expect(left).toEqual([`jobs/incoming/${open.body.job_id}/part-001.jsonl`]);
    await musicSql("UPDATE external_jobs SET state = 'rejected' WHERE id = ?", open.body.job_id);
  });
});

describe('an apply that fails for good', () => {
  it('rejects the Actions job, deletes its uploads, and still registers the parts it applied', async () => {
    await aged();
    const j = await next(tokens.N, 'kind=audio.analysis&max=1');
    const id = j.body.job_id;
    await put(tokens.I, id, 'part-001.jsonl', '{}');
    // One part was applied before the last one failed six times.
    const counts = { expected: 1, valid: 1, invalid: 0, failed: 0, missing: 0, parts: [1] };
    const epoch = await musicSql<{ value_json: string }>(
      "SELECT value_json FROM music_state WHERE key = 'listen.epoch'",
    );
    const pack = await coreSql<{ updated_at: number }>("SELECT updated_at FROM jobs WHERE id = 'listen.pack'");
    await musicSql(
      "UPDATE external_jobs SET state = 'validating', counts_json = ? WHERE id = ?",
      JSON.stringify(counts),
      id,
    );
    // The apply job's sixth failure in a row ends in its hook, inside Core's commit.
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core, state) =>
      commit(state.storage, (o as unknown as { db: Db }).db, (w) =>
        listenApplyJob.failed?.(w, { job_id: id }, 'step_failed:TypeError'),
      ),
    );
    await drain();
    expect((await status(id)).body).toMatchObject({ state: 'rejected', counts: { reasons: { apply_failed: 1 } } });
    expect((await env.VAULT.list({ prefix: `jobs/incoming/${id}/` })).objects).toHaveLength(0);
    // As finish would: the neighbours see a change, and the phone file is rebuilt.
    const after = await musicSql<{ value_json: string }>(
      "SELECT value_json FROM music_state WHERE key = 'listen.epoch'",
    );
    expect(Number(after[0].value_json)).toBe(Number(epoch[0]?.value_json ?? 0) + 1);
    const rebuilt = await coreSql<{ state: string; updated_at: number }>(
      "SELECT state, updated_at FROM jobs WHERE id = 'listen.pack'",
    );
    expect(rebuilt[0].state).toBe('done');
    expect(rebuilt[0].updated_at).toBeGreaterThan(pack[0]?.updated_at ?? 0);
  });
});

describe('limits on issuing', () => {
  it('at most three jobs of a kind in 24 hours, then 429', async () => {
    await aged();
    await musicSql("UPDATE external_jobs SET state = 'rejected' WHERE state IN ('issued', 'validating')");
    for (let i = 0; i < L.jobs_per_day; i++) {
      const j = await next(tokens.N, 'kind=audio.analysis&max=1');
      expect(j.status, `job ${i + 1}`).toBe(200);
      await musicSql("UPDATE external_jobs SET state = 'rejected' WHERE id = ?", j.body.job_id);
    }
    const r = await next(tokens.N, 'kind=audio.analysis&max=1');
    expect(r.status).toBe(429);
    expect((r.body as unknown as { error: { details: unknown } }).error.details).toEqual({ reason: 'daily_jobs' });
  });

  it('waits for 00:00 UTC once the day is past 80% of its budget', async () => {
    await aged();
    forgetHold();
    await coreSql(
      'INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, ?, ?, 0)',
      utcDay(Date.now()),
      'senses',
      0,
      Math.ceil(DAY_BUDGET.rows_written * 0.81),
    );
    const r = await next(tokens.N, 'kind=audio.analysis&max=1');
    expect(r.status).toBe(429);
    expect((r.body as unknown as { error: { details: unknown } }).error.details).toEqual({ reason: 'daily_quota' });
    await coreSql("DELETE FROM meter_days WHERE class = 'senses'");
    forgetHold();
  });

  it('a job with nothing valid leaves the phone file as it was', async () => {
    await aged();
    const j = await next(tokens.N, 'kind=audio.analysis&max=1');
    const bad = await pack([result(j.body.shas[0], 0, { bpm: 999 })]);
    await put(tokens.I, j.body.job_id, 'part-001.jsonl', bad.parts[0]);
    await put(tokens.I, j.body.job_id, 'manifest.json', JSON.stringify(manifest(j.body.job_id, bad.files)));
    const before = await coreSql<{ updated_at: number }>("SELECT updated_at FROM jobs WHERE id = 'listen.pack'");
    expect((await collect(j.body.job_id)).status).toBe(202);
    await drain();
    expect((await status(j.body.job_id)).body).toMatchObject({ state: 'applied', counts: { valid: 0, invalid: 1 } });
    expect(await coreSql("SELECT updated_at FROM jobs WHERE id = 'listen.pack'")).toEqual(before);
  });
});
