// The listening pass's analysis jobs end to end (JOBS.md §3.3–3.5), with synthetic songs and
// results only: issuing specs (catalog order, one per hash, never twice, at most two open), the spec
// for CI alone, uploads into the private bucket (names, sizes, manifest last), every check on
// collect (a bad manifest applies nothing; one bad file among many applies the rest; sizes, hashes,
// schema, unknown keys, a result naming another song, duplicates, hashes not in the spec), applying
// under the bulk lane (pauses at the cap, a repeated part counts once), expiry, and that no status
// ever carries a hash.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { LISTEN_LIMITS as L } from '../../../shared/contract/listen.ts';
import { utcDay } from '../../src/lib/time';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';
import { drain, manifest, music, musicSql, pack, put, result, seedTracks } from '../listen-helpers';

const tokens = {} as Record<'D' | 'C' | 'N' | 'I', string>;
let shas: string[] = [];

beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.I = await makeAgent(tokens.D, 'ci');
  // 120 songs the pass can take, then 3 on old keys it can't; one more track shares song 0's audio.
  shas = await seedTracks(120, 0, 3);
  const dup = { id: 'r2_dup_of_song_zero', sha256: shas[0], metadata: { title: 'Song 0 again' } };
  await music().importTracks(
    [
      {
        ord: 500,
        id: dup.id,
        sha256: shas[0],
        size: 1000,
        audio_key: `native/audio/${shas[0]}.opus`,
        cover_key: null,
        record_json: JSON.stringify(dup),
        waveform: null,
        updated_at: Date.now(),
      },
    ],
    Date.now(),
  );
});

const next = (token: string, q = 'kind=audio.analysis&max=50') =>
  apiJson<{ job_id: string; kind: string; v: number; shas: string[] }>('GET', `/v1/jobs/next?${q}`, { token });
const status = (id: string, token = tokens.C) =>
  apiJson<{ state: string; count: number; counts: Record<string, unknown> | null }>('GET', `/v1/jobs/${id}`, { token });
const collect = (id: string, token = tokens.I) =>
  apiJson<{ state: string }>('POST', `/v1/jobs/${id}/collect`, { token, body: {} });
const noHashIn = (text: string) => {
  for (const s of shas) expect(text.includes(s)).toBe(false);
};

let first = '';
let second = '';

describe('issuing specs', () => {
  it('gives the oldest due songs, one per audio hash, and never the same song twice', async () => {
    const a = await next(tokens.N);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ kind: 'audio.analysis', v: 2 });
    expect(a.body.shas).toEqual(shas.slice(0, 50));
    first = a.body.job_id;
    const b = await next(tokens.I);
    expect(b.body.shas).toEqual(shas.slice(50, 100));
    second = b.body.job_id;
  });

  it('refuses a third open job of the kind', async () => {
    const c = await next(tokens.N);
    expect(c.status).toBe(409);
    expect((c.body as unknown as { error: { details: unknown } }).error.details).toEqual({ reason: 'open_jobs' });
  });

  it('gives the spec to the ci key alone, and a status to agents without a hash', async () => {
    const spec = await apiJson<{ shas: string[]; analyzer: unknown }>('GET', `/v1/jobs/${first}/spec`, {
      token: tokens.I,
    });
    expect(spec.status).toBe(200);
    expect(spec.body.shas).toHaveLength(50);
    expect(spec.body.analyzer).toEqual({ name: 'th-audio', version: '2.0.0' });
    expect((await apiJson('GET', `/v1/jobs/${first}/spec`, { token: tokens.N })).status).toBe(403);
    const s = await status(first);
    expect(s.body).toMatchObject({ state: 'issued', count: 50, counts: null });
    const list = await apiJson<{ items: unknown[] }>('GET', '/v1/jobs?open=1', { token: tokens.C });
    expect(list.body.items).toHaveLength(2);
    noHashIn(JSON.stringify(s.body) + JSON.stringify(list.body));
  });
});

