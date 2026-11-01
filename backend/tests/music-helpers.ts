// Helpers for the music notes and find suites: a synthetic catalog put straight into the Music
// object (as the import did), notes as the mind writes them, and the phone's skip senses. Every
// title, artist and genre is made up.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { MusicNote } from '../../shared/contract/music.ts';
import { uuidv7 } from '../src/lib/ids';
import { type Music, musicObject } from '../src/objects/music';
import { apiJson } from './helpers';

export interface Song {
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  composer?: string;
  year?: number;
  dur?: number;
}

/** The track id of synthetic song `i`. */
export const songId = (i: number) => `r2_native_${i.toString(16).padStart(64, '0')}`;
export const music = () => musicObject(env) as unknown as DurableObjectStub<Music>;

/** Puts songs into the catalog at places `from`, `from + 1`, …; returns their ids. */
export async function seedCatalog(songs: Song[], from = 1): Promise<string[]> {
  const rows = songs.map((s, k) => {
    const i = from + k;
    const id = songId(i);
    const sha = i.toString(16).padStart(64, '0');
    const metadata = {
      title: s.title,
      artist: s.artist ?? '',
      album: s.album ?? '',
      genre: s.genre ?? '',
      composer: s.composer ?? '',
      year: s.year ?? 0,
      dur: s.dur ?? 200,
    };
    return {
      ord: i,
      id,
      sha256: sha,
      size: 1000 + i,
      audio_key: `native/audio/${sha}.opus`,
      cover_key: null,
      record_json: JSON.stringify({
        id,
        sha256: sha,
        size: 1000 + i,
        audioKey: `native/audio/${sha}.opus`,
        mimeType: 'audio/ogg',
        path: `Library/${s.title}.opus`,
        metadata,
      }),
      waveform: null,
      updated_at: 1_790_000_000_000 + i,
    };
  });
  const r = await musicObject(env).importTracks(rows, Date.now());
  if (r.clashes?.length) throw new Error(`clashes: ${r.clashes.join(',')}`);
  return rows.map((r) => r.id);
}

/** A note with nothing said but what is given. */
export const note = (id: string, over: Partial<MusicNote> = {}): MusicNote => ({
  id,
  known: true,
  moods: {},
  occasions: {},
  themes: [],
  language: null,
  era: null,
  energy: null,
  conf: {},
  ...over,
});

export const putNotes = (token: string, items: unknown[], headers: Record<string, string> = {}) =>
  apiJson<{
    written: number;
    unchanged: number;
    error?: { code: string; details?: { path: string; issue: string }[] };
  }>('PUT', '/v1/music/notes', { token, headers, body: { items } });

/** One sealed batch of the phone's music senses: skips at `at_ms` into each song, plays, ratings. */
export async function sendSenses(
  D: string,
  events: { type: string; id: string; at_ms?: number; ago_ms?: number; data?: object }[],
) {
  const now = Date.now();
  const r = await apiJson<{ accepted: number }>('PUT', `/v1/senses/batches/${uuidv7()}`, {
    token: D,
    body: {
      events: events.map((e) => ({
        id: uuidv7(),
        at: now - (e.ago_ms ?? 60_000),
        type: e.type,
        ref: `music:${e.id}`,
        data:
          e.data ?? (e.type === 'music.skip' ? { at_ms: e.at_ms ?? 5_000, duration_ms: 200_000 } : { offline: false }),
      })),
    },
  });
  if (r.status !== 200 || r.body.accepted !== events.length) throw new Error(`senses: ${r.status}`);
}

/** Rows the Music object read and wrote while `fn` ran. */
export async function musicRows(fn: () => Promise<unknown>) {
  const meter = () => runInDurableObject(music(), (o: Music) => ({ r: o.meter.rowsRead, w: o.meter.rowsWritten }));
  const before = await meter();
  await fn();
  const after = await meter();
  return { read: after.r - before.r, written: after.w - before.w };
}
