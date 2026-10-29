// The old catalog's checks, ported as they are (the old repo's frontend/drawercast/r2-library.js
// and audio-analysis.js at the export): a track's tags (`metadata`), one track record as the
// catalog stores it (`checkTrack`, validateLibrary's per-track half), an audio analysis bound to
// the exact audio it measured, and the message an upload tool signs. The upload routes and the
// Music object's writer use them, so the catalog never holds a track the ported player's own
// reader would refuse.
import { ART_KEY, AUDIO_KEY, SONG_ID } from './shapes';

export const HEX = /^[a-f0-9]{64}$/;
const TEXT = ['title', 'artist', 'album', 'albumArtist', 'genre', 'composer', 'codec'];
const NUM = [
  'year',
  'track',
  'disc',
  'dur',
  'sr',
  'ch',
  'bits',
  'rgTrack',
  'rgAlbum',
  'rgTrackPeak',
  'rgAlbumPeak',
  'r128TrackGain',
  'r128AlbumGain',
  'opusHeadGainDb',
];

export class Invalid extends Error {}
const bad = (): never => {
  throw new Invalid('invalid');
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL = /[\x00-\x1f\x7f]/;
const clean = (s: unknown, max = 512): s is string => typeof s === 'string' && s.length <= max && !CONTROL.test(s);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** A track's tags: known text and number fields only, a title, an artist and a duration. */
export function metadata(input: unknown, { copyAnalysis = true } = {}): Obj {
  if (!isObj(input)) return bad();
  const out: Record<string, unknown> = {};
  for (const k of TEXT)
    if (input[k] != null) {
      if (!clean(input[k])) bad();
      out[k] = input[k];
    }
  for (const k of NUM)
    if (input[k] != null) {
      if (typeof input[k] !== 'number' || !Number.isFinite(input[k])) bad();
      out[k] = input[k];
    }
  const n = out as Record<string, number | undefined> & { title?: string; artist?: string };
  if (
    !n.title?.trim() ||
    !n.artist?.trim() ||
    !Number.isFinite(n.dur) ||
    (n.dur as number) < 0 ||
    (n.dur as number) > 86_400
  )
    bad();
  for (const k of ['year', 'track', 'disc', 'sr', 'ch', 'bits'])
    if (n[k] != null && ((n[k] as number) < 0 || !Number.isInteger(n[k]))) bad();
  for (const k of ['rgTrack', 'rgAlbum']) if (n[k] != null && Math.abs(n[k] as number) > 60) bad();
  for (const k of ['rgTrackPeak', 'rgAlbumPeak'])
    if (n[k] != null && ((n[k] as number) <= 0 || (n[k] as number) > 1000)) bad();
  for (const k of ['r128TrackGain', 'r128AlbumGain'])
    if (n[k] != null && (!Number.isInteger(n[k]) || (n[k] as number) < -32768 || (n[k] as number) > 32767)) bad();
  if (n.opusHeadGainDb != null && Math.abs(n.opusHeadGainDb) > 128) bad();
  if (input.audioAnalysis != null && copyAnalysis) out.audioAnalysis = structuredClone(input.audioAnalysis);
  return out;
}

function identity(p: unknown, size: unknown): void {
  const i = p as { size?: unknown; etag?: unknown; lastModified?: unknown } | undefined;
  if (
    !i ||
    i.size !== size ||
    typeof i.etag !== 'string' ||
    !/^\w+(?:-\d+)?$/.test(i.etag) ||
    !Number.isFinite(Date.parse(String(i.lastModified)))
  )
    bad();
}

const urlOf = (s: string) => {
  try {
    return new URL(s);
  } catch {
    return null;
  }
};

/** One track record as the catalog keeps it (no waveform in it). */
export function checkTrack(t: Obj): void {
  if (
    !SONG_ID.test(String(t.id)) ||
    !HEX.test(String(t.sha256)) ||
    !AUDIO_KEY.test(String(t.audioKey)) ||
    !Number.isSafeInteger(t.size) ||
    (t.size as number) <= 0 ||
    !clean(t.path, 1024) ||
    !clean(t.folder, 4096) ||
    !/^(audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/ogg)$/i.test(String(t.mimeType ?? ''))
  )
    bad();
  const key = t.audioKey as string;
  const id = t.id as string;
  if (key.startsWith('native/')) {
    if (key !== `native/audio/${t.sha256}.opus`) bad();
  } else if (
    id.startsWith('r2_native_') ||
    !key.startsWith(`audio/${id.slice(3)}/`) ||
    !/^[a-f0-9]{32}$/.test(String(t.md5 ?? ''))
  )
    bad();
  identity(t.r2Identity, t.size);
  metadata(t.metadata, { copyAnalysis: false });
  const analysis = (t.metadata as Obj).audioAnalysis;
  if (analysis) validateAnalysis(analysis, t.sha256 as string, t.size as number);
  if (t.coverKey != null) {
    if (
      !ART_KEY.test(String(t.coverKey)) ||
      !HEX.test(String(t.coverSha256)) ||
      !String(t.coverKey).includes(String(t.coverSha256)) ||
      !Number.isSafeInteger(t.coverSize) ||
      (t.coverSize as number) <= 0 ||
      !['image/jpeg', 'image/png'].includes(String(t.coverMimeType))
    )
      bad();
    identity(t.coverIdentity, t.coverSize);
  }
  if (t.coverURL != null) {
    const u = urlOf(String(t.coverURL));
    if (
      !u ||
      u.username ||
      u.password ||
      u.origin !== 'https://missionarytube.z13.web.core.windows.net' ||
      !/^\/assets\/drive-catalog-v2\/covers\/[a-f0-9]{64}\.jpg$/.test(u.pathname) ||
      u.search ||
      u.hash
    )
      bad();
  }
}

const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const label = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v);

