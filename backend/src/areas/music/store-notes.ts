// SQL for what the mind knows of each song (Music schema step 4, DATA.md §6.2): the notes, one row a
// track; the owner's newest rating of each song (from the phone's `music.rate` senses); the packs
// find reads (the notes 500 to a row, and the listening pass's moods and energy); and the night's
// place in the catalog. Every request-path read is by key or by a key range: none reads the
// catalog or the notes whole, except a pack's rebuild (after a restore, or the listening pass's
// once a day).
import type { Db } from '../../objects/base';

export interface NoteRow {
  track_id: string;
  known: number;
  note_json: string;
  by: string;
  v: number;
  at: number;
  pack: number;
}
export interface TagRow {
  id: string;
  ord: number;
  record_json: string;
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
/** SQLite here binds at most 100 values a statement: key lists go in parts of this many. */
const PART = 100;
function inParts<T>(ids: string[], read: (part: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += PART) out.push(...read(ids.slice(i, i + PART)));
  return out;
}

/** Tracks by id (the `tracks` id index): those the catalog holds, with their tags' record. */
export function tracksByIds(db: Db, ids: string[]): TagRow[] {
  return inParts(ids, (p) =>
    db.all<TagRow>(`SELECT id, ord, record_json FROM tracks WHERE id IN (${marks(p.length)})`, ...p),
  );
}

/** Every track in catalog order: the word search's tags (once per start) and a pack's rebuild. */
export function allTags(db: Db): TagRow[] {
  return db.all('SELECT id, ord, record_json FROM tracks ORDER BY ord');
}

/** Notes by track id (the table's key). */
export function notesByIds(db: Db, ids: string[]): NoteRow[] {
  return inParts(ids, (p) =>
    db.all<NoteRow>(
      `SELECT track_id, known, note_json, by, v, at, pack FROM track_notes WHERE track_id IN (${marks(p.length)})`,
      ...p,
    ),
  );
}

/** Notes after a track id, in id order (a key range). */
export function notesAfter(db: Db, cursor: string, limit: number): NoteRow[] {
  return db.all(
    'SELECT track_id, known, note_json, by, v, at, pack FROM track_notes WHERE track_id > ? ORDER BY track_id LIMIT ?',
    cursor,
    limit,
  );
}

/** Every note (a pack's rebuild only). */
export function allNotes(db: Db): NoteRow[] {
  return db.all('SELECT track_id, known, note_json, by, v, at, pack FROM track_notes');
}

export const anyNote = (db: Db) => db.one('SELECT 1 AS x FROM track_notes LIMIT 1') !== null;

/** One note by its track: 1 row written, or none when it is the same as the one kept. */
export function putNote(db: Db, n: NoteRow): number {
  return db.run(
    `INSERT INTO track_notes (track_id, known, note_json, by, v, at, pack) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET known = excluded.known, note_json = excluded.note_json, by = excluded.by,
       v = excluded.v, at = excluded.at, pack = excluded.pack
     WHERE track_notes.known IS NOT excluded.known OR track_notes.note_json IS NOT excluded.note_json
       OR track_notes.v IS NOT excluded.v OR track_notes.pack IS NOT excluded.pack OR track_notes.by IS NOT excluded.by`,
    n.track_id,
    n.known,
    n.note_json,
    n.by,
    n.v,
    n.at,
    n.pack,
  );
}

/** The next songs without a current note after catalog place `after` (the catalog's own key, then
 * one note lookup a song): a note is current at version `v` or later, or when the owner corrected
 * it through the chat. */
export function untagged(db: Db, after: number, v: number, limit: number): TagRow[] {
  return db.all(
    `SELECT t.id, t.ord, t.record_json FROM tracks t
     WHERE t.ord > ? AND NOT EXISTS (
       SELECT 1 FROM track_notes n WHERE n.track_id = t.id AND (n.v >= ? OR n.by = 'mind:chat'))
     ORDER BY t.ord LIMIT ?`,
    after,
    v,
    limit,
  );
}

/** Where the night's untagged pages go on from (`music_state`): every song up to place `ord` has a
 * note current at version `v`. */
export function cursor(db: Db): { v: number; ord: number } | null {
  const r = db.one<{ value_json: string }>("SELECT value_json FROM music_state WHERE key = 'notes.cursor'");
  return r ? (JSON.parse(r.value_json) as { v: number; ord: number }) : null;
}

export function putCursor(db: Db, v: number, ord: number): void {
  db.run(
    "INSERT INTO music_state (key, value_json) VALUES ('notes.cursor', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
    JSON.stringify({ v, ord }),
  );
}

/** A song added at or below the night's place (a new track takes the catalog's last place, which a
 * deleted one may have held; an import keeps old places): the place moves to just before it, so the
 * song is offered. */
export function lowerCursor(db: Db, ord: number): void {
  db.run(
    `UPDATE music_state SET value_json = json_set(value_json, '$.ord', ?)
     WHERE key = 'notes.cursor' AND json_extract(value_json, '$.ord') >= ?`,
    ord - 1,
    ord,
  );
}

/** The same for the catalog's last place, as a new track takes it. */
export function lowerCursorToLast(db: Db): void {
  db.run(
    `UPDATE music_state SET value_json = json_set(value_json, '$.ord', (SELECT max(ord) FROM tracks) - 1)
     WHERE key = 'notes.cursor' AND json_extract(value_json, '$.ord') >= (SELECT max(ord) FROM tracks)`,
  );
}

export function dropCursor(db: Db): void {
  db.run("DELETE FROM music_state WHERE key = 'notes.cursor'");
}

/** Whether the notes changed under the packs: the triggers on `track_notes` leave this mark for any
 * write that isn't a batch's own (a table restore, a hand edit); a batch clears it as it ends. */
export const notesStale = (db: Db) => db.one("SELECT 1 AS x FROM music_state WHERE key = 'notes.stale'") !== null;

export function clearStale(db: Db): void {
  db.run("DELETE FROM music_state WHERE key = 'notes.stale'");
}

/** The catalog's last place (its key's end: one row). */
export const lastOrd = (db: Db) => db.one<{ m: number | null }>('SELECT max(ord) AS m FROM tracks')?.m ?? 0;

// --- ratings -------------------------------------------------------------------------------------

/** A song's rating as of `at`: the newest wins, so a late older one changes nothing. 1 row written
 * (2 for a rating of 1, which the partial index holds). */
export function putRating(db: Db, id: string, rating: number, at: number): number {
  return db.run(
    `INSERT INTO track_ratings (track_id, rating, at) VALUES (?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET rating = excluded.rating, at = excluded.at
     WHERE excluded.at > track_ratings.at OR (excluded.at = track_ratings.at AND excluded.rating IS NOT track_ratings.rating)`,
    id,
    rating,
    at,
  );
}

/** The songs whose newest rating is 1 (the partial index: those rows only). */
export function ratedOut(db: Db): string[] {
  return db.all<{ track_id: string }>('SELECT track_id FROM track_ratings WHERE rating = 1').map((r) => r.track_id);
}

// --- find's packs ----------------------------------------------------------------------------------

export function packs(db: Db, kind: string): { pack: number; entries_json: string }[] {
  return db.all('SELECT pack, entries_json FROM find_packs WHERE kind = ? ORDER BY pack', kind);
}

export function pack(db: Db, kind: string, n: number): string | null {
  return (
    db.one<{ entries_json: string }>('SELECT entries_json FROM find_packs WHERE kind = ? AND pack = ?', kind, n)
      ?.entries_json ?? null
  );
}

export function putPack(db: Db, kind: string, n: number, json: string, at: number): void {
  db.run(
    `INSERT INTO find_packs (kind, pack, entries_json, at) VALUES (?, ?, ?, ?)
     ON CONFLICT (kind, pack) DO UPDATE SET entries_json = excluded.entries_json, at = excluded.at`,
    kind,
    n,
    json,
    at,
  );
}

/** A kind's packs, all of them (before it is packed again). */
export function dropPacks(db: Db, kind: string): void {
  db.run('DELETE FROM find_packs WHERE kind = ?', kind);
}

// --- the listening pass (Music schema step 3, its own branch) -----------------------------------

/** The listening pass's table: the one place its shape is named. One row a track: `energy` 0–1,
 * `moods_json` {mood: score} over MUSIC_MOODS, `neighbours_json` [{id, score}] nearest first. */
export const LISTENING_TABLE = 'track_analysis';
export const hasListening = (db: Db) =>
  db.one("SELECT 1 AS x FROM sqlite_schema WHERE type = 'table' AND name = ?", LISTENING_TABLE) !== null;

/** Its rows: with `id`, that song's alone with its neighbours (by key); without, every song's
 * energy and moods (for packing, at most once a day). */
export function listeningRows(
  db: Db,
  id?: string,
): { track_id: string; energy: number | null; moods_json: string | null; neighbours_json: string | null }[] {
  return id === undefined
    ? db.all(`SELECT track_id, energy, moods_json, NULL AS neighbours_json FROM ${LISTENING_TABLE}`)
    : db.all(`SELECT track_id, energy, moods_json, neighbours_json FROM ${LISTENING_TABLE} WHERE track_id = ?`, id);
}
