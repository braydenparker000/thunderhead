// SQL for the music knowledge (know-sql.ts, MUSIC.md §19): the catalog's albums and their matches, the
// facts rows the job works through, names and credits by key, and the job's own record in
// `music_state` (`know.hosts`: each host's failures and when it may be asked again; `know.state`: the
// catalog version last seeded, when facts were refreshed, when picks were built). Every request-path
// read is by key or by an index's first rows.
import type { Db } from '../../objects/base';
import { inParts, marks } from './store-notes';

export interface AlbumRow {
  album_key: string;
  artist_key: string;
  artist: string;
  album: string;
  songs: number;
  songs_json: string;
  year: number;
  plays: number;
  hint: string | null;
  artist_mbid: string | null;
  rg: string | null;
  state: 'due' | 'matched' | 'unmatched';
  reason: string | null;
  tries: number;
  matched_songs: number;
  seen: number;
  at: number;
}
export interface FactsRow {
  id: string;
  kind: 'artist' | 'lite' | 'person' | 'album';
  name: string;
  prio: number;
  facts_json: string;
  outside_json: string;
  filled_json: string;
  todo: string;
  work_json: string;
  busy: number;
  due_at: number;
  at: number;
}

/** A catalog album as the seed sees it; a row only changes when what it holds changes. */
export function putAlbum(
  db: Db,
  a: Omit<AlbumRow, 'artist_mbid' | 'rg' | 'state' | 'reason' | 'tries' | 'matched_songs'>,
) {
  return db.run(
    `INSERT INTO know_albums (album_key, artist_key, artist, album, songs, songs_json, year, plays, hint, state, tries,
       matched_songs, seen, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'due', 0, 0, ?, ?)
     ON CONFLICT (album_key) DO UPDATE SET songs = excluded.songs, songs_json = excluded.songs_json, year = excluded.year,
       plays = excluded.plays, hint = excluded.hint,
       state = CASE WHEN know_albums.songs_json <> excluded.songs_json OR know_albums.hint IS NOT excluded.hint
         THEN 'due' ELSE know_albums.state END
     WHERE know_albums.songs_json <> excluded.songs_json OR know_albums.year <> excluded.year
       OR know_albums.plays <> excluded.plays OR know_albums.hint IS NOT excluded.hint`,
    a.album_key,
    a.artist_key,
    a.artist,
    a.album,
    a.songs,
    a.songs_json,
    a.year,
    a.plays,
    a.hint,
    a.seen,
    a.at,
  );
}

/** Albums no longer in the catalog go, with their songs (the keys read once; only the gone deleted). */
export function dropGone(db: Db, keep: Set<string>): number {
  let n = 0;
  for (const g of db.all<{ album_key: string }>('SELECT album_key FROM know_albums'))
    if (!keep.has(g.album_key))
      n +=
        db.run('DELETE FROM know_songs WHERE album_key = ?', g.album_key) +
        db.run('DELETE FROM know_albums WHERE album_key = ?', g.album_key);
  return n;
}

/** The most played artist's album still due (the index `know_albums_due`), or null. */
export const nextDue = (db: Db) =>
  db.one<AlbumRow>(`SELECT * FROM know_albums WHERE state = 'due' ORDER BY plays DESC LIMIT 1`);
export const albumsOfArtist = (db: Db, key: string) =>
  db.all<AlbumRow>('SELECT * FROM know_albums WHERE artist_key = ?', key);
export const albumsOfGroup = (db: Db, rg: string) => db.all<AlbumRow>('SELECT * FROM know_albums WHERE rg = ?', rg);

export function setArtist(db: Db, key: string, mbid: string | null, reason: string | null, at: number): number {
  if (mbid)
    return db.run(
      `UPDATE know_albums SET artist_mbid = ?1, at = ?2 WHERE artist_key = ?3 AND state = 'due' AND artist_mbid IS NOT ?1`,
      mbid,
      at,
      key,
    );
  // An album Muse named the release group of is still matched by it, without its artist's facts.
  return db.run(
    `UPDATE know_albums SET state = CASE WHEN hint IS NULL THEN 'unmatched' ELSE state END,
       reason = CASE WHEN hint IS NULL THEN ? ELSE reason END, tries = 99, at = ? WHERE artist_key = ? AND state = 'due'`,
    reason,
    at,
    key,
  );
}

