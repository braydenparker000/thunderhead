// The neighbours step, the phone's file and the mind's read (JOBS.md §3, MUSIC.md §9.1), with
// synthetic songs in four clusters: no neighbours job until every song is analysed; its spec carries
// no hash, only int8 embeddings; a checked answer replaces the last and rebuilds the phone file,
// whose neighbours stay in their cluster; a bad answer (a song its own neighbour) is refused and
// changes nothing; the mind reads one song's numbers and its nearest songs by title.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { LISTEN_LIMITS as L } from '../../../shared/contract/listen.ts';
import { JOBS_KEY } from '../../../shared/contract/routes.ts';
import { packHeader } from '../../src/areas/music/listen-pack';
import { api, apiJson, makeAgent, setupOwner } from '../helpers';
import { drain, manifest, musicSql, pack, put, result, seedTracks, sha } from '../listen-helpers';

const tokens = {} as Record<'D' | 'C' | 'N' | 'I', string>;
let shas: string[] = [];
const N = 30;

beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.I = await makeAgent(tokens.D, 'ci', JOBS_KEY);
  shas = await seedTracks(N, 0, 1);
});

const next = (q: string) =>
  apiJson<{ job_id: string; n: number; shas?: string[] }>('GET', `/v1/jobs/next?${q}`, { token: tokens.N });
const collect = (id: string) =>
  apiJson<{ state: string }>('POST', `/v1/jobs/${id}/collect`, { token: tokens.I, body: {} });
const status = (id: string) =>
  apiJson<{ state: string; counts: Record<string, unknown> }>('GET', `/v1/jobs/${id}`, { token: tokens.N });

/** Each song's 50 nearest by cosine on the int8 embeddings (ties by index), as the job works them out. */
function nearest(emb: Int8Array, n: number, selfAt?: number): Uint8Array {
  const out = new Uint8Array(n * L.k * 2);
  const v = new DataView(out.buffer);
  const norm = (i: number) => Math.sqrt(Array.from(emb.subarray(i * 32, i * 32 + 32)).reduce((s, x) => s + x * x, 0));
  for (let i = 0; i < n; i++) {
    const sims = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let dot = 0;
      for (let d = 0; d < 32; d++) dot += emb[i * 32 + d] * emb[j * 32 + d];
      sims.push({ j, s: dot / (norm(i) * norm(j)) });
    }
    sims.sort((a, b) => b.s - a.s || a.j - b.j);
    for (let q = 0; q < L.k; q++) v.setUint16((i * L.k + q) * 2, q < sims.length ? sims[q].j : 0xffff, true);
  }
  if (selfAt !== undefined) v.setUint16(selfAt * L.k * 2, selfAt, true);
  return out;
}

async function neighboursJob(selfAt?: number) {
  const j = await next('kind=audio.neighbours');
  expect(j.status).toBe(200);
  expect(JSON.stringify(j.body)).not.toMatch(/[0-9a-f]{64}/);
  const spec = await apiJson<{ n: number; k: number; dim: number; emb: string }>(
    'GET',
    `/v1/jobs/${j.body.job_id}/spec`,
    { token: tokens.I },
  );
  expect(spec.body).toMatchObject({ n: N, k: 50, dim: 32 });
  expect(spec.body.emb).not.toMatch(/[0-9a-f]{64}/);
  const emb = new Int8Array(Uint8Array.from(atob(spec.body.emb), (c) => c.charCodeAt(0)).buffer);
  expect(emb.length).toBe(N * 32);
  const file = nearest(emb, N, selfAt);
  expect((await put(tokens.I, j.body.job_id, 'neighbours.bin', file)).status).toBe(201);
  const m = {
    ...manifest(j.body.job_id, []),
    kind: 'audio.neighbours',
    n: N,
    k: L.k,
    bytes: file.length,
    sha256: await sha(file),
  };
  delete (m as Record<string, unknown>).files;
  delete (m as Record<string, unknown>).failed;
  expect((await put(tokens.I, j.body.job_id, 'manifest.json', JSON.stringify(m))).status).toBe(201);
  expect((await collect(j.body.job_id)).status).toBe(202);
  await drain();
  return j.body.job_id;
}

