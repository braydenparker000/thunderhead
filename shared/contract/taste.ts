// The owner's taste from their own listening history (MUSIC.md §16): play counts by artist, album and
// year from the exports they drop in Settings › Music (Spotify's extended streaming history, YouTube
// Music's takeout, a Last.fm export), artists resolved to MusicBrainz ids, and similar artists from
// ListenBrainz. What the mind reads is counts, ids and canonical names: an artist's name as a file
// spelled it never leaves the Worker as text the mind reads (PRIVACY.md §3).
import type { Ms } from './api.ts';

export const TASTE_SOURCES = ['spotify', 'youtube', 'lastfm'] as const;
export type TasteSource = (typeof TASTE_SOURCES)[number];

export const TASTE_LIMITS = {
  /** One export file (zip or json or csv), PUT /v1/music/history. */
  file_bytes: 32 * 1024 * 1024,
  /** Summary rows a part carries, one job step each (the bulk lane's chunk). */
  part_rows: 2_000,
  /** A Spotify stream counts as a play from 30 s, as Spotify's own count does. */
  play_ms: 30_000,
  /** Artists the MusicBrainz job resolves: those with at least this many plays, most played first. */
  mb_min_plays: 3,
  /** Between two MusicBrainz requests (its rule: one a second). */
  mb_gap_ms: 1_100,
  /** A failed lookup is tried again this many times, then left as the name. */
  mb_tries: 3,
  /** ListenBrainz's similar artists are kept this long. */
  similar_ms: 7 * 86_400_000,
  similar_max: 50,
  taste_default: 10,
  taste_max: 50,
} as const;

/** PUT /v1/music/history (200 when this file was imported before, 202 when its job is queued). */
export interface HistoryPut {
  sha256: string;
  /** From the file's name (or a zip's entries' names); null until its import reads it. */
  source: TasteSource | null;
  state: 'queued' | 'running' | 'done' | 'failed';
}

/** One imported file: counts only. */
export interface HistoryFile {
  sha256: string;
  source: TasteSource;
  state: 'running' | 'done';
  plays: number;
  minutes: number;
  /** Summary rows (artist, album, year) the file gave, and plays it left out (no artist, too short). */
  rows: number;
  skipped: number;
  at: Ms;
}

/** GET /v1/music/history: the files and the artists, resolved or not. */
export interface HistoryStatus {
  files: HistoryFile[];
  artists: number;
  resolved: number;
}

/** An artist as the mind reads it: its MusicBrainz id and canonical name when resolved, else an
 * opaque id and no name; plays and minutes; songs of theirs the catalog holds. */
export interface TasteArtist {
  id: string;
  mbid: string | null;
  name: string | null;
  plays: number;
  minutes: number;
  songs: number;
}

/** GET /v1/music/taste: top artists and years by plays, and the totals. */
export interface TasteResponse {
  plays: number;
  minutes: number;
  artists: number;
  years: { year: number; plays: number }[];
  top: TasteArtist[];
}

/** GET /v1/music/taste/weights (the owner's phone, for the DJ shuffle): each catalog song whose
 * artist the owner played, 0–1 by the log of the plays; `on: false` and none while the switch "Use
 * my listening history" (`music.history`) is off. Song ids and numbers only. */
export interface TasteWeightsResponse {
  on: boolean;
  weights: Record<string, number>;
}

/** GET /v1/music/similar/:mbid: ListenBrainz's similar artists (and Last.fm's when its key is set). */
export interface SimilarResponse {
  mbid: string;
  fetched_at: Ms;
  items: { mbid: string; name: string; score: number; plays: number; songs: number }[];
}
