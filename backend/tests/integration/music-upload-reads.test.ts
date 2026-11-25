// The upload tools' reads (areas/music/upload-reads.ts): `quota` answers the day's rows and the hold
// in numbers, also while the day is held; `track` gives one record without its waveform, by id or by
// its audio; `export` is unchanged with no field, and comes in pages in catalog order, with its
// waveforms or without. And a batch of new songs moves the catalog's version once, not once a song.
// Every song is invented.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { budgetAt, DAY_BUDGET } from '../../../shared/contract/meter.ts';
import { app } from '../../src/app';
import { forgetHold } from '../../src/areas/meter/hold';
import { nextUtcDay } from '../../src/areas/meter/quota';
import { signatureMessage } from '../../src/areas/music/validate';
import { utcDay } from '../../src/lib/time';
import { musicObject } from '../../src/objects/music';
import { coreSql } from '../helpers';

const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
const WAVE = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i * 7)));
const enc = new TextEncoder();
const ogg = (seed: number) => {
  const b = new Uint8Array(400 + seed);
  b.set(enc.encode('OggS'), 0);
  b.set(enc.encode('OpusHead'), 28);
  for (let i = 40; i < b.length; i++) b[i] = (i * 29 + seed) % 251;
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
type Track = Record<string, unknown> & { id: string; metadata: Record<string, unknown> };
type Answer = Record<string, unknown> & { tracks?: Track[]; track?: Track; error?: { code: string } };
const op = async (name: string, body: object) => {
  const r = await send('POST', name, enc.encode(JSON.stringify(body)), 'application/json');
  return { status: r.status, body: (await r.json()) as Answer };
};
const version = async () => Number(/^"m(\d+)-/.exec(await musicObject(E).catalogTag())?.[1]);

/** Songs `from` … `from + n - 1`, their audio uploaded: the even ones with a waveform (every fourth "rms"). */
async function songs(from: number, n: number) {
  const tracks = [];
  for (let i = from; i < from + n; i++) {
    const bytes = ogg(i);
    const h = await sha(bytes);
    expect((await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg')).status).toBe(200);
    tracks.push({
      sha256: h,
      size: bytes.length,
      name: `Invented ${i}.opus`,
      metadata: { title: `Invented ${i}`, artist: 'A Made-up Band', album: 'Made-up', track: i + 1, dur: 120 + i },
      ...(i % 2 ? {} : { waveform: WAVE, waveformKind: i % 4 ? 'peak' : 'rms' }),
    });
  }
  return tracks;
}

let first: { id: string; sha256: string; size: number }[] = [];
beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  E = { ...env, MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([pub]) } as Env;
  const tracks = await songs(0, 5);
  const done = await op('register-batch', { tracks });
  expect(done.body).toMatchObject({ registered: 5 });
  first = (done.body.results as { id: string }[]).map((r, i) => ({ id: r.id, ...tracks[i] }));
});

describe('register-batch', () => {
  it('moves the catalog version once for a batch of new songs; a single register still once', async () => {
    const before = await version();
    expect((await op('register-batch', { tracks: await songs(10, 4) })).body).toMatchObject({ registered: 4 });
    expect(await version()).toBe(before + 1);
    // The same songs again change nothing: the version stays.
    expect((await op('register-batch', { tracks: await songs(10, 2) })).body).toMatchObject({ registered: 0 });
    expect(await version()).toBe(before + 1);
    const [one] = await songs(20, 1);
    expect((await op('register', one)).body).toMatchObject({ registered: true, duplicate: false });
    expect(await version()).toBe(before + 2);
  });
});

describe('quota', () => {
  const KEYS = [
    'budget_rows_read',
    'budget_rows_written',
    'day',
    'held',
    'hold_at_rows_read',
    'hold_at_rows_written',
    'hold_until',
    'lane',
    'retry_after',
    'rows_read',
    'rows_written',
  ];

  it('answers the day in numbers', async () => {
    forgetHold();
    const r = await op('quota', {});
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(KEYS);
    expect(r.body).toMatchObject({
      day: utcDay(Date.now()),
      budget_rows_written: DAY_BUDGET.rows_written,
      hold_at_rows_written: budgetAt(85, 'rows_written'),
      budget_rows_read: DAY_BUDGET.rows_read,
      hold_at_rows_read: budgetAt(85, 'rows_read'),
      held: false,
      hold_until: null,
      retry_after: null,
      lane: { rows: 0, cap: 40_000, open: true },
    });
    expect(r.body.rows_written).toBeGreaterThan(0);
    expect(Object.keys(r.body.lane as object).sort()).toEqual(['cap', 'open', 'resume_at', 'rows']);
  });

  it('answers while the day is held, and says until when', async () => {
    const day = utcDay(Date.now());
    const seed = (read: number) =>
      coreSql(
        `INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at)
         VALUES (?, 'music', ?, 0, 0)`,
        day,
        read,
      );
    await seed(budgetAt(85, 'rows_read') + 1);
    try {
      forgetHold();
      expect((await op('audit', {})).status).toBe(429);
      const r = await op('quota', {});
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ held: true, hold_until: nextUtcDay(Date.now()) });
      expect(r.body.retry_after).toBeGreaterThan(0);
      expect(r.body.retry_after).toBeLessThanOrEqual(86_400);
    } finally {
      await seed(0);
      forgetHold();
    }
  });
});

