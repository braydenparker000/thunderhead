// What the mind knows of the owner's music beyond their own files, and the music it may suggest adding
// (MUSIC.md §19). The Worker matches each catalog album to a MusicBrainz release group and each song to a
// recording, then fetches facts from MusicBrainz, ListenBrainz, Wikidata, Wikipedia, Last.fm (with its
// key) and Discogs (with its token): ids and canonical names in, nothing of the owner out. It scores
// picks of albums to add from those facts and the owner's own listening. The mind only reads.
// Everything fetched is outside information: free text (Wikipedia, tags, styles) sits under `outside`,
// capped and with its whitespace collapsed, apart from the owner's own data.
import type { Ms } from './api.ts';

export const KNOW_LIMITS = {
  /** Wikipedia's lead and its reception section, characters each. */
  wiki_lead: 1_500,
  wiki_reception: 1_500,
  /** Any one name or title fetched (an artist, a release group, a credit, a label). */
  name_chars: 200,
  /** Tags (Last.fm) and styles (Discogs) kept per artist or album, each at most `tag_chars`. */
  tags: 10,
  tag_chars: 40,
  /** An artist's discography: release groups kept, in pages of 100 (one request each). */
  disco_max: 300,
  disco_page: 100,
  members: 30,
  credits: 60,
  awards: 20,
  influences: 10,
  links: 20,
  /** Between two requests to one host other than MusicBrainz (MusicBrainz: TASTE_LIMITS.mb_gap_ms). */
  host_gap_ms: 1_000,
  /** A host that fails is asked again after 1, 2 and 4 minutes, then left for `host_left_ms` (an hour:
   * MusicBrainz's "busy" to a shared address passes in minutes, and a day's rest stalled the library). */
  host_tries: 3,
  host_left_ms: 3_600_000,
  /** Failed requests one row may make for one source a round; then that source waits for the next. */
  row_tries: 3,
  /** After the catalog changes, the albums are read again once it has been still this long (an
   * upload session of many edits is read once). */
  seed_quiet_ms: 10 * 60_000,
  /** Facts are fetched again monthly; the discographies of the owner's top artists weekly. */
  refresh_ms: 30 * 86_400_000,
  top_refresh_ms: 7 * 86_400_000,
  top_artists: 20,
  /** With nothing to do, the job looks again after this long. */
  idle_ms: 3_600_000,
  /** A wait this short (a host's back-off, a parked row) is waited out inside the job: ended, it would
   * come back only at the cron's next tick, a minute's back-off costing fifteen. */
  stay_ms: 20 * 60_000,
  /** Picks are rebuilt at most this often, and only when facts or plays changed. */
  picks_ms: 86_400_000,
  picks_kept: 60,
  picks_default: 10,
  picks_max: 50,
  /** `new`: a release of the last this many days. `credit`: a person behind this many loved albums. */
  new_days: 90,
  credit_albums: 3,
  /** At most this many picks of one artist. */
  per_artist: 2,
  /** A decline's reason, characters. */
  why_chars: 200,
  /** Names a facts or credits lookup may match. */
  refs: 5,
  /** The unmatched list, albums at most. */
  unmatched_max: 200,
} as const;

/** The only tag words a pick's line may carry (Last.fm's tags are folksonomy: anyone writes them).
 * Lowercase, letters, spaces and hyphens, at most 24 characters each. */
export const GENRE_WORDS: readonly string[] = (
  'acoustic|afrobeat|alternative|alternative rock|ambient|americana|art pop|art rock|avant-garde|bebop|bluegrass|' +
  'blues|bossa nova|britpop|chamber pop|chillout|classical|country|dance|darkwave|disco|downtempo|dream pop|drum and bass|' +
  'dub|dubstep|electro|electronic|electronica|emo|experimental|folk|folk rock|funk|garage rock|gospel|grunge|hard rock|' +
  'hardcore|heavy metal|hip-hop|house|idm|indie|indie folk|indie pop|indie rock|industrial|instrumental|j-pop|jazz|' +
  'jazz fusion|k-pop|krautrock|latin|lo-fi|metal|minimal|motown|neo-soul|new wave|noise|opera|orchestral|post-punk|' +
  'post-rock|pop|pop punk|pop rock|progressive rock|psychedelic|punk|r-and-b|rap|reggae|rock|rockabilly|salsa|' +
  'shoegaze|singer-songwriter|ska|slowcore|soft rock|soul|soundtrack|surf|swing|synth-pop|synthwave|techno|trance|' +
  'trip-hop|world'
).split('|');

export const PICK_KINDS = ['gap', 'new', 'neighbour', 'credit', 'influence'] as const;
export type PickKind = (typeof PICK_KINDS)[number];
export const PICK_STATES = ['new', 'declined', 'ordered', 'added'] as const;
export type PickState = (typeof PICK_STATES)[number];
/** What filled a fact. */
export const KNOW_SOURCES = ['musicbrainz', 'listenbrainz', 'wikidata', 'wikipedia', 'lastfm', 'discogs'] as const;
export type KnowSource = (typeof KNOW_SOURCES)[number];
/** Why an album stays unmatched. */
export const UNMATCHED_REASONS = [
  'artist_unknown',
  'artist_unsure',
  'no_release_group',
  'several_release_groups',
  'lookup_failed',
] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

