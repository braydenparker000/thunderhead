// Guitar's progress on the Worker (GUITAR.md §1.1, API.md §11.28): one record per song, so a song's
// library entry, its tempo-ladder records and its practice seconds follow the owner to another
// phone. The phone keeps them in two places (the ported library `jarvis.guitar.v2`,
// frontend/guitar/store.js, and the ladder `th.p.guitar.ladder`, th/guitar/practice.js);
// frontend/th/guitar/progress.js syncs them, the newer `updated_at` winning on both sides, as
// Podcasts' positions do (podcasts.ts). The Worker keeps each record as sent, its size and shape
// checked; the phone checks every field again when it takes one. Kept-offline tab files are not
// synced (they can be fetched again). The phone's copy of the limits it needs is `L` in
// frontend/th/guitar/progress.js (tests/guitar-progress.test.mjs checks both agree).
import type { Ms } from './api.ts';

export const GUITAR_LIMITS = {
  /** Records kept: the newest by `updated_at` (the daily prune deletes the rest; the phone keeps 400). */
  progress_keep: 1000,
  /** Records in one PUT (the phone sends more as several, each under 60 KB). */
  batch_items: 50,
  /** One record as JSON, in characters. */
  item_chars: 16_000,
  /** A song's key: `s<Songsterr id>` or `g:<artist>/<song>` (store.js songKey). */
  key_chars: 120,
  /** A song's library entry: at most this many fields. */
  song_fields: 24,
  /** Ladder sections a song keeps (ladder.js cleanLadder). */
  sections_max: 24,
  /** Days of practice seconds a song keeps (store.js MAX_DAYS). */
  days_max: 400,
  /** How far an `updated_at` may run ahead of the Worker's clock. */
  ahead_ms: 3_600_000,
  /** Records in one page of a GET. */
  page_max: 100,
} as const;

/** A song's key as the phone's library makes it (store.js songKey). */
export const GUITAR_KEY = /^(s\d{1,15}|g:[a-z0-9-]{1,50}\/[a-z0-9-]{1,50})$/;

/** One ladder section's record (th/guitar/ladder.js `Rec`). */
export interface GuitarSectionDay {
  day: string;
  passes: number;
  clean: number;
  ceiling: number;
}
export interface GuitarSectionRec extends GuitarSectionDay {
  best: number;
  last: GuitarSectionDay | null;
}

/** One song's progress. `song` is the library entry (store.js `clean`: title, artist, track, status,
 * star, bar, loop, speed, best, seconds…), null when the song is in no library; `ladder` its
 * sections by `<first bar>-<last bar>`; `days` its practice seconds by local day. */
export interface GuitarProgress {
  key: string;
  song: Record<string, unknown> | null;
  ladder: Record<string, GuitarSectionRec>;
  days: Record<string, number>;
  /** The phone's own clock at the save (`updated_at` is on the Worker's): the phone that saved it
   * knows its own record again by it. */
  phone_at: Ms;
  /** When the phone saved it, on the Worker's clock. The newer wins. */
  updated_at: Ms;
}

/** A PUT's answer: how many were newer and kept, how many were not newer, the items refused by
 * their place, and the Worker's clock. */
export interface GuitarSyncResponse {
  applied: number;
  stale: number;
  refused: { index: number; issue: string }[];
  at: Ms;
}

/** A GET's page, oldest first: `next_since` for the next `?since=`, `next` a cursor while there is more. */
export interface GuitarPage {
  items: GuitarProgress[];
  next_since: Ms;
  next: string | null;
}
