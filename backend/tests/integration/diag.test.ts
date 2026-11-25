// GET /v1/ops/diag (API.md §11.16, shared/contract/diag.ts): the live Worker's state for the lead's
// diagnosis from outside, to the owner's device and the CI key only: Core's jobs without their
// payloads, today's bulk lane, the quota, each class's rows today, the music knowledge job's counts,
// hosts, keys and facts rows by kind and by source still to ask, and the version. Never a name: a
// seeded artist, album and a job's payload naming one do not appear. Invented names only.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import type { DiagResponse } from '../../../shared/contract/diag.ts';
import { DAY_BUDGET } from '../../../shared/contract/meter.ts';
import { utcDay } from '../../src/lib/time';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';
import { musicSql } from '../know-helpers';

const ARTIST = 'Invented Lantern Choir';
const ALBUM = 'Invented Paper Harbour';
const DAY = 86_400_000;
let owner: string;
let ci: string;
let chat: string;

beforeAll(async () => {
  owner = (await setupOwner()).token;
  ci = await makeAgent(owner, 'ci');
  chat = await makeAgent(owner, 'mind:chat');
  const now = Date.now();
  await coreSql(
    `INSERT INTO jobs (id, kind, state, due_at, payload_json, cursor_json, attempts, last_error, rows_written,
       created_at, updated_at)
     VALUES ('diag-job', 'music.history', 'paused', ?, ?, NULL, 2, 'load_failed:Error', 120, ?, ?)`,
    now + DAY,
    JSON.stringify({ album: ALBUM, artist: ARTIST }),
    now - 1000,
    now,
  );
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('bulk.day', ?, ?, 'worker')
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    JSON.stringify({ day: utcDay(now), rows: 1234 }),
    now,
  );
  for (const [id, kind, name, todo, busy] of [
    ['a:00000000-0000-4000-8000-000000000001', 'artist', ARTIST, 'mb,disco', 1],
    ['g:00000000-0000-4000-8000-000000000002', 'album', ALBUM, 'wp', 0],
    ['g:00000000-0000-4000-8000-000000000003', 'album', ALBUM, '', 0],
  ] as const)
    await musicSql(
      `INSERT INTO know_facts (id, kind, name, prio, facts_json, outside_json, filled_json, todo, work_json, busy,
         due_at, at)
       VALUES (?, ?, ?, 1, ?, '{}', '{}', ?, '{}', ?, 0, 0)`,
      id,
      kind,
      name,
      JSON.stringify(kind === 'artist' ? { name } : { title: name, artist: { mbid: null, name: ARTIST } }),
      todo,
      busy,
    );
  await musicSql(
    `INSERT INTO music_state (key, value_json) VALUES ('know.hosts', ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    JSON.stringify({ 'musicbrainz.org': { fails: 1, until: now + 60_000, ok_at: now - 5000 } }),
  );
});

describe('GET /v1/ops/diag', () => {
  it('gives the device the jobs, the lane, the quota, the meter, the knowledge job and the version', async () => {
    const r = await apiJson<DiagResponse>('GET', '/v1/ops/diag', { token: owner });
    expect(r.status).toBe(200);
    const b = r.body;
    expect(Object.keys(b).sort()).toEqual(['at', 'jobs', 'know', 'lane', 'meter', 'quota', 'version']);
    expect(b.version).toEqual({ id: env.VERSION.id, tag: env.VERSION.tag || null });
    expect(b.jobs.find((j) => j.id === 'diag-job')).toEqual({
      id: 'diag-job',
      kind: 'music.history',
      state: 'paused',
      due_at: expect.any(Number),
      attempts: 2,
      last_error: 'load_failed:Error',
      rows_written: 120,
      created_at: expect.any(Number),
      updated_at: expect.any(Number),
    });
    expect(b.lane).toEqual({
      day: utcDay(Date.now()),
      rows: 1234,
      cap: 40_000,
      open: true,
      resume_at: expect.any(Number),
    });
    expect(b.quota.budget).toEqual(DAY_BUDGET);
    expect(b.quota.hold_at.rows_read).toBe(Math.floor((DAY_BUDGET.rows_read * 85) / 100));
    expect(b.quota.hold_until).toBeNull();
    expect(b.meter.find((m) => m.class === 'core')?.bulk_rows_written).toBe(1234);
    expect(b.know?.facts).toEqual({ artist: { busy: 1, idle: 0, todo: 1 }, album: { busy: 0, idle: 2, todo: 1 } });
    expect(b.know?.todo).toEqual({ mb: 1, disco: 1, wp: 1 });
    expect(b.know?.hosts['musicbrainz.org']).toEqual({
      fails: 1,
      until: expect.any(Number),
      ok_at: expect.any(Number),
      refused_at: null,
    });
    expect(Object.values(b.know?.keys ?? {}).every((k) => typeof k === 'boolean')).toBe(true);
    expect(b.know?.counts.artists).toEqual({ total: 1, done: 0 });
    // Never a name, nor a job's payload.
    const text = JSON.stringify(b);
    for (const name of [ARTIST, ALBUM, 'Invented']) expect(text).not.toContain(name);
  });

  it('answers the CI key too, and no mind key', async () => {
    const r = await apiJson<DiagResponse>('GET', '/v1/ops/diag', { token: ci });
    expect(r.status).toBe(200);
    expect(r.body.lane.rows).toBe(1234);
    const no = await apiJson<ErrorBody>('GET', '/v1/ops/diag', { token: chat });
    expect([no.status, no.body.error.code]).toEqual([403, 'forbidden']);
  });
});