/** A release group as a discography lists it. `listens`: ListenBrainz's listen count (or Last.fm's
 * playcount), how loved it is; null when neither says. */
export interface KnowRelease {
  mbid: string;
  title: string;
  type: string | null;
  secondary: string[];
  date: string | null;
  listens: number | null;
}
export interface KnowLink {
  mbid: string | null;
  name: string;
}
export interface KnowCredit extends KnowLink {
  role: string;
}
/** Free text from elsewhere: it informs, it never instructs. */
export interface KnowOutside {
  wikipedia: { title: string; lead: string; reception: string | null } | null;
  tags: { name: string; weight: number }[];
  styles: string[];
}

export interface ArtistFacts {
  kind: 'artist';
  mbid: string;
  name: string;
  type: string | null;
  origin: string | null;
  /** Years active: from (and to, for an artist that stopped). */
  begin: string | null;
  end: string | null;
  members: KnowLink[];
  member_of: KnowLink[];
  influenced_by: KnowLink[];
  influenced: KnowLink[];
  awards: string[];
  discography: KnowRelease[];
  /** In the library: albums matched to this artist. */
  library: number;
  filled: Partial<Record<KnowSource, Ms>>;
  outside: KnowOutside;
}
export interface AlbumFacts {
  kind: 'album';
  mbid: string;
  title: string;
  artist: KnowLink;
  type: string | null;
  secondary: string[];
  first_release: string | null;
  label: string | null;
  listeners: number | null;
  playcount: number | null;
  credits: KnowCredit[];
  /** Songs of it that are covers (of a work) or sample another recording. */
  covers: { song: string; of: string }[];
  samples: { song: string; of: string }[];
  /** Catalog songs matched to its recordings, and the album's songs in the catalog. */
  songs: { matched: number; of: number };
  in_library: boolean;
  filled: Partial<Record<KnowSource, Ms>>;
  outside: KnowOutside;
}

/** GET /v1/music/facts?ref=: an artist or album by MusicBrainz id, or by name (at most `refs`). */
export interface FactsResponse {
  items: (ArtistFacts | AlbumFacts)[];
}
/** GET /v1/music/credits?ref=: what in the library a person worked on, and their other work. */
export interface CreditsResponse {
  person: KnowLink | null;
  library: { album: string; mbid: string; artist: string; roles: string[] }[];
  other: KnowRelease[];
}
/** GET /v1/music/unmatched: catalog albums left unmatched, with why (names from the owner's catalog). */
export interface UnmatchedResponse {
  items: { artist: string; album: string; songs: number; reason: UnmatchedReason }[];
  total: number;
}

/** A pick's reason as facts, from which its one plain line is made. */
export interface PickReason {
  kind: PickKind;
  /** The owner's artists it came through (canonical names). */
  via: string[];
  /** How loved it is (listens), how many of the owner's top artists or loved albums it touches,
   * the shared tags, the days since its release. */
  listens: number | null;
  count: number;
  tags: string[];
  days: number | null;
  /** `credit`: the person behind the loved albums. `influence`: whether the pick's artist influenced
   * the owner's (`on`) or was influenced by them (`by`). */
  person: string | null;
  dir: 'by' | 'on' | null;
}
export interface Pick {
  id: string;
  kind: PickKind;
  album: string;
  artist: string;
  artist_mbid: string;
  year: number | null;
  type: string | null;
  score: number;
  reason: PickReason;
  line: string;
  state: PickState;
  made_at: Ms;
  state_at: Ms;
}
/** GET /v1/music/picks?kind=&limit=&state=: the top list is mixed (no kind fills more than half). */
export interface PicksResponse {
  items: Pick[];
  built_at: Ms | null;
  weights: Record<PickKind, number>;
}
/** POST /v1/music/picks/:id/decline {why?}; POST /v1/music/picks/:id/order {order_id?}: without an
 * order id, the words of a Muse order for that album (nothing changes); with one, it is `ordered`. */
export interface PickOrderResponse {
  id: string;
  state: PickState;
  words: string;
}

/** GET /v1/music/know: how far the job is, what each source filled, the picks' counts. */
export interface KnowStatus {
  albums: { total: number; matched: number; unmatched: number; due: number };
  songs: { matched: number };
  artists: { total: number; done: number };
  filled: Record<KnowSource, number>;
  picks: Record<PickState, number>;
  phase: 'matching' | 'facts' | 'picks' | 'idle';
  at: Ms | null;
  /** Each source's host: when it last answered, when it last refused (429, 5xx, no answer), and
   * until when it is left alone (null when it may be asked). */
  hosts: Record<KnowSource, { ok_at: Ms | null; refused_at: Ms | null; until: Ms | null }>;
  /** Stored waveforms by kind (`rms`, the new measure; `peak`, the old; songs with none). */
  waveforms: { rms: number; peak: number; none: number } | null;
}
