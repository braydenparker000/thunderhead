// P5 step 3: the upload tools on the new Worker (MIGRATION.md §7 step 4). Every request is signed by
// a tool key (Ed25519; a fresh test key here); audio and art are checked against the signed hash
// and their format and stored once, verified, under their content address in jarvis-music (the
// local test bucket); the catalog writer's operations change the Music object one at a time, each
// logged and moving the catalog's ETag; nothing is ever deleted from the bucket.
import { createExecutionContext, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MusicCatalog } from '../../../shared/contract/music.ts';
import { app } from '../../src/app';
import { signatureMessage } from '../../src/areas/music/validate';
import { setupOwner } from '../helpers';

const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
const WAVE = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i * 7)));
const enc = new TextEncoder();
/** A tiny Ogg Opus look-alike: the magic and the Opus head where the Worker looks, then noise. */
const ogg = (seed: number) => {
  const b = new Uint8Array(400 + seed);
  b.set(enc.encode('OggS'), 0);
  b.set(enc.encode('OpusHead'), 28);
  for (let i = 40; i < b.length; i++) b[i] = (i * 31 + seed) % 251;
  return b;
};
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 60 }, (_, i) => i)]);

let keys: CryptoKeyPair;
let pub = '';
let owner = '';
let E: Env;

async function send(
  method: string,
  path: string,
  bytes: Uint8Array,
  type: string,
  over: { time?: number; key?: CryptoKeyPair; headers?: Record<string, string>; env?: Env } = {},
) {
  const k = over.key ?? keys;
  const key = hex((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer);
  const time = String(over.time ?? Math.floor(Date.now() / 1000));
  const hash = await sha(bytes);
  const url = `https://api.example.test/v1/music/uploads/${path}`;
  const message = signatureMessage({
    method,
    origin: 'https://api.example.test',
    path: new URL(url).pathname,
    type,
    hash,
    size: bytes.length,
    time,
    key,
  });
  const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, k.privateKey, enc.encode(message)));
  const headers = {
    'Content-Type': type,
    'X-Music-Public-Key': key,
    'X-Music-Signature': sig,
    'X-Music-Timestamp': time,
    'X-Music-Size': String(bytes.length),
    'X-Music-Sha256': hash,
    ...over.headers,
  };
  return app.fetch(new Request(url, { method, headers, body: bytes }), over.env ?? E, createExecutionContext());
}
const op = async (name: string, body: object) => {
  const r = await send('POST', name, enc.encode(JSON.stringify(body)), 'application/json');
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & { error?: { code: string } } };
};
const catalog = async () => {
  const r = await app.fetch(
    new Request('https://api.example.test/v1/music/catalog', { headers: { Authorization: `Bearer ${owner}` } }),
    E,
    createExecutionContext(),
  );
  return { etag: r.headers.get('ETag'), body: (await r.json()) as MusicCatalog };
};
const audioOf = async (b: Uint8Array) => {
  const h = await sha(b);
  return { h, key: `native/audio/${h}.opus` };
};

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  pub = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  E = { ...env, MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([pub]) } as Env;
  owner = (await setupOwner()).token;
});