/** An audio analysis of exactly this audio (its hash and size), or Invalid. */
export function validateAnalysis(input: unknown, sha256: string, size: number): Obj {
  const a = input as Obj;
  if (
    a?.version !== 1 ||
    a.sha256 !== sha256 ||
    !HEX.test(String(a.sha256)) ||
    a.audioBytes !== size ||
    a.gainBasis !== 'decoded-container-gain' ||
    !label(a.decoder) ||
    !label(a.method) ||
    !Number.isFinite(Date.parse(String(a.analyzedAt))) ||
    !Number.isInteger(a.sampleRate) ||
    !num(a.sampleRate, 8000, 384000) ||
    !Number.isInteger(a.channels) ||
    !num(a.channels, 1, 8) ||
    !num(a.integratedLufs, -100, 20) ||
    !num(a.samplePeakDbfs, -180, 60) ||
    !num(a.truePeakDbtp, -180, 60) ||
    (a.truePeakDbtp as number) < (a.samplePeakDbfs as number) - 0.15 ||
    !num(a.containerGainDb, -128, 128)
  )
    bad();
  const out: Obj = {
    version: 1,
    sha256: a.sha256,
    audioBytes: size,
    gainBasis: a.gainBasis,
    decoder: a.decoder,
    method: a.method,
    analyzedAt: a.analyzedAt,
    sampleRate: a.sampleRate,
    channels: a.channels,
    integratedLufs: a.integratedLufs,
    samplePeakDbfs: a.samplePeakDbfs,
    truePeakDbtp: a.truePeakDbtp,
    containerGainDb: a.containerGainDb,
  };
  if (a.album != null) {
    const g = a.album as Obj;
    const members = g.members as { sha256?: unknown; size?: unknown }[];
    if (
      !label(g.id) ||
      g.complete !== true ||
      !num(g.integratedLufs, -100, 20) ||
      !num(g.truePeakDbtp, -180, 60) ||
      !Array.isArray(members) ||
      members.length < 1 ||
      members.length > 500 ||
      !members.every((m) => HEX.test(String(m?.sha256)) && Number.isSafeInteger(m.size) && (m.size as number) > 0) ||
      new Set(members.map((m) => m.sha256)).size !== members.length ||
      !members.some((m) => m.sha256 === sha256 && m.size === size)
    )
      bad();
    out.album = {
      id: g.id,
      complete: true,
      integratedLufs: g.integratedLufs,
      truePeakDbtp: g.truePeakDbtp,
      members: members.map((m) => ({ sha256: m.sha256, size: m.size })),
    };
  }
  return out;
}

/** What an upload tool signs (Ed25519): the destination and the content, five minutes at most. */
export function signatureMessage(m: {
  method: string;
  origin: string;
  path: string;
  type: string;
  hash: string;
  size: string | number;
  time: string | number;
  key: string;
}): string {
  return [
    'jarvis-r2-upload-v1',
    m.method,
    m.origin,
    m.path,
    m.type,
    m.hash,
    String(m.size),
    String(m.time),
    m.key,
  ].join('\n');
}
