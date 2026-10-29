// The catalog's single writer (the old repo's backend/music-catalog.js, ported): the upload tools'
// operations, run in the Music object one at a time. A track is registered only once its audio
// (and art) is in `jarvis-music`, uploaded through the Worker and verified by hash; the same audio
// again is the same track; replacing a track's audio keeps its id, so plays and ratings stay with
// it. Every change is logged with what it replaced and moves the catalog's version (its ETag).
// Unlike the old writer, nothing here ever deletes from the bucket (DATA.md §7.2): a removed or
// replaced track's objects stay, and the audit lists them. There is no catalog file to publish:
// phones read the catalog from the Music object.
import type { Db } from '../../objects/base';
import { SONG_ID, waveBytes } from './shapes';
import * as store from './store';
import { checkTrack, HEX, metadata, validateAnalysis } from './validate';

export const BATCH_MAX = 100;
export const WAVE_BATCH_MAX = 200;
/** The catalog's records may total this much (the ported player reads at most 32 MiB). */
export const MAX_CATALOG_BYTES = 30 * 1024 * 1024;
export const MAX_TRACKS = 50_000;
const WAVE_KINDS = ['peak', 'rms'];

export type Obj = Record<string, unknown>;
export class MusicError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Obj = {},
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string, extra?: Obj): never => {
  throw new MusicError(status, message, extra);
};

export interface Ctx {
  db: Db;
  tx<T>(fn: () => T): T;
  media: R2Bucket;
  now: number;
  /** The records' total length now (kept by the object), and a new record's share of it. */
  bytes(): number;
  grow(n: number): void;
}

export const proof = (o: R2Object) => ({ etag: o.etag, size: o.size, lastModified: o.uploaded.toISOString() });
export const verifiedBlob = (o: R2Object | null, sha: string, size: number) =>
  o?.size === size &&
  o.customMetadata?.['verified-sha256'] === sha &&
  o.customMetadata?.verification === 'worker-upload-sha256-v1';
const sameIdentity = (o: R2Object | null, p: { size?: number; etag?: string; lastModified?: string } | undefined) =>
  !!o &&
  o.size === p?.size &&
  o.etag === p?.etag &&
  Math.floor(o.uploaded.getTime() / 1000) === Math.floor(Date.parse(String(p?.lastModified)) / 1000);

export const record = (r: store.TrackRow) => JSON.parse(r.record_json) as Obj & { metadata: Obj };
export function check(t: Obj): void {
  try {
    checkTrack(t);
  } catch {
    fail(422, 'The track would make the catalog invalid');
  }
}
export const waveOrFail = (w: unknown): string | null => {
  if (w == null) return null;
  if (!waveBytes(w)) fail(422, 'A waveform is base64 of 16 to 1000 bytes, one per bar');
  return w as string;
};
export const kindOrFail = (k: unknown): string => {
  if (k === undefined) return 'peak';
  if (!WAVE_KINDS.includes(k as string)) fail(422, 'waveformKind is "rms" or "peak"');
  return k as string;
};
export function withKind(rec: Obj, waveform: string | null, kind: string): Obj {
  const next = { ...rec };
  if (waveform && kind === 'rms') next.waveformKind = 'rms';
  else delete next.waveformKind;
  return next;
}
/** The record as stored: no waveform in it (that has its own column). */
export function put(c: Ctx, rec: Obj, waveform: string | null): void {
  const stored: Obj = { ...rec, metadata: { ...(rec.metadata as Obj) } };
  delete (stored.metadata as Obj).waveform;
  delete stored.waveformBars;
  store.writeTrack(c.db, stored, waveform, c.now);
}
export const changed = (c: Ctx) => store.bump(c.db, c.now);
export const validName = (n: unknown) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  typeof n === 'string' && n.length <= 512 && !/[\x00-\x1f/\\]/.test(n) && n.endsWith('.opus');

