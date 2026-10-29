// P5: the senses (API.md §11.14, DATA.md §6.1, MUSIC.md §10.1). The phone's sealed batch is stored
// once (the same bytes again change nothing; other bytes under its id are a conflict), each bad
// event is dropped with its reason, each good one lands on the owner's logical day with its rollup;
// the agents ask fixed questions (a sensitive event shows its type and time only); each finished
// day is archived in the private bucket, again when a late event arrives; events past 90 days go
// once their day is archived.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SenseBatchResponse, SenseQueryResponse } from '../../../shared/contract/senses.ts';
import { gunzip } from '../../src/areas/backups/rows';
import { logicalDay } from '../../src/areas/conversation/day';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import type { Senses } from '../../src/objects/senses';
import { api, apiJson, makeAgent } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let R = '';
const senses = () => env.SENSES.get(env.SENSES.idFromName('owner')) as unknown as DurableObjectStub<Senses>;
const sql = <T>(q: string, ...b: unknown[]) =>
  runInDurableObject(senses(), (_o, s) => s.storage.sql.exec(q, ...(b as SqlStorageValue[])).toArray() as T[]);
const NOW = Date.now();
const TRACK = `music:r2_native_${'a'.repeat(64)}`;
const ev = (over: Record<string, unknown> = {}) => ({ id: uuidv7(), at: NOW - 60_000, type: 'music.play', ...over });
const put = (id: string, events: unknown[], token = p.D) =>
  apiJson<SenseBatchResponse & { error?: { code: string } }>('PUT', `/v1/senses/batches/${id}`, {
    token,
    body: { events },
  });
const ask = (name: string, params: object, token = p.N) =>
  apiJson<SenseQueryResponse & { error?: { code: string; details: { path: string }[] } }>('POST', '/v1/senses/query', {
    token,
    body: { name, params },
  });
const today = logicalDay(NOW - 60_000, 'UTC');

beforeAll(async () => {
  p = await principals();
  R = await makeAgent(p.D, 'mind:reflex');
});

describe('the phone’s batches', () => {
  const batch = uuidv7();
  const events = [
    ev({ ref: TRACK, data: { context_ref: null, source: 'list', offline: false } }),
    ev({ type: 'music.skip', ref: TRACK, at: NOW - 30_000, data: { at_ms: 12_000, duration_ms: 201_000, by: 'next' } }),
    ev({ type: 'music.finish', ref: TRACK, at: NOW - 20_000, data: { listened_ms: 180_000 } }),
    ev({ type: 'Music' }),
    ev({ at: NOW - 31 * DAY }),
    ev({ data: { blob: 'x'.repeat(3_000) } }),
    ev({ ref: 'not a ref' }),
    ev({ id: 'not-an-id' }),
    ev({ type: 'health.note', at: NOW - 10_000, ref: 'fact:x', data: { note: 'private' }, sensitivity: 1 }),
  ];

  it('stores the good events on the owner’s day and names each bad one', async () => {
    const r = await put(batch, events);
    expect(r).toEqual({
      status: 200,
      body: {
        accepted: 4,
        rejected: [
          { i: 3, reason: 'bad_type' },
          { i: 4, reason: 'bad_time' },
          { i: 5, reason: 'too_large' },
          { i: 6, reason: 'bad_ref' },
          { i: 7, reason: 'bad_id' },
        ],
      },
    });
    const rows = await sql<{ day: string; app: string; type: string; origin: string }>(
      'SELECT day, app, type, origin FROM events ORDER BY seq',
    );
    expect(rows.map((e) => [e.day, e.app, e.type, e.origin])).toEqual([
      [today, 'music', 'music.play', 'device'],
      [today, 'music', 'music.skip', 'device'],
      [today, 'music', 'music.finish', 'device'],
      [today, 'health', 'health.note', 'device'],
    ]);
  });

  it('the same batch again changes nothing; other bytes under its id are a conflict', async () => {
    expect((await put(batch, events)).body).toEqual({ accepted: 4, rejected: [] });
    expect(await sql('SELECT count(*) AS n FROM events')).toEqual([{ n: 4 }]);
    expect((await put(batch, events.slice(0, 2))).status).toBe(409);
    expect((await put(uuidv7(), [])).status).toBe(422);
    expect((await put(uuidv7(), [ev()], p.C)).status).toBe(403);
  });

  it('a batch over 256 KB is refused before it is read', async () => {
    const big = Array.from({ length: 200 }, () => ev({ data: { pad: 'x'.repeat(1_500) } }));
    expect((await api('PUT', `/v1/senses/batches/${uuidv7()}`, { token: p.D, body: { events: big } })).status).toBe(
      413,
    );
  });
});

