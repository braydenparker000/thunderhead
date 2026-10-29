// P5 step 2: the music catalog moves to the Music object (MIGRATION.md I7) and is served from it
// (MUSIC.md §1.3, §6.1). From an old export of `music_tracks` and `music_log`: the tracks keep
// their ids, keys, order and records exactly; malformed rows are skipped with their reason; the
// log waits for the tracks; a second run changes nothing. Then the catalog in the ported player's
// format under an ETag (304 when unchanged, 409 before any import), one track's waveform, and
// signed links: the device's only, music refs only, the same link all hour, 503 without a key.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MediaSignResponse, MusicCatalog } from '../../../shared/contract/music.ts';
import { app } from '../../src/app';
import { presign } from '../../src/areas/music/sign';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { BASE, exportRun, importKey, untilDone } from '../import-helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let R = '';
const RUN = 'run-music-1';
const sha = (c: string) => c.repeat(64);
const WAVE = btoa(String.fromCharCode(...Array.from({ length: 40 }, (_, i) => i * 6)));
const record = (id: string, s: string, extra: object = {}) => ({
  id,
  sha256: s,
  size: 4_000_000,
  audioKey: `native/audio/${s}.opus`,
  mimeType: 'audio/ogg',
  path: `Cloudflare R2/Album/${id}.opus`,
  r2Identity: { size: 4_000_000, etag: `e-${id}`, lastModified: '2026-10-01T00:00:00.000Z' },
  metadata: { title: `Song ${id}`, artist: 'An Artist', dur: 201.5 },
  ...extra,
});
const row = (ord: number, id: string, s: string, over: object = {}) => {
  const r = record(id, s, 'cover' in over ? { coverKey: `native/art/${s}.jpg`, coverSha256: s } : {});
  return {
    ord,
    id,
    sha256: s,
    size: 4_000_000,
    audio_key: `native/audio/${s}.opus`,
    cover_key: 'cover' in over ? `native/art/${s}.jpg` : null,
    record: JSON.stringify(r),
    waveform: null,
    updated_ms: BASE + ord,
    ...over,
  };
};
const A = `r2_native_${sha('a')}`;
const B = `r2_native_${sha('b')}`;
const C = `r2_native_${sha('c')}`;
const TRACKS = [
  [row(3, A, sha('a'), { waveform: WAVE, cover: true }), row(1, B, sha('b')), row(5, 'r2_native_bad', 'not-a-hash')],
  [
    row(2, C, sha('c'), { waveform: 'not a waveform' }),
    { ...row(4, `r2_native_${sha('d')}`, sha('d')), record: JSON.stringify(record(A, sha('d'))) },
  ],
];
const LOG = [
  [
    { seq: 7, at_ms: BASE + 7, op: 'register', track_id: A, before: null },
    { seq: 8, at_ms: BASE + 8, op: 'patch', track_id: B, before: JSON.stringify(record(B, sha('b'))) },
  ],
];
const start = (id: string, dataset: string) =>
  apiJson<{ import_id: string }>('POST', '/v1/import/runs', { token: p.D, body: { id, run_id: RUN, dataset } });

beforeAll(async () => {
  p = await principals();
  R = await makeAgent(p.D, 'mind:reflex');
  const k = await importKey(p.D);
  await exportRun(k, RUN, { 'music-catalog-v1/music_tracks': TRACKS, 'music-catalog-v1/music_log': LOG });
});