/** An artist's discography fully read again: its albums left unmatched for want of it (or judged by
 * an older one) are matched again. */
export const rematch = (db: Db, mbid: string) =>
  db.run(
    `UPDATE know_albums SET state = 'due' WHERE artist_mbid = ? AND state = 'unmatched'
       AND reason IN ('no_release_group', 'several_release_groups', 'lookup_failed')`,
    mbid,
  );
/** An artist's discography could not be read this round: its albums wait, unmatched, for the next. */
export const discoFailed = (db: Db, mbid: string, at: number) =>
  db.run(
    `UPDATE know_albums SET state = 'unmatched', reason = 'lookup_failed', at = ? WHERE artist_mbid = ? AND state = 'due'
       AND hint IS NULL`,
    at,
    mbid,
  );

export function setMatch(db: Db, key: string, m: { rg: string } | { reason: string }, at: number): number {
  return 'rg' in m
    ? db.run(
        `UPDATE know_albums SET state = 'matched', rg = ?, reason = NULL, at = ? WHERE album_key = ?`,
        m.rg,
        at,
        key,
      )
    : db.run(
        `UPDATE know_albums SET state = 'unmatched', rg = NULL, reason = ?, at = ? WHERE album_key = ?`,
        m.reason,
        at,
        key,
      );
}
export const bumpTries = (db: Db, key: string) =>
  db.run('UPDATE know_albums SET tries = tries + 1 WHERE artist_key = ?', key);

export function putSongs(db: Db, albumKey: string, songs: { id: string; recording: string; how: string }[]): number {
  let n = 0;
  for (const s of songs)
    n += db.run(
      `INSERT INTO know_songs (track_id, album_key, recording, how) VALUES (?, ?, ?, ?)
       ON CONFLICT (track_id) DO UPDATE SET album_key = excluded.album_key, recording = excluded.recording, how = excluded.how
       WHERE know_songs.recording <> excluded.recording OR know_songs.how <> excluded.how`,
      s.id,
      albumKey,
      s.recording,
      s.how,
    );
  n += db.run(
    'UPDATE know_albums SET matched_songs = ? WHERE album_key = ? AND matched_songs <> ?',
    songs.length,
    albumKey,
    songs.length,
  );
  return n;
}

// --- facts rows -------------------------------------------------------------------------------------

export const factsOf = (db: Db, id: string) => db.one<FactsRow>('SELECT * FROM know_facts WHERE id = ?', id);
export const factsByIds = (db: Db, ids: string[]) =>
  inParts([...new Set(ids)], (p) =>
    db.all<FactsRow>(`SELECT * FROM know_facts WHERE id IN (${marks(p.length)})`, ...p),
  );
/** The next row with work (the index `know_facts_next`): the highest priority first. */
export const nextFacts = (db: Db) =>
  db.one<FactsRow>('SELECT * FROM know_facts WHERE busy = 1 ORDER BY prio DESC LIMIT 1');

/** A row to work on: a new one, or one already there raised to this priority and kind (an artist
 * outranks a lighter row of the same id). Its sources are asked from the first. */
export function ensureFacts(
  db: Db,
  id: string,
  kind: FactsRow['kind'],
  name: string,
  prio: number,
  todo: string,
  at: number,
) {
  return db.run(
    `INSERT INTO know_facts (id, kind, name, prio, facts_json, outside_json, filled_json, todo, work_json, busy, due_at, at)
     VALUES (?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', 1, 0, ?)
     ON CONFLICT (id) DO UPDATE SET prio = max(know_facts.prio, excluded.prio),
       kind = CASE WHEN excluded.kind IN ('artist', 'album') THEN excluded.kind ELSE know_facts.kind END,
       todo = CASE WHEN excluded.kind = 'artist' AND know_facts.kind <> 'artist' THEN excluded.todo ELSE know_facts.todo END,
       busy = CASE WHEN excluded.kind = 'artist' AND know_facts.kind <> 'artist' THEN 1 ELSE know_facts.busy END
     WHERE excluded.prio > know_facts.prio OR (excluded.kind = 'artist' AND know_facts.kind <> 'artist')`,
    id,
    kind,
    name,
    prio,
    todo,
    at,
  );
}

