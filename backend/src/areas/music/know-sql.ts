// Music schema step 7 (music.ts), expand only: what the Worker knows of the owner's music beyond their
// files, and the albums it suggests adding (MUSIC.md §19, DATA.md §6.2). In the Music object, beside
// the catalog and the listening history, because every read here is by a key those hold (an album's
// key from the catalog's tags, an artist's MusicBrainz id from `listen_artists`) and the job's writes
// land in one object, one transaction a step.
// - `know_albums`: one row per catalog album (artist key and album key from the catalog's tags; its
//   songs' ids, titles and track numbers, for matching them to a release's tracks), its
//   MusicBrainz release group once matched or why not (`state` due, matched or unmatched; the index
//   `know_albums_due` gives the most played artist's album still due in one row).
// - `know_songs`: a catalog song's MusicBrainz recording, where the album's track list makes it sure
//   (`how` tracklist) or Muse sent it (`how` muse).
// - `know_facts`: one row per artist (`a:<mbid>`) and release group (`g:<mbid>`): structured facts
//   (`facts_json`: ids, dates, types, counts, canonical names) apart from free text from elsewhere
//   (`outside_json`: Wikipedia's lead and reception, tags, styles), what filled each, the sources
//   still to ask (`todo`) and when it is fetched again; `know_facts_next` gives the next to work on.
// - `know_names`: canonical names (keyOf) to ids, so `th music facts <name>` reads by key.
// - `know_credits`: who worked on which release group (person, release group, role), by person.
// - `picks`: the albums to add, one row per release group, with the owner's answer (`state`).
// Everything fetched is outside information: names and text capped and their whitespace collapsed.

export const KNOW_SQL = [
  `CREATE TABLE know_albums (
    album_key TEXT PRIMARY KEY,
    artist_key TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    songs INTEGER NOT NULL,
    songs_json TEXT NOT NULL,
    year INTEGER NOT NULL,
    plays REAL NOT NULL,
    hint TEXT,
    artist_mbid TEXT,
    rg TEXT,
    state TEXT NOT NULL,
    reason TEXT,
    tries INTEGER NOT NULL,
    matched_songs INTEGER NOT NULL,
    seen INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX know_albums_due ON know_albums (state, plays)',
  'CREATE INDEX know_albums_artist ON know_albums (artist_key)',
  'CREATE INDEX know_albums_rg ON know_albums (rg)',
  'CREATE INDEX know_albums_mbid ON know_albums (artist_mbid, state)',
  `CREATE TABLE know_songs (
    track_id TEXT PRIMARY KEY,
    album_key TEXT NOT NULL,
    recording TEXT NOT NULL,
    how TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE know_facts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    prio REAL NOT NULL,
    facts_json TEXT NOT NULL,
    outside_json TEXT NOT NULL,
    filled_json TEXT NOT NULL,
    todo TEXT NOT NULL,
    work_json TEXT NOT NULL,
    busy INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX know_facts_next ON know_facts (busy, prio)',
  'CREATE INDEX know_facts_due ON know_facts (busy, due_at)',
  'CREATE INDEX know_facts_kind ON know_facts (kind, prio)',
  `CREATE TABLE know_names (
    key TEXT NOT NULL,
    id TEXT NOT NULL,
    PRIMARY KEY (key, id)
  ) WITHOUT ROWID`,
  `CREATE TABLE know_credits (
    person TEXT NOT NULL,
    rg TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (person, rg, role)
  ) WITHOUT ROWID`,
  'CREATE INDEX know_credits_rg ON know_credits (rg)',
  `CREATE TABLE picks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    artist_mbid TEXT NOT NULL,
    body_json TEXT NOT NULL,
    score REAL NOT NULL,
    state TEXT NOT NULL,
    why TEXT,
    played INTEGER NOT NULL,
    made_at INTEGER NOT NULL,
    state_at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  'CREATE INDEX picks_state ON picks (state, score)',
];

/** In the weekly backup and the export (DATA.md §10): the matches and the owner's answers to picks.
 * The facts, names and credits are fetched again, so they stay out, like `similar_artists`. */
export const KNOW_TABLES = ['know_albums', 'know_songs', 'picks'] as const;
