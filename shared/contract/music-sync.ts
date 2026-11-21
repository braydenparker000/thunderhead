// Music's own data on every phone (MUSIC.md §1.4, API.md §11.29): the owner's per-song marks (the
// rating, which is also the like and "never play this again", the play count and when it last
// played) and their playlists, which the player keeps in its IndexedDB `claude-player`.
// frontend/th/music/sync.js syncs them, one record per song and one per playlist. A song's rating
// is kept in the one table the mind already reads (`track_ratings`, which the `music.rate` senses
// also write; a sense's time is the phone's own clock, so it never beats a synced rating): the newer
// `rated_at` wins. Play counts merge, the larger count and the later `last_played` kept; a Reset
// stats is a record with its own time (`reset_at`, the newest kept) that wins over older plays on
// both sides. A playlist's newer `updated_at` wins whole; a deleted one is a record marked
// `deleted`, kept 30 days so it does not come back. Ids, numbers and the owner's playlist names
// only, in JSON bodies (never a path, a query or a log line). This data goes by its own routes: the
// catalog (GET /v1/music/catalog) and its ETag never change with it. The phone's copy of the limits
// is `L` in frontend/th/music/sync.js (tests/music-sync.test.mjs checks both agree).
import type { Ms } from './api.ts';

export const MUSIC_SYNC_LIMITS = {
  /** Songs in one PUT /v1/music/marks (the phone sends more as several). */
  batch_marks: 200,
  /** Playlists in one PUT /v1/music/playlists. */
  batch_playlists: 20,
  /** One playlist record as JSON, in characters (5,000 songs of the longest id fit). */
  playlist_chars: 450_000,
  /** Songs (entries) in one playlist (MUSIC.md §4.1). */
  playlist_ids: 5000,
  /** One playlist entry: a song id, or an imported file's unresolved `path:<path>`. */
  entry_chars: 600,
  /** A playlist's name, and the file name it was imported from. */
  name_chars: 300,
  /** How far an `updated_at`, `rated_at` or `last_played` may run ahead of the Worker's clock. */
  ahead_ms: 3_600_000,
  /** Records in one page of a GET. */
  page_max: 200,
  /** Days a deleted playlist's record is kept, so a phone that still has it does not bring it back. */
  gone_days: 30,
} as const;

/** A playlist's id as the player makes it (base 36 time and random letters). */
export const MUSIC_PLAYLIST_ID = /^[a-z0-9]{4,40}$/;

/** One song's marks. `rating` 0–5 (5 the like, 1 "not for me", which is also "never play this
 * again") with `rated_at`, when it was set (the newer wins), both null when the phone has none;
 * `plays` and `last_played` (0: never), which merge by the larger; `updated_at` the record's newest
 * change (the later of `rated_at` and `last_played`, at least 1). Times on the Worker's clock. */
export interface MusicMark {
  id: string;
  rating: number | null;
  rated_at: Ms | null;
  plays: number;
  last_played: Ms;
  updated_at: Ms;
}

/** One playlist: its name, its entries in order (song ids, or `path:<path>` an imported file could
 * not resolve), when it was made, the file it came from (`path`, or null), and `deleted`. The newer
 * `updated_at` (on the Worker's clock) wins whole. */
export interface MusicPlaylist {
  id: string;
  name: string;
  ids: string[];
  created: Ms;
  path: string | null;
  deleted: boolean;
  updated_at: Ms;
}

/** A PUT's answer: how many changed something, how many did not, the items refused by place, and
 * the Worker's clock. */
export interface MusicSyncResponse {
  applied: number;
  stale: number;
  refused: { index: number; issue: string }[];
  at: Ms;
}

/** A GET's page, oldest first by when the Worker took each: `next_since` for the next `?since=`,
 * `next` a cursor while there is more. A song changed in both its rating and its plays may come
 * twice; the record is the whole of it each time. */
export interface MusicMarksPage {
  items: MusicMark[];
  next_since: Ms;
  next: string | null;
  /** The newest Settings → Reset stats, on the Worker's clock (0: none): a phone sets every song
   * last played at or before it back to no plays; plays from before it read as none. */
  reset_at: Ms;
}
export interface MusicPlaylistsPage {
  items: MusicPlaylist[];
  next_since: Ms;
  next: string | null;
}