describe('uploads', () => {
  it('takes only the job’s own file names, within their sizes', async () => {
    const one = new TextEncoder().encode('{}\n');
    expect((await put(tokens.I, first, 'part-001.jsonl', one)).status).toBe(201);
    // 50 songs make one part: there is no part 2, and no other names.
    expect((await put(tokens.I, first, 'part-002.jsonl', one)).status).toBe(404);
    expect((await put(tokens.I, first, 'neighbours.bin', one)).status).toBe(404);
    expect((await put(tokens.I, first, '..%2Fmanifest.json', one)).status).toBe(404);
    const big = new Uint8Array(L.part_bytes + 1);
    expect((await put(tokens.I, first, 'part-001.jsonl', big)).status).toBe(413);
    expect((await put(tokens.N, first, 'part-001.jsonl', one)).status).toBe(403);
    expect((await put(tokens.I, '0190a0a0-0000-7000-8000-000000000000', 'part-001.jsonl', one)).status).toBe(404);
  });
});

describe('collecting', () => {
  it('without a manifest: 409 while issued', async () => {
    const r = await collect(first);
    expect(r.status).toBe(409);
  });

  it('applies the valid results, counts the rest by reason, and keeps no upload', async () => {
    const results = shas.slice(0, 47).map((s, i) => result(s, i));
    results[3] = result(shas[3], 3, { sha256: shas[4] }); // names another song (check 5, key)
    results[4] = { ...result(shas[4], 4), note: 'free text' }; // an unknown field (schema)
    results[5] = result(shas[5], 5, { bpm: 999 }); // out of range (schema)
    // The manifest lists song 3 under its own hash; its result says it is song 4.
    const up = await pack(results, { 3: { sha256: shas[3] }, 6: { result_sha256: '0'.repeat(64) }, 7: { bytes: 10 } });
    expect((await put(tokens.I, first, 'part-001.jsonl', up.parts[0])).status).toBe(201);
    const failed = [
      { sha256: shas[47], reason: 'decode' },
      { sha256: shas[48], reason: 'hash_mismatch' },
    ];
    const m = JSON.stringify(manifest(first, up.files, failed));
    expect((await put(tokens.I, first, 'manifest.json', m)).status).toBe(201);
    // The manifest goes last: no part after it.
    expect((await put(tokens.I, first, 'part-001.jsonl', up.parts[0])).status).toBe(409);
    const c = await collect(first);
    expect(c.status).toBe(202);
    expect(c.body).toEqual({ state: 'validating' });
    await drain();
    const s = await status(first);
    expect(s.body.state).toBe('applied');
    expect(s.body.counts).toEqual({
      expected: 50,
      valid: 42,
      invalid: 5,
      failed: 2,
      missing: 1,
      reasons: { key: 1, schema: 2, hash: 1, size: 1 },
    });
    const rows = await musicSql<{ n: number; f: number }>(
      'SELECT count(result_json) AS n, count(failed) AS f FROM analysis',
    );
    expect(rows[0]).toEqual({ n: 42, f: 2 });
    // A stored result holds the schema's fields only, and the lane counted its rows.
    const kept = await musicSql<{ result_json: string }>('SELECT result_json FROM analysis WHERE sha256 = ?', shas[0]);
    expect(Object.keys(JSON.parse(kept[0].result_json))).not.toContain('note');
    const lane = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'bulk.day'");
    expect(JSON.parse(lane[0].value_json).rows).toBeGreaterThanOrEqual(42);
    const left = await env.VAULT.list({ prefix: `jobs/incoming/${first}/` });
    expect(left.objects).toHaveLength(0);
    // Collecting again changes nothing.
    expect((await collect(first, tokens.N)).body).toEqual({ state: 'applied' });
  });

  it('a bad manifest rejects the job and applies nothing', async () => {
    const before = await musicSql<{ n: number }>('SELECT count(*) AS n FROM analysis');
    const up = await pack(shas.slice(50, 60).map((s, i) => result(s, 50 + i)));
    await put(tokens.I, second, 'part-001.jsonl', up.parts[0]);
    // A hash not in the spec.
    const bad = manifest(second, [...up.files, { ...up.files[0], sha256: 'f'.repeat(64) }]);
    await put(tokens.I, second, 'manifest.json', JSON.stringify(bad));
    const r = await collect(second);
    expect(r.status).toBe(422);
    expect((await status(second)).body.state).toBe('rejected');
    expect(await musicSql('SELECT count(*) AS n FROM analysis')).toEqual(before);
    expect((await env.VAULT.list({ prefix: `jobs/incoming/${second}/` })).objects).toHaveLength(0);
  });

  it('refuses duplicates, unknown keys, other kinds and a manifest over 1 MB', async () => {
    const cases: [string, (id: string, f: Awaited<ReturnType<typeof pack>>['files']) => string][] = [
      ['duplicate', (id, f) => JSON.stringify(manifest(id, [f[0], f[0]]))],
      [
        'duplicate across lists',
        (id, f) => JSON.stringify(manifest(id, f, [{ sha256: f[0].sha256, reason: 'decode' }])),
      ],
      ['unknown key', (id, f) => JSON.stringify({ ...manifest(id, f), extra: 1 })],
      ['another job', (_id, f) => JSON.stringify(manifest('0190a0a0-0000-7000-8000-000000000000', f))],
      ['another kind', (id, f) => JSON.stringify({ ...manifest(id, f), kind: 'audio.neighbours' })],
      ['a bad reason', (id, f) => JSON.stringify(manifest(id, f, [{ sha256: 'a'.repeat(64), reason: 'because' }]))],
      ['not JSON', () => '{"v":1,'],
      ['too large', (id, f) => JSON.stringify({ ...manifest(id, f), pad: 'x'.repeat(L.manifest_bytes) })],
    ];
    for (const [name, make] of cases) {
      const j = await next(tokens.N, 'kind=audio.analysis&max=5');
      expect(j.status, name).toBe(200);
      const up = await pack(j.body.shas.map((s, i) => result(s, i)));
      await put(tokens.I, j.body.job_id, 'part-001.jsonl', up.parts[0]);
      const body = make(j.body.job_id, up.files);
      if (body.length <= L.manifest_bytes) await put(tokens.I, j.body.job_id, 'manifest.json', body);
      else await env.VAULT.put(`jobs/incoming/${j.body.job_id}/manifest.json`, body);
      expect((await collect(j.body.job_id)).status, name).toBe(422);
      expect((await status(j.body.job_id)).body.state, name).toBe('rejected');
    }
  });
});

