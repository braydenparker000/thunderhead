// The rows-read guard, what waits (DATA.md §8.1): from 80% of the day's budget the upload tools'
// operations answer 429 with Retry-After until 00:00 UTC and work again after it; the weekly
// backup's jobs pause until 00:00 UTC and finish after; the monthly drill, whose writes into its
// scratch copy the runner adds to the day's meter, stops between two parts once they put the day
// past 80%, and finishes the next day. The hold reads Core's own rows live, Music's own day for the
// tools, and a heavy step's reads in another object as the step ends; a meter that can't be read
// holds nothing and breaks nothing. The phone's own calls are never held. The meter's rows are
// synthetic fixtures in Core's meter_days; the clock is each call's `now`, or a fake Date.
import { createExecutionContext, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BackupRunResponse, DrillRunResponse } from '../../../shared/contract/backups.ts';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { budgetAt } from '../../../shared/contract/meter.ts';
import { app } from '../../src/app';
import { drillJob } from '../../src/areas/backups/drill';
import { exportJob } from '../../src/areas/backups/export-job';
import { backupJob } from '../../src/areas/backups/job';
import { forgetHold } from '../../src/areas/meter/hold';
import { nextUtcDay, quota } from '../../src/areas/meter/quota';
import { signatureMessage } from '../../src/areas/music/validate';
import { MINUTE, SECOND, utcDay } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import type { Core } from '../../src/objects/core';
import { type Music, musicObject } from '../../src/objects/music';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { runJobsWith } from '../import-helpers';
import { ownerSays, type Principals, principals } from '../memory-helpers';

const REAL = { [backupJob.kind]: backupJob, [drillJob.kind]: drillJob, [exportJob.kind]: exportJob };
const seed = (day: string, cls: string, read: number, written: number) =>
  coreSql(
    'INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, ?, ?, 0)',
    day,
    cls,
    read,
    written,
  );
const jobs = (kind: string) =>
  coreSql<{ id: string; state: string; due_at: number }>('SELECT id, state, due_at FROM jobs WHERE kind = ?', kind);

let p: Principals;
let I = '';
beforeAll(async () => {
  p = await principals();
  I = await makeAgent(p.D, 'ci');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the upload tools', () => {
  const hex = (b: ArrayBuffer | Uint8Array) =>
    Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder();
  let keys: CryptoKeyPair;
  let E: Env;
  /** One signed operation, as the tools send it. */
  async function op(name: string) {
    const bytes = enc.encode('{}');
    const key = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
    const time = String(Math.floor(Date.now() / 1000));
    const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
    const url = `https://api.example.test/v1/music/uploads/${name}`;
    const type = 'application/json';
    const message = signatureMessage({
      method: 'POST',
      origin: 'https://api.example.test',
      path: new URL(url).pathname,
      type,
      hash,
      size: bytes.length,
      time,
      key,
    });
    const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(message)));
    const headers = {
      'Content-Type': type,
      'X-Music-Public-Key': key,
      'X-Music-Signature': sig,
      'X-Music-Timestamp': time,
      'X-Music-Size': String(bytes.length),
      'X-Music-Sha256': hash,
    };
    return app.fetch(new Request(url, { method: 'POST', headers, body: bytes }), E, createExecutionContext());
  }

  it('answer 429 with Retry-After until 00:00 UTC past 80%, and work again after it', async () => {
    keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
    E = { ...env, MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([pub]) } as Env;
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    const day = utcDay(now);
    forgetHold();
    expect((await op('audit')).status).toBe(200);
    await seed(day, 'music', budgetAt(80, 'rows_read') + 1, 0);
    // The isolate keeps Core's answer for a minute.
    vi.setSystemTime(now + MINUTE + SECOND);
    const held = await op('audit');
    expect(held.status).toBe(429);
    const wait = Math.ceil((nextUtcDay(now) - (now + MINUTE + SECOND)) / 1000);
    expect(held.headers.get('Retry-After')).toBe(String(wait));
    expect(((await held.json()) as { error: object }).error).toMatchObject({
      code: 'rate_limited',
      details: { reason: 'daily_quota' },
      retry_after: wait,
      scope: 'account',
    });
    expect((await op('export')).status).toBe(429);
    // The phone's own calls are never held.
    expect((await api('GET', '/v1/briefing', { token: p.D })).status).toBe(200);
    vi.setSystemTime(nextUtcDay(now) + 30 * SECOND);
    expect((await op('audit')).status).toBe(200);
  });

  it("see Music's own day, fresher than Core's row for it (the tools read in Music)", async () => {
    const music = musicObject(env) as unknown as DurableObjectStub<Music>;
    const day = utcDay(Date.now());
    await seed(day, 'music', 0, 0);
    forgetHold();
    expect((await op('audit')).status).toBe(200);
    // Music's own row says it read past 80% today; Core has not heard yet.
    await runInDurableObject(music, (_o, s) =>
      s.storage.sql.exec(
        "INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, 'music', ?, 0, ?)",
        day,
        budgetAt(80, 'rows_read') + 1,
        Date.now(),
      ),
    );
    await evictDurableObject(music);
    forgetHold();
    expect((await op('audit')).status).toBe(429);
    await runInDurableObject(music, (_o, s) => s.storage.sql.exec('DELETE FROM meter_days'));
    await evictDurableObject(music);
    forgetHold();
  });
});

