// SQL for the owner's listening history in the Music object (MUSIC.md §16, DATA.md §6.2): Music schema
// step 5. `listen_files` keeps one row per imported file by its SHA-256 (its source, its parts and the
// next one to put, its counts), which makes an import idempotent per file and a retried part a no-op;
// `listens` the summary, one row per artist key, album, year and source (plays and minutes);
// `listen_artists` one row per artist key: the plays summed, and the MusicBrainz id and canonical
// name once resolved (`mb_state` due, found, none or failed); `similar_artists` ListenBrainz's answer
// per MusicBrainz id, kept a week. Counts, ids and names only: no track title is stored here.
import { TASTE_LIMITS as L, type TasteSource } from '../../../../shared/contract/taste.ts';
import type { Db } from '../../objects/base';
import type { SummaryRow } from './history-parse';
import { getState, putState } from './listen-store';

export const HISTORY_SQL = [
  `CREATE TABLE listen_files (
    sha256 TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    state TEXT NOT NULL,
    parts INTEGER NOT NULL,
    next INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    plays INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE listens (
    artist_key TEXT NOT NULL,
    album TEXT NOT NULL,
    year INTEGER NOT NULL,
    source TEXT NOT NULL,
    plays INTEGER NOT NULL,
    minutes REAL NOT NULL,
    PRIMARY KEY (artist_key, album, year, source)
  ) WITHOUT ROWID`,
  `CREATE TABLE listen_artists (
    artist_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plays INTEGER NOT NULL,
    minutes REAL NOT NULL,
    mbid TEXT,
    canonical TEXT,
    mb_state TEXT NOT NULL,
    mb_tries INTEGER NOT NULL,
    mb_at INTEGER
  ) WITHOUT ROWID`,
  'CREATE INDEX listen_artists_plays ON listen_artists (plays)',
  'CREATE INDEX listen_artists_due ON listen_artists (mb_state, plays)',
  `CREATE TABLE similar_artists (
    mbid TEXT PRIMARY KEY,
    items_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  ) WITHOUT ROWID`,
];
export const HISTORY_TABLES = ['listen_files', 'listens', 'listen_artists', 'similar_artists'] as const;

export interface FileRow {
  sha256: string;
  source: TasteSource;
  state: 'running' | 'done';
  parts: number;
  next: number;
  rows: number;
  plays: number;
  minutes: number;
  skipped: number;
  at: number;
}

export const fileOf = (db: Db, sha: string) => db.one<FileRow>('SELECT * FROM listen_files WHERE sha256 = ?', sha);
export const files = (db: Db, limit: number) =>
  db.all<FileRow>('SELECT * FROM listen_files ORDER BY at DESC LIMIT ?', limit);

/** A file split into its parts: its row, once (a split run again changes nothing). */
export function startFile(db: Db, f: Omit<FileRow, 'state' | 'next' | 'plays' | 'minutes'>): number {
  return db.run(
    `INSERT INTO listen_files (sha256, source, state, parts, next, rows, plays, minutes, skipped, at)
     VALUES (?, ?, ?, ?, 1, ?, 0, 0, ?, ?) ON CONFLICT (sha256) DO NOTHING`,
    f.sha256,
    f.source,
    f.parts ? 'running' : 'done',
    f.parts,
    f.rows,
    f.skipped,
    f.at,
  );
}

/** Part `n` of a file's summary, added to the counts once: only when it is the file's next part. */
export function putPart(db: Db, sha: string, n: number, rows: SummaryRow[], at: number): number {
  const f = fileOf(db, sha);
  if (!f || f.state !== 'running' || f.next !== n) return 0;
  let written = 0;
  const artists = new Map<string, { n: string; p: number; m: number }>();
  let plays = 0;
  let minutes = 0;
  for (const r of rows) {
    written += db.run(
      `INSERT INTO listens (artist_key, album, year, source, plays, minutes) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET plays = plays + excluded.plays, minutes = minutes + excluded.minutes`,
      r.k,
      r.a,
      r.y,
      f.source,
      r.p,
      r.m,
    );
    const a = artists.get(r.k) ?? { n: r.n, p: 0, m: 0 };
    a.p += r.p;
    a.m += r.m;
    artists.set(r.k, a);
    plays += r.p;
    minutes += r.m;
  }
  let added = 0;
  for (const [k, a] of artists) {
    if (!db.one('SELECT 1 AS x FROM listen_artists WHERE artist_key = ?', k)) added++;
    written += db.run(
      `INSERT INTO listen_artists (artist_key, name, plays, minutes, mb_state, mb_tries) VALUES (?, ?, ?, ?, 'due', 0)
       ON CONFLICT DO UPDATE SET plays = plays + excluded.plays, minutes = minutes + excluded.minutes`,
      k,
      a.n,
      a.p,
      a.m,
    );
  }
  // Plays by year and the totals, kept in one `music_state` row so taste reads one row, not the summary.
  const t = totals(db);
  for (const r of rows) t.years[r.y] = (t.years[r.y] ?? 0) + r.p;
  const next = { ...t, plays: t.plays + plays, minutes: t.minutes + minutes, artists: t.artists + added };
  written += putState(db, 'history.totals', next);
  const last = n >= f.parts;
  written += db.run(
    `UPDATE listen_files SET next = ?, state = ?, plays = plays + ?, minutes = minutes + ?, at = ? WHERE sha256 = ?`,
    n + 1,
    last ? 'done' : 'running',
    plays,
    Math.round(minutes),
    at,
    sha,
  );
  return written;
}

