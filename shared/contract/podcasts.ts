// Podcasts on the Worker (NEXT-BATCH.md part 7, PODCASTS.md §5.4): where each episode was left, so
// it resumes on any phone, and the shows the owner follows, so the night can look for new episodes.
// The ported app keeps both in its own storage; frontend/th/podcasts/progress.js syncs them, the
// newer `updated_at` winning on both sides. An episode's key is the app's own `<feed address>#<id>`
// (the id is the feed reader's 16-hex hash of its guid): kept as it is, so a phone that never saw
// the episode can still resume it, and the night can match a position to a show. It travels only
// in JSON bodies (never a path, a query or a log line). The phone's copy of these limits is
// frontend/th/contract.js (scripts/contract.mjs); its key check is the same rule
// (tests/podcasts-progress.test.mjs checks the two agree).
import type { Ms } from './api.ts';

export const PODCAST_LIMITS = {
  /** Positions kept: the newest by `updated_at` (the daily prune deletes the rest). */
  progress_keep: 1000,
  /** Items in one PUT (the phone sends more as several, each under 60 KB). */
  batch_items: 100,
  /** A feed address, in characters (PODCASTS.md §3.2). */
  url_chars: 2000,
  /** An episode id, after the key's last `#`: letters, digits, `_` and `-`. */
  id_chars: 64,
  /** A position or a length, in seconds (a week: the feed reader's own cap). */
  seconds_max: 604_800,
  /** How far an `updated_at` may run ahead of the Worker's clock (a phone's clock that is off by
   * more would win every merge for as long). */
  ahead_ms: 3_600_000,
  /** A show's title and author, in characters (the feed reader's caps). */
  title_chars: 300,
  author_chars: 200,
  /** Follow rows kept: an unfollow stays this many days, so the other phones learn it; at most
   * `follows_keep` rows in all (the app follows at most 100). */
  unfollowed_keep_days: 30,
  follows_keep: 300,
  /** Rows in one page of a GET. */
  page_max: 500,
  /** The night's check (RUNTIME.md §12.1): shows a night, and how long before a show is due again. */
  night_feeds: 20,
  check_gap_ms: 20 * 3_600_000,
  /** Feeds the night may read through GET /v1/podcasts/feed in a UTC day (its 20, and a try more each). */
  night_feed_reads: 40,
} as const;

/** Where one episode was left. `played`: finished (PODCASTS.md §5.4 rule 3); it starts again from 0. */
export interface PodcastProgress {
  /** `<feed address>#<episode id>`, as the app keys it. */
  key: string;
  position_s: number;
  /** 0 when unknown. */
  duration_s: number;
  played: boolean;
  /** When the phone saved it (its clock). The newer wins. */
  updated_at: Ms;
}

/** A show followed (or unfollowed: `followed: false`, kept a while so the other phones learn it). */
export interface PodcastFollow {
  feed_url: string;
  title: string;
  author: string;
  /** An http(s) address, or ''. */
  artwork: string;
  followed: boolean;
  updated_at: Ms;
}

/** A follow as the Worker keeps it, with the night's last check of the show. */
export interface PodcastFollowRow extends PodcastFollow {
  /** When the night last read the show's feed. */
  checked_at: Ms | null;
  /** The newest episode's publication time it saw then: later ones are new. */
  latest_at: Ms | null;
  /** New episodes it found then (not yet started on any phone). */
  new_n: number;
}

export interface PodcastProgressRequest {
  items: PodcastProgress[];
}

export interface PodcastFollowsRequest {
  items: PodcastFollow[];
}

/** `applied`: items newer than what the Worker had; `stale`: the rest, left as they were. */
export interface PodcastSyncResponse {
  applied: number;
  stale: number;
  at: Ms;
}

/** What changed since `since` (when the Worker took it), oldest first. With `next`, ask again with
 * `cursor=next`; once it is null, keep `next_since` for the next time. */
export interface PodcastPage<T> {
  items: T[];
  next_since: Ms;
  next: string | null;
}

/** One show the night read (POST /v1/podcasts/follows/checked). */
export interface PodcastChecked {
  feed_url: string;
  latest_at: Ms | null;
  new_n: number;
}

export interface PodcastCheckedRequest {
  items: PodcastChecked[];
}

export interface PodcastCheckedResponse {
  updated: number;
  at: Ms;
}

/** Why a progress key is refused, or null: `<http(s) address of at most url_chars>#<id>`. */
export function progressKeyProblem(key: string): string | null {
  const cut = key.lastIndexOf('#');
  if (cut < 1) return 'not <feed address>#<episode id>';
  const feed = key.slice(0, cut);
  const id = key.slice(cut + 1);
  if (!new RegExp(`^[A-Za-z0-9_-]{1,${PODCAST_LIMITS.id_chars}}$`).test(id)) return 'an episode id of letters and digits';
  return feedProblem(feed);
}

/** Why a feed address is refused, or null: http(s), at most url_chars, no credentials. */
export function feedProblem(url: string): string | null {
  if (url.length > PODCAST_LIMITS.url_chars) return `a feed address of at most ${PODCAST_LIMITS.url_chars} characters`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'an http(s) address';
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return 'an http(s) address';
  return null;
}
