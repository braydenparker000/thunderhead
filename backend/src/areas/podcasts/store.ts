// SQL for Podcasts' positions and follows inside Core (DATA.md §4.1). A write is one upsert per item
// that changes the row only when its `updated_at` is newer (the newer wins, PODCASTS.md §5.4 rule
// 4); an older or equal one reads its row and writes nothing. A page walks the `synced_at` index from
// the caller's cursor, so it reads the rows it returns. Stores never write the change feed, and these
// write none: nothing home or the mind shows changes when a phone syncs, and the phones ask by time.

import { episodeID } from '../../../../frontend/th/podcasts/feed.js';
import { PODCAST_LIMITS, type PodcastFollow, type PodcastProgress } from '../../../../shared/contract/podcasts.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface ProgressRow {
  key: string;
  position_s: number;
  duration_s: number;
  played: 0 | 1;
  updated_at: number;
  synced_at: number;
}

export interface FollowRow {
  feed_url: string;
  title: string;
  author: string;
  artwork: string;
  followed: 0 | 1;
  updated_at: number;
  synced_at: number;
  checked_at: number | null;
  latest_at: number | null;
  new_n: number;
  fails: number;
  show_id: string;
}

/** A show's opaque id, the night's only name for it (16 hex digits, the phone's own hash). */
export const showId = (feedUrl: string): string => episodeID(feedUrl);

/** One position, kept if newer. Returns whether it was. */
export function putProgress(db: Db, p: PodcastProgress, at: number): boolean {
  return (
    db.run(
      `INSERT INTO podcast_progress (key, position_s, duration_s, played, updated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET position_s = excluded.position_s, duration_s = excluded.duration_s,
         played = excluded.played, updated_at = excluded.updated_at, synced_at = excluded.synced_at
       WHERE excluded.updated_at > podcast_progress.updated_at`,
      p.key,
      p.position_s,
      p.duration_s,
      p.played ? 1 : 0,
      p.updated_at,
      at,
    ) > 0
  );
}

/** One episode's position, by its key (one read), or null. */
export const progressOf = (db: Db, key: string) =>
  db.one<ProgressRow>(
    'SELECT key, position_s, duration_s, played, updated_at, synced_at FROM podcast_progress WHERE key = ?',
    key,
  );