describe('the neighbours step', () => {
  it('waits until every song is analysed', async () => {
    expect((await next('kind=audio.neighbours')).status).toBe(204);
    const j = await next('kind=audio.analysis');
    expect(j.body.shas).toEqual(shas);
    expect((await next('kind=audio.neighbours')).status).toBe(204);
    const up = await pack(shas.map((s, i) => result(s, i)));
    await put(tokens.I, j.body.job_id, 'part-001.jsonl', up.parts[0]);
    await put(tokens.I, j.body.job_id, 'manifest.json', JSON.stringify(manifest(j.body.job_id, up.files)));
    expect((await collect(j.body.job_id)).status).toBe(202);
    await drain();
    expect((await status(j.body.job_id)).body.state).toBe('applied');
    expect((await next('kind=audio.analysis')).status).toBe(204);
  });

  it('builds the phone file with each song’s neighbours in its own cluster', async () => {
    const id = await neighboursJob();
    expect((await status(id)).body.state).toBe('applied');
    // One at a time: no second neighbours job while nothing changed.
    expect((await next('kind=audio.neighbours')).status).toBe(204);
    // Each track's row of track_analysis names its nearest tracks by id, in its cluster, never itself.
    const rows = await musicSql<{ track_id: string; neighbours_json: string }>(
      'SELECT track_id, neighbours_json FROM track_analysis',
    );
    expect(rows).toHaveLength(N);
    const index = new Map(shas.map((s, i) => [`r2_native_${s}`, i]));
    for (const r of rows) {
      const ids = JSON.parse(r.neighbours_json) as string[];
      const i = index.get(r.track_id) as number;
      expect(ids).toHaveLength(N - 1);
      expect(ids).not.toContain(r.track_id);
      expect(ids.slice(0, 6).every((id) => (index.get(id) as number) % 4 === i % 4)).toBe(true);
    }
    const res = await api('GET', '/v1/music/pack', { token: tokens.D });
    expect(res.status).toBe(200);
    const etag = res.headers.get('ETag') as string;
    const b = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe('THA1');
    const h = packHeader(b);
    expect(h.tracks).toBe(N);
    for (const [off] of Object.values(h.sections)) expect(off % 4).toBe(0);
    const ids = new TextDecoder().decode(b.subarray(...span(h.sections.ids))).split('\n');
    expect(ids).toEqual(shas.map((s) => `r2_native_${s}`));
    const nbr = new Uint16Array(b.buffer, h.sections.nbr[0], N * L.k);
    for (let i = 0; i < N; i++) {
      const row = Array.from(nbr.subarray(i * L.k, i * L.k + L.k));
      expect(row.slice(0, 6).every((x) => x % 4 === i % 4 && x !== i)).toBe(true);
      expect(row.slice(N - 1).every((x) => x === 0xffff)).toBe(true);
    }
    const bpm = new Uint16Array(b.buffer, h.sections.bpm[0], N);
    expect(bpm[3]).toBe(930);
    expect(b[h.sections.camelot[0] + 9]).toBe(22); // song 9 is in A: 11B, the 22nd place (1A=1, 1B=2 …)
    // Unchanged: 304 by its ETag.
    expect((await api('GET', '/v1/music/pack', { token: tokens.D, headers: { 'If-None-Match': etag } })).status).toBe(
      304,
    );
  });

  it('refuses an answer that names a song as its own neighbour, keeping the last', async () => {
    const before = await musicSql<{ value_json: string }>(
      "SELECT value_json FROM music_state WHERE key = 'listen.neighbours'",
    );
    await musicSql("UPDATE music_state SET value_json = '99' WHERE key = 'listen.epoch'");
    const id = await neighboursJob(7);
    expect((await status(id)).body).toMatchObject({ state: 'rejected', counts: { invalid: 1, reasons: { index: 1 } } });
    expect(await musicSql("SELECT value_json FROM music_state WHERE key = 'listen.neighbours'")).toEqual(before);
    expect((await env.VAULT.list({ prefix: 'jobs/' })).objects).toHaveLength(0);
  });
});

const span = ([o, s]: [number, number]): [number, number] => [o, o + s];

describe('the mind’s read of one song', () => {
  it('gives its numbers, Camelot place, strongest moods and nearest songs by title', async () => {
    const r = await apiJson<{
      state: string;
      analysis: { bpm: number; key: string; camelot: string; top_moods: string[] };
      like: { id: string; title: string; sim: number }[];
      like_at: number;
    }>('GET', `/v1/music/analysis/r2_native_${shas[9]}?like=5`, { token: tokens.C });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('done');
    expect(r.body.analysis).toMatchObject({ bpm: 99, key: 'A', camelot: '11B' });
    expect(r.body.analysis.top_moods).toHaveLength(3);
    expect(r.body.like).toHaveLength(5);
    for (const x of r.body.like) expect(Number(x.title.split(' ')[1]) % 4).toBe(1);
    const sims = r.body.like.map((x) => x.sim);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
    expect(r.body.like_at).toBeGreaterThan(0);
    const night = await apiJson('GET', `/v1/music/analysis/r2_native_${shas[9]}`, { token: tokens.N });
    expect(night.status).toBe(200);
  });

  it('says when a song cannot be analysed, and 404 for no such song', async () => {
    const old = await apiJson<{ state: string; analysis: null }>('GET', '/v1/music/analysis/r2_oldsong00000030', {
      token: tokens.C,
    });
    expect(old.body).toMatchObject({ state: 'unsupported', analysis: null, like: [] });
    expect((await apiJson('GET', '/v1/music/analysis/r2_native_nope', { token: tokens.C })).status).toBe(404);
  });
});

describe('a night with nothing due', () => {
  it('skips the catalog scan until the catalog changes, then finds the new song', async () => {
    expect((await next('kind=audio.analysis')).status).toBe(204);
    const idle = await musicSql<{ value_json: string }>("SELECT value_json FROM music_state WHERE key = 'listen.idle'");
    expect(JSON.parse(idle[0].value_json)).toMatchObject({ analyzer: '2.0.0' });
    const [added] = await seedTracks(1, 200);
    const j = await next('kind=audio.analysis');
    expect(j.status).toBe(200);
    expect(j.body.shas).toEqual([added]);
  });
});
