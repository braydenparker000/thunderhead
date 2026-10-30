// Music's data on the new Worker (MUSIC.md §1.3, §6.1; API.md §11.15, §11.21): the catalog in the
// ported player's own format (`r2-library`, the old published file's shape, with no waveforms),
// one track's waveform, and signed links to its audio and art. P5's data move; the player's own
// tables come with its later steps.
import type { Ms } from './api';

export const MUSIC_LIMITS = {
  /** Refs in one POST /v1/media/sign. */
  sign_refs: 50,
  /** Seconds a signed link lives after the hour it was signed in. */
  sign_ttl_s: 3 * 60 * 60,
} as const;

/** GET /v1/music/catalog (`ETag`; `If-None-Match` answers 304). Each track is its record as the
 * old catalog kept it (id, sha256, size, audioKey, mimeType, path, r2Identity, coverKey…,
 * metadata), with `waveformBars: true` when GET /v1/music/waveforms/:id has one. */
export interface MusicCatalog {
  version: 1;
  kind: 'r2-library';
  complete: true;
  count: number;
  generatedAt: string;
  tracks: (Record<string, unknown> & { id: string; waveformBars?: true })[];
}

/** One track as the mind sees it (GET /v1/music/tracks?q=&limit=): its tags, for picking songs. */
export interface MusicTrackRow {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  composer: string;
  year: number;
  /** Seconds. */
  dur: number;
}
export interface MusicTracksResponse {
  items: MusicTrackRow[];
  /** Every track the words match, though only `limit` come back. */
  total: number;
}

/** GET /v1/music/waveforms/:id: base64 of one byte a bar (16–1000 bars). */
export interface MusicWaveform {
  id: string;
  bars: string;
}

/** POST /v1/media/sign. `music:<id>` is the track's audio, `music:<id>#art` its cover. */
export interface MediaSignRequest {
  refs: string[];
}
export interface MediaSignResponse {
  items: { ref: string; url: string; expires_at: Ms }[];
  errors: { ref: string; code: 'not_found' | 'not_signable' }[];
}
