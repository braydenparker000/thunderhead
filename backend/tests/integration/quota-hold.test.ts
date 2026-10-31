// The rows-read guard, what waits (DATA.md §8.1): from 80% of the day's budget the upload tools'
// operations answer 429 with Retry-After until 00:00 UTC and work again after it; the weekly
// backup's jobs pause until 00:00 UTC and finish after; the monthly drill, whose writes into its
// scratch copy the runner adds to the day's meter, stops between two parts once they put the day
// past 80%, and finishes the next day. The phone's own calls are never held. The meter's rows are
// synthetic fixtures in Core's meter_days; the clock is each call's `now`, or a fake Date.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BackupRunResponse, DrillRunResponse } from '../../../shared/contract/backups.ts';
import { budgetAt } from '../../../shared/contract/meter.ts';
import { app } from '../../src/app';
import { drillJob } from '../../src/areas/backups/drill';
import { exportJob } from '../../src/areas/backups/export-job';
import { backupJob } from '../../src/areas/backups/job';
import { forgetHold } from '../../src/areas/meter/hold';
import { nextUtcDay } from '../../src/areas/meter/quota';
import { signatureMessage } from '../../src/areas/music/validate';
import { MINUTE, SECOND, utcDay } from '../../src/lib/time';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
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
});
