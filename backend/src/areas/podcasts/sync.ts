// Podcasts' positions and follows (NEXT-BATCH.md part 7, PODCASTS.md §5.4): the phone sends what it
// changed, the newer `updated_at` wins item by item (equal keeps what is there, so a batch sent
// twice changes nothing), and asks what changed since it last asked, by when the Worker took each
// row. The route has already set aside the items it can't take (sync-routes.ts), each reported by
// its place, so one bad item never costs the rest of its batch. The night reads the follows (with
// its own last check of each show) and records the shows it read; only a followed show takes a
// check, and a newest-episode time is never put past the Worker's clock (and an hour).
import {
  PODCAST_LIMITS,
  type PodcastChecked,
  type PodcastFollow,
  type PodcastProgress,
  type PodcastSyncResponse,
} from '../../../../shared/contract/podcasts.ts';
import { DAY, SECOND, utcDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { getSetting, putSetting } from '../settings/store';
import * as store from './store';

type Refused = PodcastSyncResponse['refused'];

export function putProgress(w: Writer, items: PodcastProgress[], refused: Refused): PodcastSyncResponse {
  let applied = 0;
  for (const p of items) if (store.putProgress(w.db, p, w.at)) applied++;
  return { applied, stale: items.length - applied, refused, at: w.at };
}

export function putFollows(w: Writer, items: PodcastFollow[], refused: Refused): PodcastSyncResponse {
  let applied = 0;
  for (const f of items) if (store.putFollow(w.db, f, w.at)) applied++;
  return { applied, stale: items.length - applied, refused, at: w.at };
}

export function checked(w: Writer, items: PodcastChecked[]): { updated: number; at: number } {
  const latest = w.at + PODCAST_LIMITS.ahead_ms;
  let updated = 0;
  for (const c of items) {
    const failed = c.failed === true;
    const row = {
      feed_url: c.feed_url,
      latest_at: failed || c.latest_at === null ? null : Math.min(c.latest_at, latest),
      new_n: failed ? 0 : c.new_n,
      failed,
    };
    if (store.markChecked(w.db, row, w.at)) updated++;
  }
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

/** The settings row that counts the night's feed reads: `{day, n}` for the UTC day. */
export const NIGHT_READS = 'podcasts.night_reads';

/** May the night read this feed now? Only a show the owner follows (one row read: the night can't
 * make the Worker fetch any other address), and at most `night_feed_reads` a UTC day, counted in a
 * stored row (one row read and one written per read; a restart or a deploy doesn't reset it).
 * A refused address costs no count. */
export function admitNightFeed(
  db: Db,
  feedUrl: string,
  now: number,
): { ok: true } | { ok: false; code: 'forbidden' } | { ok: false; code: 'rate_limited'; retry_after: number } {
  if (!store.followed(db, feedUrl)) return { ok: false, code: 'forbidden' };
  const today = utcDay(now);
  const had = getSetting(db, NIGHT_READS) as { day?: unknown; n?: unknown } | undefined;
  const n = had?.day === today && typeof had.n === 'number' ? had.n : 0;
  if (n >= PODCAST_LIMITS.night_feed_reads) {
    const midnight = Date.parse(`${today}T00:00:00Z`) + DAY;
    return { ok: false, code: 'rate_limited', retry_after: Math.max(1, Math.ceil((midnight - now) / SECOND)) };
  }
  putSetting(db, NIGHT_READS, { day: today, n: n + 1 }, 'mind:night', now);
  return { ok: true };
}