export interface ArtistRow {
  artist_key: string;
  name: string;
  plays: number;
  minutes: number;
  mbid: string | null;
  canonical: string | null;
  mb_state: 'due' | 'found' | 'none' | 'failed';
  mb_tries: number;
}

/** The most played artist still to resolve (by the index `listen_artists_due`), or null. */
export const mbDue = (db: Db) =>
  db.one<ArtistRow>(
    `SELECT * FROM listen_artists WHERE mb_state = 'due' AND plays >= ? ORDER BY plays DESC LIMIT 1`,
    L.mb_min_plays,
  );

/** A lookup's answer: found (its id and canonical name), none (MusicBrainz knows no such artist), or
 * an error, tried again until `mb_tries`. */
export function mbSet(db: Db, key: string, r: { mbid: string; name: string } | 'none' | 'error', at: number): number {
  if (r !== 'error' && r !== 'none') {
    const t = totals(db);
    putState(db, 'history.totals', { ...t, resolved: t.resolved + 1 });
  }
  if (r === 'error')
    return db.run(
      `UPDATE listen_artists SET mb_tries = mb_tries + 1, mb_state = CASE WHEN mb_tries + 1 >= ? THEN 'failed' ELSE 'due' END,
       mb_at = ? WHERE artist_key = ?`,
      L.mb_tries,
      at,
      key,
    );
  return db.run(
    'UPDATE listen_artists SET mb_state = ?, mbid = ?, canonical = ?, mb_at = ? WHERE artist_key = ?',
    r === 'none' ? 'none' : 'found',
    r === 'none' ? null : r.mbid,
    r === 'none' ? null : r.name,
    at,
    key,
  );
}

/** The top artists by plays (by the index `listen_artists_plays`). */
export const topArtists = (db: Db, limit: number) =>
  db.all<ArtistRow>('SELECT * FROM listen_artists ORDER BY plays DESC LIMIT ?', limit);

/** Every artist's key and plays: what find's history weight reads (once per start or change). */
export const allArtists = (db: Db) =>
  db.all<{ artist_key: string; plays: number }>('SELECT artist_key, plays FROM listen_artists');

/** Some artists' plays by their keys (the similar list's, by their canonical names). */
export function playsOf(db: Db, keys: string[]): Map<string, number> {
  const ks = [...new Set(keys)].slice(0, 100);
  if (!ks.length) return new Map();
  const rows = db.all<{ artist_key: string; plays: number }>(
    `SELECT artist_key, plays FROM listen_artists WHERE artist_key IN (${ks.map(() => '?').join(', ')})`,
    ...ks,
  );
  return new Map(rows.map((r) => [r.artist_key, r.plays]));
}

/** The totals (plays, minutes, artists, artists resolved) and plays by year, kept in one row as the
 * parts and the lookups go in, so no read counts the summary or the artists. */
export interface HistoryTotals {
  plays: number;
  minutes: number;
  artists: number;
  resolved: number;
  years: Record<number, number>;
}
export const totals = (db: Db): HistoryTotals => ({
  plays: 0,
  minutes: 0,
  artists: 0,
  resolved: 0,
  years: {},
  ...getState<Partial<HistoryTotals>>(db, 'history.totals'),
});

export const similarOf = (db: Db, mbid: string) =>
  db.one<{ items_json: string; fetched_at: number }>(
    'SELECT items_json, fetched_at FROM similar_artists WHERE mbid = ?',
    mbid,
  );

export function putSimilar(db: Db, mbid: string, items: unknown, at: number): number {
  return db.run(
    `INSERT INTO similar_artists (mbid, items_json, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT DO UPDATE SET items_json = excluded.items_json, fetched_at = excluded.fetched_at`,
    mbid,
    JSON.stringify(items),
    at,
  );
}