/** Positions taken after the `[synced_at, key]` cursor, oldest first. */
export const progressPage = (db: Db, after: [number, string], limit: number) =>
  db.all<ProgressRow>(
    `SELECT key, position_s, duration_s, played, updated_at, synced_at FROM podcast_progress
     WHERE (synced_at, key) > (?, ?) ORDER BY synced_at, key LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

/** One follow or unfollow, kept if newer; the night's check of the show stays. */
export function putFollow(db: Db, f: PodcastFollow, at: number): boolean {
  return (
    db.run(
      `INSERT INTO podcast_follows (feed_url, title, author, artwork, followed, updated_at, synced_at, show_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (feed_url) DO UPDATE SET title = excluded.title, author = excluded.author, artwork = excluded.artwork,
         followed = excluded.followed, updated_at = excluded.updated_at, synced_at = excluded.synced_at
       WHERE excluded.updated_at > podcast_follows.updated_at`,
      f.feed_url,
      f.title,
      f.author,
      f.artwork,
      f.followed ? 1 : 0,
      f.updated_at,
      at,
      showId(f.feed_url),
    ) > 0
  );
}

/** Follows taken after the `[synced_at, feed_url]` cursor, oldest first. */
export const followsPage = (db: Db, after: [number, string], limit: number) =>
  db.all<FollowRow>(
    `SELECT feed_url, title, author, artwork, followed, updated_at, synced_at, checked_at, latest_at, new_n, fails, show_id
     FROM podcast_follows WHERE (synced_at, feed_url) > (?, ?) ORDER BY synced_at, feed_url LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

/** The night read a followed show: when, the newest episode it saw (never earlier than before) and
 * how many were new; or its feed failed (one more failure in a row, nothing new). `synced_at`
 * stays, so the phones are not sent the row again. */
export function markChecked(
  db: Db,
  c: { show_id: string; latest_at: number | null; new_n: number; failed: boolean },
  at: number,
): boolean {
  if (c.failed)
    return (
      db.run(
        'UPDATE podcast_follows SET checked_at = ?, new_n = 0, fails = fails + 1 WHERE show_id = ? AND followed = 1',
        at,
        c.show_id,
      ) > 0
    );
  return (
    db.run(
      `UPDATE podcast_follows SET checked_at = ?, new_n = ?, fails = 0,
         latest_at = CASE WHEN ? IS NULL THEN latest_at ELSE max(coalesce(latest_at, 0), ?) END
       WHERE show_id = ? AND followed = 1`,
      at,
      c.new_n,
      c.latest_at,
      c.latest_at,
      c.show_id,
    ) > 0
  );
}

/** New episodes the night counted in the shows it checked since `since` (the Briefing's line of
 * the day): one pass over the follows, a handful of rows. */
export const newSince = (db: Db, since: number) =>
  db.one<{ n: number }>(
    'SELECT coalesce(sum(new_n), 0) AS n FROM podcast_follows WHERE followed = 1 AND checked_at >= ?',
    since,
  )?.n ?? 0;

/** Of these positions' keys, the ones a phone has started or finished: one lookup each (a handful). */
export function started(db: Db, keys: string[]): string[] {
  return keys.filter((key) => {
    const r = db.one<{ played: number; position_s: number }>(
      'SELECT played, position_s FROM podcast_progress WHERE key = ?',
      key,
    );
    return r !== null && (r.played === 1 || r.position_s > 0);
  });
}

/** The address of a show the owner follows, by its id (the night may read only those), or null. One
 * row read (the index on show_id). */
export const followedURL = (db: Db, id: string) =>
  db.one<{ u: string }>('SELECT feed_url AS u FROM podcast_follows WHERE show_id = ? AND followed = 1', id)?.u ?? null;

/** The newest 1,000 positions by `updated_at` stay; the rest go, at most `max` a call (DATA.md §10).
 * It reads the table once a day (about twice its rows: the sort; a busy day may hold a few more
 * than 1,000 until then), and deletes one row at a time (a handful a day). */
export function pruneProgress(db: Db, _now: number, max: number): number {
  const old = db.all<{ key: string }>(
    'SELECT key FROM podcast_progress ORDER BY updated_at DESC, key DESC LIMIT ? OFFSET ?',
    max,
    PODCAST_LIMITS.progress_keep,
  );
  for (const { key } of old) db.run('DELETE FROM podcast_progress WHERE key = ?', key);
  return old.length;
}

/** An unfollow older than 30 days goes, then anything past 300 rows (unfollows first, oldest first). */
export function pruneFollows(db: Db, now: number, max: number): number {
  const gone = db.all<{ feed_url: string }>(
    'SELECT feed_url FROM podcast_follows WHERE followed = 0 AND updated_at < ? LIMIT ?',
    now - PODCAST_LIMITS.unfollowed_keep_days * DAY,
    max,
  );
  if (gone.length < max)
    gone.push(
      ...db.all<{ feed_url: string }>(
        `SELECT feed_url FROM podcast_follows WHERE NOT (followed = 0 AND updated_at < ?)
         ORDER BY followed DESC, updated_at DESC, feed_url DESC LIMIT ? OFFSET ?`,
        now - PODCAST_LIMITS.unfollowed_keep_days * DAY,
        max - gone.length,
        PODCAST_LIMITS.follows_keep,
      ),
    );
  for (const { feed_url } of gone) db.run('DELETE FROM podcast_follows WHERE feed_url = ?', feed_url);
  return gone.length;
}
