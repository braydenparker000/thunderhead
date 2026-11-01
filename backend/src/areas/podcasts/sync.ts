// Podcasts' positions and follows (NEXT-BATCH.md part 7, PODCASTS.md §5.4): the phone sends what it
// changed, the newer `updated_at` wins item by item (equal keeps what is there, so a batch sent
// twice changes nothing), and asks what changed since it last asked, by when the Worker took each
// row. An `updated_at` more than an hour ahead of the Worker's clock is refused: it would win every
// merge for as long. The night reads the follows (with its own last check of each show) and records
// the shows it read; only a followed show takes a check.
import {
  PODCAST_LIMITS,
  type PodcastChecked,
  type PodcastFollow,
  type PodcastProgress,
  type PodcastSyncResponse,
} from '../../../../shared/contract/podcasts.ts';
import { invalid } from '../../lib/result';
import { DAY, SECOND, utcDay } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import * as store from './store';

function notAhead(items: { updated_at: number }[], at: number): void {
  items.forEach((x, i) => {
    if (x.updated_at > at + PODCAST_LIMITS.ahead_ms) throw invalid(`items.${i}.updated_at`, 'more than an hour ahead');
  });
}

export function putProgress(w: Writer, items: PodcastProgress[]): PodcastSyncResponse {
  notAhead(items, w.at);
  let applied = 0;
  for (const p of items) if (store.putProgress(w.db, p, w.at)) applied++;
  return { applied, stale: items.length - applied, at: w.at };
}

export function putFollows(w: Writer, items: PodcastFollow[]): PodcastSyncResponse {
  notAhead(items, w.at);
  let applied = 0;
  for (const f of items) if (store.putFollow(w.db, f, w.at)) applied++;
  return { applied, stale: items.length - applied, at: w.at };
}

export function checked(w: Writer, items: PodcastChecked[]): { updated: number; at: number } {
  let updated = 0;
  for (const c of items) if (store.markChecked(w.db, c.feed_url, c.latest_at, c.new_n, w.at)) updated++;
  return { updated, at: w.at };
}

export const toProgress = (r: store.ProgressRow): PodcastProgress => ({
  key: r.key,
  position_s: r.position_s,
  duration_s: r.duration_s,
  played: r.played === 1,
  updated_at: r.updated_at,
});

export const toFollow = ({ followed, synced_at: _, ...r }: store.FollowRow) => ({ ...r, followed: followed === 1 });

/** One page: up to `limit` rows after the cursor, `more` when there are others, and the time of
 * the read (`next_since`: a row taken later has a `synced_at` at or after it). */
export function page<R extends { synced_at: number }>(
  read: (after: [number, string], limit: number) => R[],
  key: (r: R) => string,
  after: [number, string],
  limit: number,
  now: number,
): { rows: R[]; more: boolean; last: [number, string] | null; at: number } {
  const rows = read(after, limit + 1);
  const more = rows.length > limit;
  const kept = rows.slice(0, limit);
  const end = kept.at(-1);
  return { rows: kept, more, last: end ? [end.synced_at, key(end)] : null, at: now };
}

/** The night's feed reads, counted per UTC day in the object's memory (a loop can't read the
 * owner's shows' hosts all day; the count starts over with the object, which is fine for a guard).
 * Returns 0 and counts one more when it fits, else the seconds until 00:00 UTC. */
export function admitFeedRead(count: { day: string; n: number }, now: number): number {
  const today = utcDay(now);
  if (count.day !== today) {
    count.day = today;
    count.n = 0;
  }
  if (count.n >= PODCAST_LIMITS.night_feed_reads) {
    const midnight = Date.parse(`${today}T00:00:00Z`) + DAY;
    return Math.max(1, Math.ceil((midnight - now) / SECOND));
  }
  count.n++;
  return 0;
}