describe('expiry', () => {
  it('a spec not collected in 72 hours expires and its songs are due again', async () => {
    const j = await next(tokens.N, 'kind=audio.analysis&max=3');
    const id = j.body.job_id;
    await put(tokens.I, id, 'part-001.jsonl', '{}');
    await musicSql('UPDATE external_jobs SET expires_at = ? WHERE id = ?', Date.now() - 1, id);
    expect((await apiJson('GET', `/v1/jobs/${id}/spec`, { token: tokens.I })).status).toBe(410);
    expect((await collect(id)).status).toBe(410);
    const again = await next(tokens.N, 'kind=audio.analysis&max=3');
    expect((await status(id)).body.state).toBe('expired');
    expect(again.body.shas).toEqual(j.body.shas);
    expect((await env.VAULT.list({ prefix: `jobs/incoming/${id}/` })).objects).toHaveLength(0);
  });
});

describe('applying under the bulk lane', () => {
  it('pauses at the lane’s daily cap, then a repeated part counts once', async () => {
    const j = await next(tokens.N, 'kind=audio.analysis&max=2');
    const id = j.body.job_id;
    const up = await pack(j.body.shas.map((s, i) => result(s, 200 + i)));
    await put(tokens.I, id, 'part-001.jsonl', up.parts[0]);
    await put(tokens.I, id, 'manifest.json', JSON.stringify(manifest(id, up.files)));
    const day = utcDay(Date.now());
    await coreSql(
      "UPDATE settings SET value_json = ? WHERE key = 'bulk.day'",
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
