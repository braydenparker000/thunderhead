// Podcasts' Up Next and playback speed inside Core (PODCASTS.md §5.4, schema step 49), synced by
// the phone like the positions (sync.ts): one upsert per item, kept only when its `updated_at` is
// newer (equal keeps what is there, so a batch sent twice writes nothing), and read by the phones by
// when the Worker took each row. Each edit of Up Next on a phone is a new version of the whole queue:
// its members carry the version's stamp and their place, and each episode it took out goes as a
// removal (`queued = 0`, no episode), kept so it does not come back. The queue is the members at the
// newest stamp, so the newer whole version wins; a member the Worker holds as removed after the
// version the phone last had (`base`, on another phone) stays removed. No change-feed row.
import {
  PODCAST_LIMITS,
  type PodcastPref,
  type PodcastQueueItem,
  type PodcastSyncResponse,
} from '../../../../shared/contract/podcasts.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';

export interface QueueRow {
  key: string;
  pos: number;
  queued: 0 | 1;
  episode: string;
  updated_at: number;
  synced_at: number;
}

export interface PrefRow {
  name: string;
  value: number;
  updated_at: number;
  synced_at: number;
}

type Refused = PodcastSyncResponse['refused'];

/** One Up Next item, kept if newer, unless it is a member the Worker holds as removed after the
 * phone's `base`. Returns whether it was. */
export function putQueueItem(db: Db, q: PodcastQueueItem, at: number): boolean {
  return (
    db.run(
      `INSERT INTO podcast_queue (key, pos, queued, episode, updated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET pos = excluded.pos, queued = excluded.queued, episode = excluded.episode,
         updated_at = excluded.updated_at, synced_at = excluded.synced_at
       WHERE excluded.updated_at > podcast_queue.updated_at
         AND NOT (excluded.queued = 1 AND podcast_queue.queued = 0 AND podcast_queue.updated_at > ?)`,
      q.key,
      q.queued ? q.pos : 0,
      q.queued ? 1 : 0,
      q.queued && q.episode ? JSON.stringify(q.episode) : '',
      q.updated_at,
      at,
      q.base,
    ) > 0
  );
}

/** One preference, kept if newer. */
export const putPref = (db: Db, p: PodcastPref, at: number): boolean =>
  db.run(
    `INSERT INTO podcast_prefs (name, value, updated_at, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, synced_at = excluded.synced_at
     WHERE excluded.updated_at > podcast_prefs.updated_at`,
    p.name,
    p.value,
    p.updated_at,
    at,
  ) > 0;

export function putQueue(w: Writer, items: PodcastQueueItem[], refused: Refused): PodcastSyncResponse {
  let applied = 0;
  for (const q of items) if (putQueueItem(w.db, q, w.at)) applied++;
  return { applied, stale: items.length - applied, refused, at: w.at };
}

export function putPrefs(w: Writer, items: PodcastPref[], refused: Refused): PodcastSyncResponse {
  let applied = 0;
  for (const p of items) if (putPref(w.db, p, w.at)) applied++;
  return { applied, stale: items.length - applied, refused, at: w.at };
}

/** Up Next rows taken after the `[synced_at, key]` cursor, oldest first. */
export const queuePage = (db: Db, after: [number, string], limit: number) =>
  db.all<QueueRow>(
    `SELECT key, pos, queued, episode, updated_at, synced_at FROM podcast_queue
     WHERE (synced_at, key) > (?, ?) ORDER BY synced_at, key LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

/** Preferences taken after the `[synced_at, name]` cursor (one row in all). */
export const prefsPage = (db: Db, after: [number, string], limit: number) =>
  db.all<PrefRow>(
    `SELECT name, value, updated_at, synced_at FROM podcast_prefs
     WHERE (synced_at, name) > (?, ?) ORDER BY synced_at, name LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

export const toQueueItem = (r: QueueRow): Omit<PodcastQueueItem, 'base'> => ({
  key: r.key,
  pos: r.pos,
  queued: r.queued === 1,
  episode: r.queued === 1 && r.episode ? JSON.parse(r.episode) : null,
  updated_at: r.updated_at,
});

export const toPref = (r: PrefRow) => ({ name: r.name, value: r.value, updated_at: r.updated_at }) as PodcastPref;

/** A row of an older version (a removal, or a member another phone's newer version left out) goes
 * after 30 days; then anything past 500 rows, oldest first. The newest version stays however old.
 * It reads the table once a day (a few hundred rows at most). */
export function pruneQueue(db: Db, now: number, max: number): number {
  const newest = db.one<{ u: number | null }>('SELECT max(updated_at) AS u FROM podcast_queue')?.u ?? 0;
  const cut = now - PODCAST_LIMITS.unfollowed_keep_days * DAY;
  const gone = db.all<{ key: string }>(
    'SELECT key FROM podcast_queue WHERE updated_at < ? AND updated_at < ? LIMIT ?',
    newest,
    cut,
    max,
  );
  if (gone.length < max)
    gone.push(
      ...db.all<{ key: string }>(
        `SELECT key FROM podcast_queue WHERE NOT (updated_at < ? AND updated_at < ?)
         ORDER BY updated_at DESC, key DESC LIMIT ? OFFSET ?`,
        newest,
        cut,
        max - gone.length,
        PODCAST_LIMITS.queue_keep,
      ),
    );
  for (const { key } of gone) db.run('DELETE FROM podcast_queue WHERE key = ?', key);
  return gone.length;
}
