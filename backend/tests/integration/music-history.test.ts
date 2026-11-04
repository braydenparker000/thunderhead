// The listening-history import (MUSIC.md §11.1, areas/music/history-job.ts): a Spotify export of
// 6,000 invented streams summed into about 5,000 rows, put in three parts of at most 2,000 (one job
// step each, in the bulk lane), counted once per file by its SHA-256, a retried part a no-op.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HistoryStatus } from '../../../shared/contract/taste.ts';
import { useFetch } from '../../src/areas/music/history-mb';
import { parseExport, summarise } from '../../src/areas/music/history-parse';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { fakeBrainz, putHistory, spotifyRows } from '../history-helpers';
import { type Principals, principals } from '../memory-helpers';
import { music } from '../music-helpers';

const NAME = 'Streaming_History_Audio_2019-2023_0.json';
const ROWS = spotifyRows(6_000, 997, 5);
const BYTES = new TextEncoder().encode(JSON.stringify(ROWS));
const SUMMARY = summarise(parseExport(NAME, JSON.stringify(ROWS))?.plays ?? []);
const alarm = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
let p: Principals;
let sha = '';

beforeAll(async () => {
  useFetch(fakeBrainz([]));
  p = await principals();
});

describe('a listening-history file', () => {
  it('is taken, queued, and put in parts of 2,000 rows', async () => {
    expect(SUMMARY.length).toBeGreaterThan(4_500);
    const put = await putHistory(p.D, NAME, BYTES);
    sha = put.sha;
    expect([put.status, put.body.state, put.body.source]).toEqual([202, 'queued', 'spotify']);
    for (let i = 0; i < 10; i++) {
      await alarm();
      const [f] = (await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body.files;
      if (f?.state === 'done') break;
    }
    const s = (await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body;
    const plays = SUMMARY.reduce((n, r) => n + r.p, 0);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ sha256: sha, source: 'spotify', state: 'done', rows: SUMMARY.length, plays });
    expect(s.artists).toBe(997);
    const [job] = await coreSql<{ state: string; rows_written: number }>(
      `SELECT state, rows_written FROM jobs WHERE id = ?`,
      `history-${sha}`,
    );
    expect(job.state).toBe('done');
    const listens = await runInDurableObject(
      music(),
      (_o, st) => st.storage.sql.exec('SELECT COUNT(*) AS n FROM listens').one().n,
    );
    expect(listens).toBe(SUMMARY.length);
  });

  it('the same file again is answered done and counted once', async () => {
    const again = await putHistory(p.D, NAME, BYTES);
    expect([again.status, again.body.state]).toEqual([200, 'done']);
    const before = (await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body;
    // A part put again (a step retried after its load wrote it) writes nothing.
    expect(await music().putHistoryPart(sha, 2, SUMMARY.slice(2_000, 4_000))).toEqual({ written: 0, done: true });
    await alarm();
    expect((await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body.files).toEqual(before.files);
  });

  it('a file that is no export, or bytes that are not its hash, are refused', async () => {
    const r = await putHistory(p.D, 'notes.txt', new TextEncoder().encode('plain words'));
    expect(r.status).toBe(422);
    const ok = await putHistory(p.C, NAME, BYTES);
    expect(ok.status).toBe(403);
  });
});