describe('uploads, signed by a tool key', () => {
  it('audio is checked and stored once, verified, under its content address', async () => {
    const bytes = ogg(1);
    const { h, key } = await audioOf(bytes);
    const r = await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { key: string; size: number; r2Identity: { etag: string } };
    expect(body).toMatchObject({ key, sha256: h, size: bytes.length });
    const o = await env.MEDIA.head(key);
    expect(o?.customMetadata).toEqual({ 'verified-sha256': h, verification: 'worker-upload-sha256-v1' });
    expect(o?.httpMetadata).toMatchObject({
      contentType: 'audio/ogg',
      cacheControl: 'private, max-age=31536000, immutable',
    });
    // The same bytes again: the same object, untouched.
    const again = (await (await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg')).json()) as typeof body;
    expect(again.r2Identity.etag).toBe(body.r2Identity.etag);
  });

  it('refuses what is not signed, not fresh, not its own address or not its format', async () => {
    const bytes = ogg(2);
    const { h } = await audioOf(bytes);
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const status = async (p: Promise<Response>) => (await p).status;
    expect(await status(send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg', { key: other }))).toBe(401);
    expect(await status(send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg', { time: Date.now() / 1000 - 600 }))).toBe(
      401,
    );
    expect(await status(send('PUT', `audio/${'0'.repeat(64)}.opus`, bytes, 'audio/ogg'))).toBe(422);
    const notOgg = enc.encode('just some text, long enough to be a file of sorts');
    expect(await status(send('PUT', `audio/${await sha(notOgg)}.opus`, notOgg, 'audio/ogg'))).toBe(415);
    expect(await status(send('PUT', `audio/${h}.opus`, bytes, 'audio/mpeg'))).toBe(415);
    const site = { headers: { Origin: 'https://site.example.test' } };
    expect(await status(send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg', site))).toBe(403);
    const none = { env: { ...env, MUSIC_UPLOAD_PUBLIC_KEYS: 'none' } as Env };
    expect(await status(send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg', none))).toBe(503);
    expect(await env.MEDIA.head(`native/audio/${h}.opus`)).toBeNull();
  });
});

describe('the catalog writer', () => {
  let id = '';
  let cover = '';
  it('registers an uploaded track once, with its cover and waveform; the catalog shows it', async () => {
    const bytes = ogg(3);
    const { h } = await audioOf(bytes);
    const art = jpeg();
    cover = await sha(art);
    expect((await send('PUT', `art/${cover}.jpg`, art, 'image/jpeg')).status).toBe(200);
    const reg = {
      sha256: h,
      size: bytes.length,
      name: 'A Song.opus',
      metadata: { title: 'A Song', artist: 'Someone', dur: 187.2 },
      cover: { sha256: cover, ext: 'jpg', size: art.length },
      waveform: WAVE,
      waveformKind: 'rms',
    };
    expect((await op('register', reg)).body).toMatchObject({ error: { code: 'conflict' } });
    expect((await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg')).status).toBe(200);
    const before = (await catalog()).etag;
    const done = await op('register', reg);
    id = `r2_native_${h}`;
    expect(done).toEqual({ status: 200, body: { registered: true, duplicate: false, id, count: 1 } });
    expect((await op('register', reg)).body).toMatchObject({ registered: true, duplicate: true, id });
    const c = await catalog();
    expect(c.etag).not.toBe(before);
    expect(c.body.tracks.at(-1)).toMatchObject({
      id,
      audioKey: `native/audio/${h}.opus`,
      coverKey: `native/art/${cover}.jpg`,
      path: 'A Song.opus',
      folder: 'Cloudflare R2/Someone',
      waveformKind: 'rms',
      waveformBars: true,
      metadata: { title: 'A Song', artist: 'Someone', dur: 187.2 },
    });
  });

  it('takes an analysis of exactly this audio, once, and refuses a stale one', async () => {
    const t = (await catalog()).body.tracks.find((x) => x.id === id) as unknown as {
      sha256: string;
      size: number;
      r2Identity: object;
    };
    const analysis = {
      version: 1,
      sha256: t.sha256,
      audioBytes: t.size,
      gainBasis: 'decoded-container-gain',
      decoder: 'test-decoder',
      method: 'test-loudness',
      analyzedAt: '2026-10-29T00:00:00.000Z',
      sampleRate: 48000,
      channels: 2,
      integratedLufs: -9.1,
      samplePeakDbfs: -0.6,
      truePeakDbtp: -0.4,
      containerGainDb: 0,
    };
    const body = { id, sha256: t.sha256, size: t.size, r2Identity: t.r2Identity, audioAnalysis: analysis };
    expect((await op('analysis', { ...body, previousAnalysisSha256: null })).body).toMatchObject({
      analysisUpdated: true,
    });
    expect((await op('analysis', { ...body, previousAnalysisSha256: null })).body).toMatchObject({
      analysisUpdated: false,
    });
    const louder = { ...body, audioAnalysis: { ...analysis, integratedLufs: -8 }, previousAnalysisSha256: null };
    expect((await op('analysis', louder)).status).toBe(409);
    expect((await op('analysis', { ...body, audioBytes: 1, size: 1, previousAnalysisSha256: null })).status).toBe(422);
  });

  it('patches tags in place, takes waveforms in bulk, and refuses bad input with its reason', async () => {
    expect((await op('patch', { id, metadata: { title: 'A Better Title', genre: 'Folk' } })).body).toMatchObject({
      patched: true,
    });
    expect((await op('patch', { id, metadata: { waveform: WAVE } })).status).toBe(422);
    expect((await op('patch', { id: 'r2_native_nope', path: 'x' })).status).toBe(404);
    expect(
      (
        await op('waveforms', {
          items: [
            { id, waveform: WAVE, kind: 'peak' },
            { id: 'r2_native_gone', waveform: WAVE, kind: 'peak' },
          ],
        })
      ).body,
    ).toMatchObject({
      updated: 1,
      notFound: ['r2_native_gone'],
    });
    const t = (await catalog()).body.tracks.find((x) => x.id === id) as unknown as Record<string, unknown> & {
      metadata: object;
    };
    expect(t.metadata).toMatchObject({ title: 'A Better Title', genre: 'Folk' });
    expect(t).not.toHaveProperty('waveformKind');
    expect((await op('nothing-such', {})).status).toBe(404);
  });

  it('new audio keeps the id; a delete takes the track out; no object ever leaves the bucket', async () => {
    const first = (await catalog()).body.tracks.find((x) => x.id === id) as unknown as { audioKey: string };
    const bytes = ogg(4);
    const { h, key } = await audioOf(bytes);
    await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg');
    expect(
      (await op('replace-audio', { id, sha256: h, size: bytes.length, name: 'B.opus', waveform: WAVE })).body,
    ).toMatchObject({
      replaced: true,
      id,
      oldAudioKey: first.audioKey,
      deletedObjects: [],
    });
    const t = (await catalog()).body.tracks.find((x) => x.id === id) as unknown as { audioKey: string; path: string };
    expect([t.audioKey, t.path]).toEqual([key, 'B.opus']);
    expect(await env.MEDIA.head(first.audioKey)).not.toBeNull();
    const exported = await send('POST', 'export', enc.encode('{}'), 'application/json');
    expect(((await exported.json()) as MusicCatalog).tracks.find((x) => x.id === id)).toMatchObject({
      metadata: { waveform: WAVE },
    });
    expect((await op('delete', { ids: [id, 'r2_native_absent'] })).body).toMatchObject({
      deleted: [id],
      notFound: ['r2_native_absent'],
      deletedObjects: [],
      count: 0,
    });
    expect(await env.MEDIA.head(key)).not.toBeNull();
    expect(await env.MEDIA.head(`native/art/${cover}.jpg`)).not.toBeNull();
    const audit = (await op('audit', {})).body as { tracks: number; orphans: number; missing: number };
    expect(audit).toMatchObject({ tracks: 0, missing: 0 });
    expect(audit.orphans).toBeGreaterThanOrEqual(3);
  });

  it('links answer only with the signing key; the writer logs every change for undo', async () => {
    expect((await op('links', { ids: [id] })).body).toMatchObject({ error: { code: 'not_configured' } });
    const log = await runInDurableObject(env.MUSIC.get(env.MUSIC.idFromName('library')), (_o, state) =>
      state.storage.sql.exec('SELECT op, track_id, before_json FROM catalog_log ORDER BY seq').toArray(),
    );
    expect(log.map((l) => [l.op, l.track_id])).toEqual([
      ['register', id],
      ['analysis', id],
      ['patch', id],
      ['waveform', id],
      ['replace-audio', id],
      ['delete', id],
    ]);
    // A deleted track's log row holds all of it, its waveform too: enough to put it back.
    expect(JSON.parse(String(log.at(-1)?.before_json))).toMatchObject({ id, waveform: WAVE, path: 'B.opus' });
  });
});