describe('the music catalog, imported (I7)', () => {
  it('there is no catalog before the import: 409, never an empty library', async () => {
    const r = await apiJson<{ error: { code: string } }>('GET', '/v1/music/catalog', { token: p.D });
    expect([r.status, r.body.error.code]).toEqual([409, 'conflict']);
  });

  it('tracks keep their ids, keys, order and records; bad rows are skipped with their reason', async () => {
    expect((await start(uuidv7(), 'music_log')).status).toBe(422);
    const id = uuidv7();
    expect((await start(id, 'music')).status).toBe(202);
    const s = await untilDone(p.D, id);
    expect(s).toMatchObject({
      state: 'done',
      counts: { expected: 5, imported: 3, skipped: 2, skip_reasons: { empty: 1, invalid_ref: 1 } },
      report: { spot_checks: { checked: 5, passed: 5, failed: [] }, rows_changed: 3, rerun_delta: null },
    });
    const [told] = await coreSql<{ what: string }>(
      "SELECT what FROM ledger WHERE why = 'the import of run run-music-1'",
    );
    expect(told.what).toBe('Imported 3 of 5 songs (2 skipped); 5 of 5 spot checks matched; 3 rows changed.');

    const res = await api('GET', '/v1/music/catalog', { token: p.D });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const etag = res.headers.get('ETag') ?? '';
    // One version a part that changed something.
    expect(etag).toMatch(/^"m2-[0-9a-z]+"$/);
    const text = await res.text();
    const cat = JSON.parse(text) as MusicCatalog;
    expect(cat).toMatchObject({ version: 1, kind: 'r2-library', complete: true, count: 3 });
    expect(Number.isFinite(Date.parse(cat.generatedAt))).toBe(true);
    // In the old catalog's order, each record exactly as stored; a waveform to fetch is flagged.
    expect(cat.tracks.map((t) => t.id)).toEqual([B, C, A]);
    expect(cat.tracks[2]).toEqual({ ...JSON.parse(TRACKS[0][0].record), waveformBars: true });
    expect(cat.tracks[0]).toEqual(JSON.parse(TRACKS[0][1].record));
    expect(cat.tracks[1]).not.toHaveProperty('waveformBars');

    const again = await api('GET', '/v1/music/catalog', { token: p.D, headers: { 'If-None-Match': etag } });
    expect([again.status, again.headers.get('ETag'), await again.text()]).toEqual([304, etag, '']);

    // A second run changes no row, and the catalog's ETag stays.
    const rerun = uuidv7();
    await start(rerun, 'music');
    expect((await untilDone(p.D, rerun)).report).toMatchObject({ rows_changed: 0, rerun_delta: 0 });
    expect((await api('GET', '/v1/music/catalog', { token: p.D })).headers.get('ETag')).toBe(etag);
  });

  it('the change log follows, by its old sequence numbers', async () => {
    const id = uuidv7();
    expect((await start(id, 'music_log')).status).toBe(202);
    expect(await untilDone(p.D, id)).toMatchObject({
      state: 'done',
      counts: { expected: 2, imported: 2, skipped: 0 },
      report: { spot_checks: { checked: 2, passed: 2 } },
    });
  });

  it('a song uploaded through the new Worker keeps its place when the import runs again (N4, then N3)', async () => {
    const h = sha('e');
    await env.MEDIA.put(`native/audio/${h}.opus`, new Uint8Array(1234), {
      customMetadata: { 'verified-sha256': h, verification: 'worker-upload-sha256-v1' },
    });
    const music = env.MUSIC.get(env.MUSIC.idFromName('library'));
    const reg = (await music.write('register', {
      sha256: h,
      size: 1234,
      name: 'Uploaded.opus',
      metadata: { title: 'Uploaded', artist: 'Someone', dur: 10 },
    })) as unknown as { status: number; body: { id: string } };
    expect(reg.status).toBe(200);
    const rerun = uuidv7();
    await start(rerun, 'music');
    expect(await untilDone(p.D, rerun)).toMatchObject({
      state: 'done',
      counts: { imported: 3, skipped: 2 },
      report: { rows_changed: 0 },
    });
    const cat = (await apiJson<MusicCatalog>('GET', '/v1/music/catalog', { token: p.D })).body;
    expect(cat.tracks.map((t) => t.id)).toEqual([B, C, A, reg.body.id]);
  });

  it('a waveform is one track at a time; the catalog and waveforms are the device’s only', async () => {
    const w = await apiJson<{ id: string; bars: string }>('GET', `/v1/music/waveforms/${A}`, { token: p.D });
    expect(w).toEqual({ status: 200, body: { id: A, bars: WAVE } });
    for (const id of [C, 'r2_native_nope', 'x'])
      expect((await api('GET', `/v1/music/waveforms/${id}`, { token: p.D })).status).toBe(404);
    expect((await api('GET', '/v1/music/catalog', { token: p.C })).status).toBe(403);
    expect((await api('GET', `/v1/music/waveforms/${A}`, { token: p.N })).status).toBe(403);
  });
});