describe('the agents’ questions', () => {
  it('counts by day, top refs, a day in order, the last of a type, and a day’s summary', async () => {
    const counts = await ask('counts_by_day', { from: today, to: today, type: 'music.skip' });
    expect(counts.body.rows).toEqual([{ day: today, type: 'music.skip', n: 1, sum_ms: 201_000 }]);
    expect((await ask('top_refs', { type: 'music.play', days: 7 }, R)).body.rows).toEqual([
      { ref: TRACK, n: 1, sum_ms: 0 },
    ]);
    const seq = (await ask('sequence', { day: today }, p.C)).body.rows as {
      type: string;
      ref?: string;
      data?: object;
    }[];
    expect(seq.map((e) => e.type)).toEqual(['music.play', 'music.skip', 'music.finish', 'health.note']);
    // A sensitive event: its type and time, never its ref or data.
    expect(seq[3]).not.toHaveProperty('ref');
    expect(seq[3]).not.toHaveProperty('data');
    expect((await ask('sequence', { day: today, type_prefix: 'music.skip' })).body.rows).toHaveLength(1);
    expect((await ask('last_event', { type: 'music.finish' })).body.rows).toMatchObject([
      { type: 'music.finish', ref: TRACK, data: { listened_ms: 180_000 } },
    ]);
    const summary = (await ask('day_summary', { day: today })).body.rows as { type: string; n: number }[];
    expect(summary.reduce((n, t) => n + t.n, 0)).toBe(4);
  });

  it('only named queries with checked parameters; the device and the sandbox get none', async () => {
    const bad = await ask('drop_table', {});
    expect([bad.status, bad.body.error?.details[0].path]).toEqual([422, 'name']);
    const day = await ask('counts_by_day', { from: 'yesterday', to: today });
    expect([day.status, day.body.error?.details[0].path]).toEqual([422, 'params.from']);
    expect((await ask('sequence', { day: today }, p.D)).status).toBe(403);
    const sandboxed = await apiJson<{ error: { code: string } }>('POST', '/v1/senses/query', {
      token: p.N,
      headers: { 'TH-Sandbox': 'eval' },
      body: { name: 'last_event', params: { type: 'music.play' } },
    });
    expect(sandboxed.status).toBe(422);
  });
});

describe('the daily pass', () => {
  it('archives each finished day, again after a late event, and prunes past 90 days once archived', async () => {
    const yesterday = logicalDay(NOW - DAY, 'UTC');
    await put(uuidv7(), [ev({ at: NOW - DAY, type: 'music.play', ref: TRACK })]);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    const first = await senses().daily(NOW + DAY, tomorrow);
    expect(first.archived).toEqual(expect.arrayContaining([today, yesterday]));
    const text = await gunzip(await ((await env.VAULT.get(`senses/${today}.jsonl.gz`)) as R2ObjectBody).arrayBuffer());
    expect(text.trim().split('\n')).toHaveLength(4);
    expect((await senses().daily(NOW + DAY, tomorrow)).archived).toEqual([]);
    // A late event for an archived day: that day is archived again, with it.
    await put(uuidv7(), [ev({ at: NOW - DAY + 1_000, type: 'music.skip', ref: TRACK })]);
    expect((await senses().daily(NOW + DAY, tomorrow)).archived).toEqual([yesterday]);
    // An old, archived day goes; its rollups and archive stay.
    const old = new Date(NOW - 100 * DAY).toISOString().slice(0, 10);
    await sql(
      `INSERT INTO events (id, at, day, app, type, device_id, origin) VALUES ('${uuidv7()}', ?, ?, 'music', 'music.play', 'd', 'device')`,
      NOW - 100 * DAY,
      old,
    );
    await sql("INSERT INTO exports (day, r2_key, n, sha256, at) VALUES (?, 'senses/x', 1, 'x', 0)", old);
    expect((await senses().daily(NOW, today)).pruned).toBeGreaterThanOrEqual(1);
    expect(await sql('SELECT count(*) AS n FROM events WHERE day = ?', old)).toEqual([{ n: 0 }]);
  });
});