export async function verifiedCover(c: Ctx, cover: unknown): Promise<Obj> {
  const v = cover as { sha256?: string; ext?: string; size?: number };
  if (
    !v ||
    !HEX.test(String(v.sha256)) ||
    !['jpg', 'png'].includes(String(v.ext)) ||
    !Number.isSafeInteger(v.size) ||
    (v.size as number) <= 0
  )
    fail(422, 'Invalid cover registration');
  const key = `native/art/${v.sha256}.${v.ext}`;
  const o = await c.media.head(key);
  if (!verifiedBlob(o, v.sha256 as string, v.size as number)) fail(409, 'Upload artwork before registration');
  return {
    coverKey: key,
    coverSha256: v.sha256,
    coverSize: v.size,
    coverMimeType: v.ext === 'jpg' ? 'image/jpeg' : 'image/png',
    coverIdentity: proof(o as R2Object),
  };
}
export async function verifiedAudio(c: Ctx, sha256: unknown, size: unknown): Promise<Obj> {
  if (!HEX.test(String(sha256)) || !Number.isSafeInteger(size) || (size as number) <= 0)
    fail(422, 'Invalid track registration');
  const audioKey = `native/audio/${sha256}.opus`;
  const o = await c.media.head(audioKey);
  if (!verifiedBlob(o, sha256 as string, size as number)) fail(409, 'Upload audio before registration');
  return { audioKey, sha256, size, mimeType: 'audio/ogg', r2Identity: proof(o as R2Object) };
}

/** A registration to a new track record and its waveform, checked against the bucket. */
async function prepare(c: Ctx, body: Obj): Promise<{ track: Obj; waveform: string | null }> {
  let meta: Obj;
  try {
    meta = metadata(body?.metadata);
  } catch {
    return fail(422, 'Invalid track metadata');
  }
  if (meta.audioAnalysis)
    try {
      meta.audioAnalysis = validateAnalysis(meta.audioAnalysis, String(body.sha256), Number(body.size));
    } catch {
      fail(422, 'Invalid audio analysis');
    }
  if (!((meta.dur as number) > 0)) fail(422, 'A positive prepared duration is required');
  if (!validName(body.name)) fail(422, 'Invalid track registration');
  const audio = await verifiedAudio(c, body.sha256, body.size);
  const track: Obj = {
    id: `r2_native_${body.sha256}`,
    ...audio,
    metadata: meta,
    path: body.name,
    folder: `Cloudflare R2/${meta.artist}`,
  };
  if (body.cover) Object.assign(track, await verifiedCover(c, body.cover));
  const waveform = waveOrFail(body.waveform);
  return { track: withKind(track, waveform, kindOrFail(body.waveformKind)), waveform };
}

function insert(c: Ctx, { track, waveform }: { track: Obj; waveform: string | null }): Obj {
  const existing = store.byContent(c.db, track.sha256 as string, track.size as number);
  if (existing) {
    // The same audio again: a waveform it brings fills a missing one.
    const row = store.trackRow(c.db, existing) as store.TrackRow;
    if (waveform && !row.waveform) {
      put(c, withKind(record(row), waveform, (track.waveformKind as string) ?? 'peak'), waveform);
      changed(c);
    }
    return { registered: true, duplicate: true, id: existing };
  }
  if (store.trackRow(c.db, track.id as string)) fail(409, 'A track with this id holds other audio');
  check(track);
  const size = JSON.stringify(track).length;
  if (store.trackCount(c.db) >= MAX_TRACKS || c.bytes() + size > MAX_CATALOG_BYTES)
    fail(413, 'Music library limit reached');
  put(c, track, waveform);
  c.grow(size);
  store.logOp(c.db, c.now, 'register', track.id as string, null);
  changed(c);
  return { registered: true, duplicate: false, id: track.id };
}

export const one = (c: Ctx, id: unknown): store.TrackRow =>
  (SONG_ID.test(String(id)) && store.trackRow(c.db, String(id))) || fail(404, 'No such track');