describe('track', () => {
  it('gives one record without its waveform, by id or by its audio', async () => {
    const rms = await op('track', { id: first[0].id });
    expect(rms.status).toBe(200);
    expect(rms.body.track).toMatchObject({ id: first[0].id, hasWaveform: true, waveformKind: 'rms' });
    expect(rms.body.track?.metadata).toMatchObject({ title: 'Invented 0' });
    expect(rms.body.track?.metadata).not.toHaveProperty('waveform');
    expect(JSON.stringify(rms.body)).not.toContain(WAVE);
    expect((await op('track', { id: first[1].id })).body.track).toMatchObject({
      hasWaveform: false,
      waveformKind: null,
    });
    const peak = await op('track', { sha256: first[2].sha256, size: first[2].size });
    expect(peak.body.track).toMatchObject({ id: first[2].id, hasWaveform: true, waveformKind: 'peak' });
  });

  it('is 404 for a track not in the catalog, 422 without an id or audio', async () => {
    expect((await op('track', { id: `r2_native_${'f'.repeat(64)}` })).status).toBe(404);
    expect((await op('track', { sha256: 'e'.repeat(64), size: 1234 })).status).toBe(404);
    expect((await op('track', {})).status).toBe(422);
    expect((await op('track', { sha256: first[0].sha256 })).status).toBe(422);
  });
});

describe('export', () => {
  it('with no field, is the whole catalog with its waveforms, as before', async () => {
    const all = (await op('export', {})).body;
    expect(all).toMatchObject({ version: 1, kind: 'r2-library', complete: true });
    expect(all).not.toHaveProperty('next');
    expect(all.count).toBe(all.tracks?.length);
    expect(all.tracks?.find((t) => t.id === first[0].id)?.metadata.waveform).toBe(WAVE);
  });

  it('comes in pages that cover the catalog in order', async () => {
    const ids = ((await op('export', {})).body.tracks ?? []).map((t) => t.id);
    expect(ids.length).toBeGreaterThan(4);
    const half = Math.ceil(ids.length / 2);
    const p1 = (await op('export', { limit: half })).body;
    expect(p1).toMatchObject({ complete: false, count: half });
    expect(typeof p1.next).toBe('string');
    expect(p1.tracks?.[0].metadata.waveform).toBe(WAVE);
    const p2 = (await op('export', { limit: half, after: p1.next })).body;
    expect(p2).toMatchObject({ complete: true, next: null });
    expect([...(p1.tracks ?? []), ...(p2.tracks ?? [])].map((t) => t.id)).toEqual(ids);
    // The last id of a page serves as well as `next`.
    const byId = (await op('export', { limit: half, after: ids[half - 1] })).body;
    expect(byId.tracks?.map((t) => t.id)).toEqual(ids.slice(half));
  });

  it('without waveforms, says which tracks have one and of what kind', async () => {
    const r = (await op('export', { waveforms: false })).body;
    expect(r).toMatchObject({ complete: true, next: null });
    expect(JSON.stringify(r)).not.toContain(WAVE);
    for (const t of r.tracks ?? []) expect(t.metadata).not.toHaveProperty('waveform');
    const by = new Map((r.tracks ?? []).map((t) => [t.id, t]));
    expect(by.get(first[0].id)).toMatchObject({ hasWaveform: true, waveformKind: 'rms' });
    expect(by.get(first[1].id)).toMatchObject({ hasWaveform: false, waveformKind: null });
    expect(by.get(first[2].id)).toMatchObject({ hasWaveform: true, waveformKind: 'peak' });
  });

  it('refuses a page it cannot give', async () => {
    for (const body of [
      { limit: 0 },
      { limit: 2_001 },
      { limit: 1.5 },
      { after: 'not a place' },
      { after: `r2_native_${'f'.repeat(64)}` },
      { waveforms: 'no' },
    ])
      expect((await op('export', body)).status, JSON.stringify(body)).toBe(422);
  });
});
