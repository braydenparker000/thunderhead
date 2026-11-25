// The catalog's single writer (the old repo's backend/music-catalog.js, ported): the upload tools'
// operations, run in the Music object one at a time. A track is registered only once its audio
// (and art) is in `jarvis-music`, uploaded through the Worker and verified by hash; the same audio
// again is the same track; replacing a track's audio keeps its id, so plays and ratings stay with
// it. Every change is logged with what it replaced and moves the catalog's version (its ETag).
// Unlike the old writer, nothing here ever deletes from the bucket (DATA.md §7.2): a removed or
// replaced track's objects stay, and the audit lists them. There is no catalog file to publish:
// phones read the catalog from the Music object.
import type { Db } from '../../objects/base';
import { albumIdOf } from './album-id';
import { BadTag } from './meta-extra';
import { SONG_ID, waveBytes } from './shapes';
import * as store from './store';
import { checkTrack, HEX, ignoredKeys, metadata, validateAnalysis } from './validate';

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
  /** How many tracks there are now, counted once per start and kept by the object (a count reads
   * every row, so it is never taken per song: 2026-10-31, a batch of 100 read 1.2M rows), and a
   * change to it as tracks are added or removed. */
  tracks(): number;
  counted(n: number): void;
}

export const proof = (o: R2Object) => ({ etag: o.etag, size: o.size, lastModified: o.uploaded.toISOString() });
export const verifiedBlob = (o: R2Object | null, sha: string, size: number) =>
  o?.size === size &&
  o.customMetadata?.['verified-sha256'] === sha &&
  o.customMetadata?.verification === 'worker-upload-sha256-v1';

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
  // Without a kind a waveform is the upload tool's own, `rms` (MUSE-SOP.md step 3).
  if (k === undefined) return 'rms';
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
/** The catalog's version moves, keeping its song count (the delta's `count`, music-delta.ts). */
export const changed = (c: Ctx) => store.bump(c.db, c.now, { count: c.tracks() });
/** Sent tags, checked: a bad one is 422, naming its field when it is one of the extra tags. */
export function tagsOrFail(input: unknown): Obj {
  try {
    return metadata(input);
  } catch (e) {
    if (e instanceof BadTag) fail(422, `Invalid metadata.${e.message}`, { field: `metadata.${e.message}` });
    return fail(422, 'Invalid track metadata');
  }
}
/** Each of `keys` a song needs: `album` (text) and `track` (a whole number from 1); 422 naming it. */
export function songOrFail(meta: Obj, keys: readonly string[] = ['album', 'track']): void {
  const ok: Record<string, boolean> = {
    album: typeof meta.album === 'string' && meta.album.trim() !== '',
    track: Number.isInteger(meta.track) && (meta.track as number) >= 1,
  };
  const issue: Record<string, string> = { album: 'the album title', track: 'a whole number from 1' };
  for (const k of keys) if (!ok[k]) fail(422, `metadata.${k} is required: ${issue[k]}`, { field: `metadata.${k}` });
}
/** The answer's `ignored`: sent metadata keys not stored, only when there are any. */
export const ignoredOf = (input: unknown): Obj => {
  const keys = ignoredKeys(input);
  return keys.length ? { ignored: keys } : {};
};
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

type Prepared = { track: Obj; waveform: string | null; ignored: Obj };

/** A registration to a new track record and its waveform, checked against the bucket. */
async function prepare(c: Ctx, body: Obj): Promise<Prepared> {
  const meta = tagsOrFail(body?.metadata);
  // A new song names its album and track (a missing disc is 1), and gets its album id (album-id.ts).
  songOrFail(meta);
  meta.disc ??= 1;
  meta.albumId = albumIdOf(meta);
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
  const ignored = ignoredOf(body?.metadata);
  return { track: withKind(track, waveform, kindOrFail(body.waveformKind)), waveform, ignored };
}

/** `moved`: what a change does to the catalog's version (a batch moves it once, after its songs). */
function insert(c: Ctx, { track, waveform }: Prepared, moved: () => unknown = () => changed(c)): Obj {
  const existing = store.byContent(c.db, track.sha256 as string, track.size as number);
  if (existing) {
    // The same audio again: a waveform it brings fills a missing one.
    const row = store.trackRow(c.db, existing) as store.TrackRow;
    if (waveform && !row.waveform) {
      const before = record(row);
      put(c, withKind(before, waveform, (track.waveformKind as string) ?? 'peak'), waveform);
      // Logged, as every change is: the catalog's delta reads its changes from the log.
      store.logOp(c.db, c.now, 'waveform', existing, { waveform: null, waveformKind: before.waveformKind ?? null });
      moved();
    }
    return { registered: true, duplicate: true, id: existing };
  }
  if (store.trackRow(c.db, track.id as string)) fail(409, 'A track with this id holds other audio');
  check(track);
  const size = JSON.stringify(track).length;
  if (c.tracks() >= MAX_TRACKS || c.bytes() + size > MAX_CATALOG_BYTES) fail(413, 'Music library limit reached');
  put(c, track, waveform);
  c.grow(size);
  c.counted(1);
  store.logOp(c.db, c.now, 'register', track.id as string, null);
  moved();
  return { registered: true, duplicate: false, id: track.id };
}

export const one = (c: Ctx, id: unknown): store.TrackRow =>
  (SONG_ID.test(String(id)) && store.trackRow(c.db, String(id))) || fail(404, 'No such track');

export type Op = (c: Ctx, body: Obj) => Promise<Obj>;

export const OPS: Record<string, Op> = {
  async register(c, body) {
    const prepared = await prepare(c, body);
    return { ...c.tx(() => insert(c, prepared)), count: c.tracks(), ...prepared.ignored };
  },
  async 'register-batch'(c, body) {
    const items = body?.tracks;
    if (!Array.isArray(items) || !items.length || items.length > BATCH_MAX)
      fail(422, `A batch is 1 to ${BATCH_MAX} registrations`);
    const refused = (item: Obj, e: unknown): Obj => {
      if (!(e instanceof MusicError)) throw e;
      return { registered: false, sha256: item?.sha256 ?? null, status: e.status, error: e.message };
    };
    // Each checked against the bucket first; then all in one transaction that moves the catalog's
    // version once, not once a song (a refused song writes nothing before it is refused).
    const ready: Obj[] = [];
    for (const item of items as Obj[]) ready.push(await prepare(c, item).catch((e) => ({ refused: refused(item, e) })));
    const results = c.tx(() => {
      let moved = false;
      const out = (items as Obj[]).map((item, i) => {
        const r = ready[i];
        if (r.refused) return r.refused as Obj;
        try {
          const done = insert(c, r as Prepared, () => {
            moved = true;
          });
          return { ...done, ...(r as Prepared).ignored };
        } catch (e) {
          return refused(item, e);
        }
      });
      if (moved) changed(c);
      return out;
    });
    return {
      results,
      registered: results.filter((r) => r.registered && !r.duplicate).length,
      count: c.tracks(),
    };
  },
};