export type Op = (c: Ctx, body: Obj) => Promise<Obj>;

export const OPS: Record<string, Op> = {
  async register(c, body) {
    const prepared = await prepare(c, body);
    return { ...c.tx(() => insert(c, prepared)), count: store.trackCount(c.db) };
  },
  async 'register-batch'(c, body) {
    const items = body?.tracks;
    if (!Array.isArray(items) || !items.length || items.length > BATCH_MAX)
      fail(422, `A batch is 1 to ${BATCH_MAX} registrations`);
    const results: Obj[] = [];
    for (const item of items as Obj[]) {
      try {
        const prepared = await prepare(c, item);
        results.push(c.tx(() => insert(c, prepared)));
      } catch (e) {
        if (!(e instanceof MusicError)) throw e;
        results.push({ registered: false, sha256: item?.sha256 ?? null, status: e.status, error: e.message });
      }
    }
    return {
      results,
      registered: results.filter((r) => r.registered && !r.duplicate).length,
      count: store.trackCount(c.db),
    };
  },
  async analysis(c, body) {
    const prev = body.previousAnalysisSha256;
    if (
      !SONG_ID.test(String(body.id)) ||
      !HEX.test(String(body.sha256)) ||
      !Number.isSafeInteger(body.size) ||
      !(prev === null || HEX.test(String(prev)) || (prev === undefined && Object.hasOwn(body, 'previousAnalysis')))
    )
      fail(422, 'Invalid analysis identity');
    let analysis: Obj;
    try {
      analysis = validateAnalysis(body.audioAnalysis, body.sha256 as string, body.size as number);
    } catch {
      return fail(422, 'Invalid audio analysis');
    }
    const row = store.trackRow(c.db, body.id as string);
    const existing = row && record(row);
    const id = existing?.r2Identity as { size: number; etag: string; lastModified: string } | undefined;
    const claimed = body.r2Identity as { size?: number; etag?: string; lastModified?: string } | undefined;
    const proofMatches =
      existing &&
      existing.sha256 === body.sha256 &&
      existing.size === body.size &&
      claimed?.size === id?.size &&
      claimed?.etag === id?.etag &&
      Math.floor(Date.parse(String(claimed?.lastModified)) / 1000) ===
        Math.floor(Date.parse(String(id?.lastModified)) / 1000);
    if (!existing || !proofMatches) return fail(409, 'Analysis object identity conflict');
    const object = await c.media.head(existing.audioKey as string);
    const native = (existing.audioKey as string).startsWith('native/');
    const verified = native
      ? verifiedBlob(object, existing.sha256 as string, existing.size as number)
      : object?.customMetadata?.['source-sha256'] === existing.sha256 &&
        object?.customMetadata?.['source-size'] === String(existing.size);
    if (!sameIdentity(object, id) || !verified) fail(409, 'Verified audio is unavailable');
    const old = existing.metadata.audioAnalysis;
    const revision = old ? await hashOf(old) : null;
    if (JSON.stringify(old) === JSON.stringify(analysis))
      return { registered: true, analysisUpdated: false, id: existing.id, count: store.trackCount(c.db) };
    const expected = prev === undefined ? (body.previousAnalysis ? await hashOf(body.previousAnalysis) : null) : prev;
    if (revision !== expected) fail(409, 'Analysis changed concurrently; review before retry');
    return c.tx(() => {
      const current = store.trackRow(c.db, body.id as string);
      if (!current || current.record_json !== row.record_json)
        fail(409, 'Analysis changed concurrently; review before retry');
      const next = record(current as store.TrackRow);
      next.metadata.audioAnalysis = analysis;
      check(next);
      put(c, next, (current as store.TrackRow).waveform);
      store.logOp(c.db, c.now, 'analysis', next.id as string, record(current as store.TrackRow));
      changed(c);
      return { registered: true, analysisUpdated: true, id: next.id, count: store.trackCount(c.db) };
    });
  },
};

async function hashOf(v: unknown): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
