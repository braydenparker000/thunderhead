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

/** What an episode's position was, for the undo of `podcasts.mark_played` (null: none kept). */
export type ProgressWas = { position_s: number; duration_s: number; played: boolean } | null;

/** The `podcasts.mark_played` verb (verbs/worker.ts): the episode played (from 0, PODCASTS.md §5.4
 * rule 3), stamped newer than whatever is kept, so every phone takes it when Podcasts opens (the
 * newer wins). Null when it was played already (nothing written); else what it was and the stamp. */
export function markPlayed(w: Writer, key: string): { was: ProgressWas; stamp: number } | null {
  const had = store.progressOf(w.db, key);
  if (had?.played === 1) return null;
  const stamp = Math.max(w.at, (had?.updated_at ?? 0) + 1);
  store.putProgress(
    w.db,
    { key, position_s: 0, duration_s: had?.duration_s ?? 0, played: true, updated_at: stamp },
    w.at,
  );
  const was = had ? { position_s: had.position_s, duration_s: had.duration_s, played: false } : null;
  return { was, stamp };
}

/** Its undo: where the episode was left, stamped newer again, only while the played mark is still
 * the one written (a phone that moved on since stands: 409 from the caller). Whether it was. */
export function unmarkPlayed(w: Writer, key: string, was: ProgressWas, stamp: number): boolean {
  const now = store.progressOf(w.db, key);
  if (!now || now.updated_at !== stamp || now.played !== 1) return false;
  store.putProgress(
    w.db,
    {
      key,
      position_s: was?.position_s ?? 0,
      duration_s: was?.duration_s ?? now.duration_s,
      played: was?.played ?? false,
      updated_at: Math.max(w.at, stamp + 1),
    },
    w.at,
  );
  return true;
}

/** The night's checks, by show id. The numbers are clamped here, never refused: a feed's odd dates or
 * a re-dated back catalogue can't make the night's whole report bounce (then nothing would be
 * recorded and the same shows would take every slot again). A time at or before 1970, or past the
 * Worker's clock and an hour, is no time; at most `new_max` new. */
export function checked(w: Writer, items: PodcastChecked[]): { updated: number; at: number } {
  let updated = 0;
  for (const c of items) {
    const failed = c.failed === true;
    const row = {
      show_id: c.show_id,
      latest_at: failed ? null : timeOf(c.latest_at, w.at),
      new_n: failed ? 0 : countOf(c.new_n),
      failed,
    };
    if (store.markChecked(w.db, row, w.at)) updated++;
  }
  return { updated, at: w.at };
}

/** A publication time worth keeping, or null. @param now the Worker's clock */
export const timeOf = (t: number | null, now: number): number | null =>
  t !== null && Number.isFinite(t) && t > 0 && t <= now + PODCAST_LIMITS.ahead_ms ? Math.floor(t) : null;

/** A count of new episodes, whole and at most `new_max`. */
export const countOf = (n: number): number =>
  Math.min(PODCAST_LIMITS.new_max, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

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

/** May the night read this show's feed now, and at which address? Only a show the owner follows, named
 * by its id (one row read: the night never sees an address, and can't make the Worker fetch any
 * other), and at most `night_feed_reads` a UTC day, counted in a stored row (one row read and one
 * written per read; a restart or a deploy doesn't reset it). A refused show costs no count. */
export function admitNightFeed(
  db: Db,
  showId: string,
  now: number,
):
  | { ok: true; url: string }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'rate_limited'; retry_after: number } {
  const url = store.followedURL(db, showId);
  if (url === null) return { ok: false, code: 'forbidden' };
  const today = utcDay(now);
  const had = getSetting(db, NIGHT_READS) as { day?: unknown; n?: unknown } | undefined;
  const n = had?.day === today && typeof had.n === 'number' ? had.n : 0;
  if (n >= PODCAST_LIMITS.night_feed_reads) {
    const midnight = Date.parse(`${today}T00:00:00Z`) + DAY;
    return { ok: false, code: 'rate_limited', retry_after: Math.max(1, Math.ceil((midnight - now) / SECOND)) };
  }
  putSetting(db, NIGHT_READS, { day: today, n: n + 1 }, 'mind:night', now);
  return { ok: true, url };
}