/** A row saved: its content, and its place in the work (`busy`, `due_at`, both indexed) only when
 * that changed, so a step writes one row, not its index entries too. */
export function saveFacts(db: Db, before: FactsRow, r: FactsRow): number {
  let n = db.run(
    `UPDATE know_facts SET name = ?, facts_json = ?, outside_json = ?, filled_json = ?, todo = ?, work_json = ?, at = ?
     WHERE id = ?`,
    r.name,
    r.facts_json,
    r.outside_json,
    r.filled_json,
    r.todo,
    r.work_json,
    r.at,
    r.id,
  );
  if (r.busy !== before.busy || r.due_at !== before.due_at)
    n += db.run('UPDATE know_facts SET busy = ?, due_at = ? WHERE id = ?', r.busy, r.due_at, r.id);
  return n;
}

/** Rows whose month is up start again from their first source (the index `know_facts_due`). */
export function refreshDue(db: Db, now: number, todo: (kind: string) => string): number {
  const due = db.all<{ id: string; kind: string; todo: string }>(
    'SELECT id, kind, todo FROM know_facts WHERE busy = 0 AND due_at <= ?',
    now,
  );
  let n = 0;
  // A row parked while its hosts refused keeps what it still had to ask; a finished one starts over.
  for (const r of due)
    n += db.run('UPDATE know_facts SET busy = 1, todo = ? WHERE id = ?', r.todo || todo(r.kind), r.id);
  return n;
}

/** The top artists' discographies asked again (new releases), weekly. */
export function refreshTop(db: Db, limit: number, before: number): number {
  const top = db.all<{ id: string; todo: string; at: number | null }>(
    `SELECT id, todo, json_extract(work_json, '$.disco_at') AS at FROM know_facts WHERE kind = 'artist'
     ORDER BY prio DESC LIMIT ?`,
    limit,
  );
  let n = 0;
  // Only a discography last read (or given up) before `before`: a round is never asked twice in a week.
  for (const r of top)
    if (!r.todo.split(',').includes('disco') && (r.at ?? 0) <= before)
      n += db.run(
        `UPDATE know_facts SET busy = 1, todo = ? WHERE id = ?`,
        ['disco', 'lbtop', r.todo].filter(Boolean).join(','),
        r.id,
      );
  return n;
}

export function putName(db: Db, key: string, id: string): number {
  return key ? db.run('INSERT INTO know_names (key, id) VALUES (?, ?) ON CONFLICT DO NOTHING', key, id) : 0;
}
export const idsByName = (db: Db, key: string, limit: number) =>
  db.all<{ id: string }>('SELECT id FROM know_names WHERE key = ? LIMIT ?', key, limit).map((r) => r.id);

/** A release group's credits, replaced whole. */
export function putCredits(db: Db, rg: string, credits: { person: string; role: string; name: string }[]): number {
  let n = db.run('DELETE FROM know_credits WHERE rg = ?', rg);
  for (const c of credits)
    n += db.run(
      'INSERT INTO know_credits (person, rg, role, name) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      c.person,
      rg,
      c.role,
      c.name,
    );
  return n;
}
export const creditsOfPerson = (db: Db, person: string) =>
  db.all<{ rg: string; role: string; name: string }>(
    'SELECT rg, role, name FROM know_credits WHERE person = ? LIMIT 200',
    person,
  );
export const creditsOfGroups = (db: Db, rgs: string[]) =>
  inParts(rgs, (p) =>
    db.all<{ person: string; rg: string; role: string; name: string }>(
      `SELECT person, rg, role, name FROM know_credits WHERE rg IN (${marks(p.length)})`,
      ...p,
    ),
  );

// The job's own record (`know.state`, `know.hosts`) is know-state.ts.
export * from './know-state';
