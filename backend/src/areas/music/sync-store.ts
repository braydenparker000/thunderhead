// SQL for the owner's Music data on every phone (sync-sql.ts, MUSIC.md §1.4). A song's rating is
// step 4's `putRating` (the newer `at` wins, stamped `synced_at`); its plays an upsert that writes
// only when the count or the time grows (the larger kept); a playlist an upsert that writes only when
// its `updated_at` is newer. A page walks the `synced_at` indexes from the caller's cursor, so it
// reads the rows it returns. Nothing here writes the change feed or touches the catalog.
import { MUSIC_SYNC_LIMITS, type MusicMark, type MusicPlaylist } from '../../../../shared/contract/music-sync.ts';
import type { Db } from '../../objects/base';
import { inParts, putRating, marks as slots } from './store-notes';

// --- Reset stats: a record with its own time (`music_state` 'plays.reset', the newest kept) ---------

/** The newest Reset stats, on the Worker's clock (0: none). One row read. */
export const resetAt = (db: Db) =>
  Number(db.one<{ v: string }>("SELECT value_json AS v FROM music_state WHERE key = 'plays.reset'")?.v ?? 0) || 0;

/** A Reset stats at `at`, kept if newer. Returns the rows written. */
export const putReset = (db: Db, at: number) =>
  db.run(
    `INSERT INTO music_state (key, value_json) VALUES ('plays.reset', ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json
     WHERE CAST(excluded.value_json AS INTEGER) > CAST(music_state.value_json AS INTEGER)`,
    String(at),
  );

/** One song's marks: its rating if newer, its plays if more or later. Plays last played at or
 * before the newest reset (`reset`) are from before it: they change nothing, and a row of such
 * plays is replaced, not added to. Returns the rows written. */
export function putMark(db: Db, m: MusicMark, at: number, reset: number): number {
  let n = 0;
  if (m.rating !== null && m.rated_at !== null) n += putRating(db, m.id, m.rating, m.rated_at, at);
  if ((m.plays > 0 || m.last_played > 0) && m.last_played > reset)
    n += db.run(
      `INSERT INTO track_plays (track_id, plays, last_played, synced_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (track_id) DO UPDATE SET
         plays = CASE WHEN track_plays.last_played <= ?5 THEN excluded.plays ELSE max(plays, excluded.plays) END,
         last_played = max(last_played, excluded.last_played), synced_at = excluded.synced_at
       WHERE excluded.plays > track_plays.plays OR excluded.last_played > track_plays.last_played
         OR track_plays.last_played <= ?5`,
      m.id,
      m.plays,
      m.last_played,
      at,
      reset,
    );
  return n;
}

/** The songs whose rating or plays the Worker took after the `[synced_at, id]` cursor, oldest first:
 * at most `limit` + 1 entries from each index, merged here, a song taken with both at once (a phone's
 * push stamps both) listed once, so a page holds `limit` songs, not half as many. Each index entry
 * read is one row (a merge in SQL read about 5 a song, its temporary tables included). */
export function markKeys(db: Db, after: [number, string], limit: number) {
  const from = (table: 'track_ratings' | 'track_plays') =>
    db.all<{ track_id: string; synced_at: number }>(
      `SELECT track_id, synced_at FROM ${table} WHERE (synced_at, track_id) > (?, ?) ORDER BY synced_at, track_id LIMIT ?`,
      after[0],
      after[1],
      limit,
    );
  const seen = new Set<string>();
  return [...from('track_ratings'), ...from('track_plays')]
    .sort((a, b) => a.synced_at - b.synced_at || (a.track_id < b.track_id ? -1 : a.track_id > b.track_id ? 1 : 0))
    .filter((k) => !seen.has(`${k.synced_at}|${k.track_id}`) && seen.add(`${k.synced_at}|${k.track_id}`))
    .slice(0, limit);
}

/** The whole marks of these songs (each read by its key, in both tables, 100 keys a statement: one
 * row a song a table); plays from before the newest reset read as none. */
export function marksOf(db: Db, ids: string[], reset: number): Map<string, MusicMark> {
  const out = new Map<string, MusicMark>();
  const blank = (id: string): MusicMark => ({
    id,
    rating: null,
    rated_at: null,
    plays: 0,
    last_played: 0,
    updated_at: 1,
  });
  for (const r of inParts(ids, (p) =>
    db.all<{ track_id: string; rating: number; at: number }>(
      `SELECT track_id, rating, at FROM track_ratings WHERE track_id IN (${slots(p.length)})`,
      ...p,
    ),
  )) {
    const m = blank(r.track_id);
    m.rating = r.rating;
    m.rated_at = r.at;
    out.set(r.track_id, m);
  }
  for (const r of inParts(ids, (p) =>
    db.all<{ track_id: string; plays: number; last_played: number }>(
      `SELECT track_id, plays, last_played FROM track_plays WHERE track_id IN (${slots(p.length)})`,
      ...p,
    ),
  )) {
    const m = out.get(r.track_id) ?? blank(r.track_id);
    if (r.last_played > reset) {
      m.plays = r.plays;
      m.last_played = r.last_played;
    }
    out.set(r.track_id, m);
  }
  for (const m of out.values()) m.updated_at = Math.max(1, m.rated_at ?? 0, m.last_played);
  return out;
}

export interface PlaylistRow {
  id: string;
  body: string;
  deleted: number;
  updated_at: number;
  synced_at: number;
}

/** One playlist's record, kept if newer. Returns the rows written. */
export function putPlaylist(db: Db, p: MusicPlaylist, at: number): number {
  const body = p.deleted ? '{}' : JSON.stringify({ name: p.name, ids: p.ids, created: p.created, path: p.path });
  return db.run(
    `INSERT INTO music_playlists (id, body, deleted, updated_at, synced_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET body = excluded.body, deleted = excluded.deleted,
       updated_at = excluded.updated_at, synced_at = excluded.synced_at
     WHERE excluded.updated_at > music_playlists.updated_at`,
    p.id,
    body,
    p.deleted ? 1 : 0,
    p.updated_at,
    at,
  );
}

/** Playlist records taken after the `[synced_at, id]` cursor, oldest first. */
export const playlistsPage = (db: Db, after: [number, string], limit: number) =>
  db.all<PlaylistRow>(
    `SELECT id, body, deleted, updated_at, synced_at FROM music_playlists
     WHERE (synced_at, id) > (?, ?) ORDER BY synced_at, id LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

/** A row as the phone reads it. */
export function toPlaylist(r: PlaylistRow): MusicPlaylist {
  const b = JSON.parse(r.body) as { name?: string; ids?: string[]; created?: number; path?: string | null };
  return {
    id: r.id,
    name: b.name ?? '',
    ids: b.ids ?? [],
    created: b.created ?? 0,
    path: b.path ?? null,
    deleted: r.deleted === 1,
    updated_at: r.updated_at,
  };
}

/** Deleted playlists' records older than 30 days go, at most `max` a call (the partial index). */
export function pruneGone(db: Db, now: number, max: number): number {
  return db.run(
    `DELETE FROM music_playlists WHERE id IN (
       SELECT id FROM music_playlists WHERE deleted = 1 AND updated_at < ? LIMIT ?)`,
    now - MUSIC_SYNC_LIMITS.gone_days * 86_400_000,
    max,
  );
}
