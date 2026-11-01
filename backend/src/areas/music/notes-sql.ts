// Music schema step 4 (music.ts), expand only: what the mind knows of each song (MUSIC.md §10.5;
// DATA.md §6.2). Its note, one row a track (`pack`: the find pack it is in); the owner's newest rating
// of each song, kept for good; and find's packs (derived:
// the notes 500 to a row, and the listening pass's measurements). SQL on them is store-notes.ts.

export const NOTES_SQL = [
  `CREATE TABLE track_notes (
    track_id TEXT PRIMARY KEY,
    known INTEGER NOT NULL,
    note_json TEXT NOT NULL,
    by TEXT NOT NULL,
    v INTEGER NOT NULL,
    at INTEGER NOT NULL,
    pack INTEGER NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE track_ratings (
    track_id TEXT PRIMARY KEY,
    rating INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX track_ratings_out ON track_ratings (track_id) WHERE rating = 1',
  // Any write to the notes that isn't a batch's own (a table restore, a hand edit) leaves a mark,
  // so find's packs are built again and the night's place starts over (music-packs.ts). A batch
  // clears the mark as it ends; only the first row of a write costs a row written. (Not INSERT OR
  // IGNORE: an upsert's own conflict clause would override it inside the trigger.)
  ...['INSERT', 'UPDATE', 'DELETE'].map(
    (e) =>
      `CREATE TRIGGER track_notes_${e.toLowerCase()} AFTER ${e} ON track_notes BEGIN
        INSERT INTO music_state (key, value_json) SELECT 'notes.stale', '1'
          WHERE NOT EXISTS (SELECT 1 FROM music_state WHERE key = 'notes.stale');
      END`,
  ),
  `CREATE TABLE find_packs (
    kind TEXT NOT NULL,
    pack INTEGER NOT NULL,
    entries_json TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (kind, pack)
  ) WITHOUT ROWID`,
];

/** The step's tables in the weekly backup and the export (DATA.md §10); the derived `find_packs`
 * stays out. */
export const NOTES_TABLES = ['track_notes', 'track_ratings'] as const;