describe('the heavy jobs', () => {
  beforeAll(async () => {
    await ownerSays(p.D, 'A message the backup keeps');
    // 6,000 ledger rows: two parts of the ledger for the backup and the drill.
    await coreSql(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000)
       INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, tainted)
       SELECT printf('l-q-%05d', i), i, 'owner', 'note', 'row ' || i, 'a quota fixture', 0, 'done', 0 FROM n`,
    );
  });

  it('the weekly backup waits past 80% until 00:00 UTC, then finishes', async () => {
    await seed(utcDay(Date.now()), 'music', budgetAt(80, 'rows_read') + 1, 0);
    const r = await apiJson<BackupRunResponse>('POST', '/v1/ops/backups/run', { token: p.N, body: {} });
    expect(r.status).toBe(202);
    const now = Date.now() + SECOND;
    await runJobsWith(REAL, now);
    const waiting = await jobs(backupJob.kind);
    expect(waiting).toHaveLength(4);
    for (const j of waiting) expect(j).toMatchObject({ state: 'paused', due_at: nextUtcDay(now) });
    // Before midnight it still waits; after, it runs to the end.
    await runJobsWith(REAL, nextUtcDay(now) - MINUTE);
    expect((await jobs(backupJob.kind)).every((j) => j.state === 'paused')).toBe(true);
    for (let i = 0; i < 40 && !(await jobs(backupJob.kind)).every((j) => j.state === 'done'); i++)
      await runJobsWith(REAL, nextUtcDay(now) + MINUTE);
    expect((await jobs(backupJob.kind)).map((j) => j.state)).toEqual(['done', 'done', 'done', 'done']);
    await seed(utcDay(now), 'music', 0, 0);
  });

  it('the drill stops between two parts once its writes pass 80%, and finishes the next day', async () => {
    let now = Date.now();
    const day = utcDay(now);
    await coreSql("DELETE FROM settings WHERE key = 'bulk.day'");
    // 300 rows written short of 80% of the day's 68,000 (more than Core's own writes before its
    // meter's next write, fewer than the drill's first parts): the drill's own writes pass it.
    const [own] = await coreSql<{ w: number }>(
      'SELECT coalesce(sum(rows_written), 0) AS w FROM meter_days WHERE day = ?',
      day,
    );
    await seed(day, 'music', 0, budgetAt(80, 'rows_written') - 300 - own.w);
    const r = await apiJson<DrillRunResponse>('POST', '/v1/ops/drill/run', { token: I, body: {} });
    expect(r.status).toBe(202);
    now += SECOND;
    const drill = async () =>
      (
        await coreSql<{ state: string; due_at: number; cursor_json: string | null }>(
          'SELECT state, due_at, cursor_json FROM jobs WHERE id = ?',
          r.body.job_id,
        )
      )[0];
    for (let i = 0; i < 10 && (await drill()).state !== 'paused'; i++) await runJobsWith(REAL, now);
    const paused = await drill();
    expect(paused.state).toBe('paused');
    expect(paused.due_at).toBe(nextUtcDay(now));
    // Mid-way: past the reset, before the check.
    expect(JSON.parse(paused.cursor_json as string)).toMatchObject({ phase: 'rows' });
    const [scratch] = await coreSql<{ rows_written: number }>(
      "SELECT rows_written FROM meter_days WHERE day = ? AND class = 'scratch'",
      day,
    );
    expect(scratch.rows_written).toBeGreaterThan(0);
    // The next day it goes on from where it stopped, and passes.
    for (let i = 0; i < 40 && (await drill()).state !== 'done'; i++) await runJobsWith(REAL, nextUtcDay(now) + MINUTE);
    expect((await drill()).state).toBe('done');
    const [row] = await coreSql<{ state: string }>('SELECT state FROM drills WHERE job_id = ?', r.body.job_id);
    expect(row.state).toBe('passed');
    const [after] = await coreSql<{ rows_written: number }>(
      "SELECT rows_written FROM meter_days WHERE day = ? AND class = 'scratch'",
      utcDay(nextUtcDay(now) + MINUTE),
    );
    expect(after.rows_written).toBeGreaterThan(0);
  });

  it("counts Core's own rows at once, written or not", async () => {
    const grew = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => {
      const db = (o as unknown as { db: Db }).db;
      const now = Date.now();
      const before = quota(db, now).rows_read;
      db.all('SELECT id FROM ledger');
      return quota(db, now).rows_read - before;
    });
    expect(grew).toBeGreaterThanOrEqual(6_000);
  });

  it("adds a heavy step's reads in another object at once, so the next step can wait", async () => {
    const now = Date.now();
    const day = utcDay(now);
    await coreSql('DELETE FROM meter_days WHERE day = ? AND class != ?', day, 'core');
    await seed(day, 'music', budgetAt(80, 'rows_read') - 900_000, 0);
    const heavy = {
      kind: 'test.heavy',
      lane: false,
      heavy: true,
      load: async () => null,
      step: (_w: unknown, _p: unknown, c: unknown) => ({
        next: ((c as number | null) ?? 0) + 1,
        read: { class: 'library', rows: 500_000 },
      }),
    };
    await coreSql(
      `INSERT INTO jobs (id, kind, state, due_at, payload_json, attempts, created_at, updated_at)
       VALUES ('job-q-heavy', 'test.heavy', 'queued', 0, '{}', 0, 0, 0)`,
    );
    await runJobsWith({ [heavy.kind]: heavy as never }, now);
    const [j] = await coreSql<{ state: string; due_at: number; cursor_json: string }>(
      "SELECT state, due_at, cursor_json FROM jobs WHERE id = 'job-q-heavy'",
    );
    // Two steps ran (900,000 left below 80%, 500,000 each); the third waits for 00:00 UTC.
    expect(j).toMatchObject({ state: 'paused', due_at: nextUtcDay(now), cursor_json: '2' });
    const [lib] = await coreSql<{ rows_read: number }>(
      "SELECT rows_read FROM meter_days WHERE day = ? AND class = 'library'",
      day,
    );
    expect(lib.rows_read).toBe(1_000_000);
    await coreSql("DELETE FROM jobs WHERE id = 'job-q-heavy'");
    await coreSql('DELETE FROM meter_days WHERE day = ? AND class != ?', day, 'core');
  });
});

describe('when the meter cannot be read', () => {
  it('the Briefing is served without its line, and the tick and the alarm still run', async () => {
    await coreSql('ALTER TABLE meter_days RENAME TO meter_days_gone');
    try {
      const page = await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D });
      expect(page.status).toBe(200);
      expect(page.body.quota).toBeNull();
      const stub = core() as unknown as DurableObjectStub<Core>;
      await runInDurableObject(stub, (o: Core) => o.tick());
      await runInDurableObject(stub, (o: Core) => o.alarm());
      // A lane job runs: a meter that can't be read holds nothing.
      await coreSql(
        `INSERT INTO jobs (id, kind, state, due_at, payload_json, attempts, created_at, updated_at)
         VALUES ('job-q-lane', 'test.lane', 'queued', 0, '{}', 0, 0, 0)`,
      );
      const lane = { kind: 'test.lane', lane: true, load: async () => null, step: () => ({ done: true as const }) };
      await runJobsWith({ [lane.kind]: lane as never });
      const [j] = await coreSql<{ state: string }>("SELECT state FROM jobs WHERE id = 'job-q-lane'");
      expect(j.state).toBe('done');
    } finally {
      await coreSql('ALTER TABLE meter_days_gone RENAME TO meter_days');
    }
  });
});
