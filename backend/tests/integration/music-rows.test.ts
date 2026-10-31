// The Music object's rows read (2026-10-31): the free plan meters every row a query reads, and the
// upload tools' operations counted the whole catalog per song (register-batch) and five times per
// audit, 4.4M rows in a day against a 5M cap. With a catalog already holding many tracks, a batch
// now counts it once and an audit reads it once; the mind's track search reads it once per start.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signatureMessage } from '../../src/areas/music/validate';
import { musicObject } from '../../src/objects/music';

const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
const enc = new TextEncoder();
const ogg = (seed: number) => {
  const b = new Uint8Array(400 + seed);
  b.set(enc.encode('OggS'), 0);
  b.set(enc.encode('OpusHead'), 28);
  for (let i = 40; i < b.length; i++) b[i] = (i * 37 + seed) % 251;
  return b;
};

let keys: CryptoKeyPair;
let E: Env;
async function send(method: string, path: string, bytes: Uint8Array, type: string) {
  const key = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const time = String(Math.floor(Date.now() / 1000));
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
  const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(message)));
  const headers = {
    'Content-Type': type,
    'X-Music-Public-Key': key,
    'X-Music-Signature': sig,
    'X-Music-Timestamp': time,
    'X-Music-Size': String(bytes.length),
    'X-Music-Sha256': hash,
  };
  return app.fetch(new Request(url, { method, headers, body: bytes }), E, createExecutionContext());
}
const op = async (name: string, body: object) =>
  (await (await send('POST', name, enc.encode(JSON.stringify(body)), 'application/json')).json()) as Record<
    string,
    unknown
  >;
const rowsRead = async () => (await musicObject(E).health()).rows_read;

const SEEDED = 2_000;
beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  E = {
    ...env,
    MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([
      hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer),
    ]),
  } as Env;
  // A catalog that already holds many tracks (imported directly, as the move from the old Worker did).
  const rows = Array.from({ length: SEEDED }, (_, i) => {
    const h = i.toString(16).padStart(64, '0');
    const id = `r2_native_${h}`;
    return {
      ord: i + 1,
      id,
      sha256: h,
      size: 1000 + i,
      audio_key: `native/audio/${h}.opus`,
      cover_key: null,
      record_json: JSON.stringify({
        id,
        sha256: h,
        size: 1000 + i,
        audioKey: `native/audio/${h}.opus`,
        path: `Song ${i}.opus`,
        metadata: { title: `Song ${i}`, artist: i % 2 ? 'Evening Trio' : 'Morning Band' },
      }),
      waveform: null,
      updated_at: 0,
    };
  });
  for (let i = 0; i < rows.length; i += 500) await musicObject(E).importTracks(rows.slice(i, i + 500), 1);
});

describe('the catalog is read once, not per song', () => {
  it('a batch of 20 counts the catalog once, and its count is still right', async () => {
    const tracks = [];
    for (let i = 0; i < 20; i++) {
      const bytes = ogg(i);
      const h = await sha(bytes);
      expect((await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg')).status).toBe(200);
      tracks.push({
        sha256: h,
        size: bytes.length,
        name: `New ${i}.opus`,
        metadata: { title: `New ${i}`, artist: 'Someone', dur: 180 + i },
      });
    }
    const before = await rowsRead();
    const done = await op('register-batch', { tracks });
    expect(done).toMatchObject({ registered: 20, count: SEEDED + 20 });
    // Counting per song read 20 × 2,000 rows. Now the count and the records' total size are each
    // read once per start (two passes), plus a few rows per song.
    expect((await rowsRead()) - before).toBeLessThan(2 * SEEDED + 20 * 40);
    // The kept count moves with a delete too.
    const gone = (done.results as { id: string }[])[0].id;
    expect(await op('delete', { ids: [gone] })).toMatchObject({ deleted: [gone], count: SEEDED + 19 });
  });

  it('an audit reads the tracks once', async () => {
    const before = await rowsRead();
    const audit = await op('audit', {});
    expect(audit).toMatchObject({ tracks: SEEDED + 19, withoutWaveform: SEEDED + 19 });
    // Five counts read 5 × 2,019 rows; one pass reads 2,019 (and a count kept from before, none).
    expect((await rowsRead()) - before).toBeLessThan(SEEDED + 19 + 200);
  });

  it("the mind's track search reads the catalog once, then searches it in memory", async () => {
    const first = await musicObject(E).findTracks('evening trio', 5);
    expect(first.total).toBe(SEEDED / 2);
    const before = await rowsRead();
    for (const q of ['song 1', 'morning', 'new 3', 'evening trio']) await musicObject(E).findTracks(q, 5);
    expect((await rowsRead()) - before).toBe(0);
    expect((await musicObject(E).findTracks('new 13', 5)).items.map((t) => t.title)).toEqual(['New 13']);
  });
});