describe('signed links (POST /v1/media/sign)', () => {
  const KEYED = {
    ...env,
    R2_ACCOUNT_ID: 'f'.repeat(32),
    R2_SIGN_ACCESS_KEY_ID: 'test-access-key-id',
    R2_SIGN_SECRET: 'test-secret-not-real',
  } as Env;
  const sign = (token: string, refs: string[]) =>
    app.fetch(
      new Request('https://api.example.test/v1/media/sign', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        body: JSON.stringify({ refs }),
      }),
      KEYED,
      createExecutionContext(),
    );

  it('SigV4 matches AWS’s own presigned-URL example', async () => {
    // AWS's published example key (S3 docs, "query string authentication"), joined here so the
    // repository's credential scan doesn't take it for a real one.
    const url = await presign({
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      id: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
      secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      at: Date.parse('2013-05-24T00:00:00Z'),
      expires: 86_400,
    });
    expect(url).toMatch(/&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  });

  it('without the signing key, 503 not_configured', async () => {
    const r = await apiJson<{ error: { code: string } }>('POST', '/v1/media/sign', {
      token: p.D,
      body: { refs: [`music:${A}`] },
    });
    expect([r.status, r.body.error.code]).toEqual([503, 'not_configured']);
  });

  it('the device gets a track’s audio and art, signed at the hour for 3 h; the rest is named', async () => {
    const refs = [`music:${A}`, `music:${A}#art`, `music:${B}#art`, 'music:r2_native_nope', 'book:x', 'music:'];
    const res = await sign(p.D, refs);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MediaSignResponse;
    expect(body.items.map((i) => i.ref)).toEqual([`music:${A}`, `music:${A}#art`]);
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    for (const [item, key] of [
      [body.items[0], `native/audio/${sha('a')}.opus`],
      [body.items[1], `native/art/${sha('a')}.jpg`],
    ] as const) {
      const u = new URL(item.url);
      expect(`${u.host}${u.pathname}`).toBe(`${'f'.repeat(32)}.r2.cloudflarestorage.com/jarvis-music/${key}`);
      expect(u.searchParams.get('X-Amz-Expires')).toBe('10800');
      expect(u.searchParams.get('X-Amz-Date')).toBe(new Date(hour).toISOString().replace(/[-:]|\.\d{3}/g, ''));
      expect(u.searchParams.get('X-Amz-Credential')).toMatch(/^test-access-key-id\/\d{8}\/auto\/s3\/aws4_request$/);
      expect(item.expires_at).toBe(hour + 3 * 3_600_000);
    }
    expect(body.errors).toEqual([
      { ref: 'book:x', code: 'not_signable' },
      { ref: 'music:', code: 'not_signable' },
      { ref: `music:${B}#art`, code: 'not_found' },
      { ref: 'music:r2_native_nope', code: 'not_found' },
    ]);
    // The same ref signs to the same link all hour, so the phone's cache works.
    const second = (await (await sign(p.D, [`music:${A}`])).json()) as MediaSignResponse;
    expect(second.items[0].url).toBe(body.items[0].url);
  });

  it('a mind may not sign music; more than 50 refs are refused', async () => {
    const mind = (await (await sign(p.C, [`music:${A}`])).json()) as MediaSignResponse;
    expect(mind).toEqual({ items: [], errors: [{ ref: `music:${A}`, code: 'not_signable' }] });
    expect(
      (
        await sign(
          p.D,
          Array.from({ length: 51 }, (_, i) => `music:r2_native_${i}`),
        )
      ).status,
    ).toBe(422);
    expect((await sign(R, [`music:${A}`])).status).toBe(403);
  });
});
