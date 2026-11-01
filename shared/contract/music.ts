// Music's data on the new Worker (MUSIC.md §1.3, §6.1; API.md §11.15, §11.21): the catalog in the
// ported player's own format (`r2-library`, the old published file's shape, with no waveforms),
// one track's waveform, and signed links to its audio and art. P5's data move; the player's own
// tables come with its later steps. Then what the mind knows of each song (its notes) and the
// question it asks of them: songs by feeling.
import type { Ms } from './api';

export const MUSIC_LIMITS = {
  /** Refs in one POST /v1/media/sign. */
  sign_refs: 50,
  /** Seconds a signed link lives after the hour it was signed in. */
  sign_ttl_s: 3 * 60 * 60,
} as const;

/** GET /v1/music/catalog (`ETag`; `If-None-Match` answers 304). Each track is its record as the
 * old catalog kept it (id, sha256, size, audioKey, mimeType, path, r2Identity, coverKey…,
 * metadata), with `waveformBars: true` when GET /v1/music/waveforms/:id has one. */
export interface MusicCatalog {
  version: 1;
  kind: 'r2-library';
  complete: true;
  count: number;
  generatedAt: string;
  tracks: (Record<string, unknown> & { id: string; waveformBars?: true })[];
}

/** One track as the mind sees it (GET /v1/music/tracks?q=&limit=&untagged=1): its tags, for picking
 * songs; with `untagged=1`, only songs with no note of the current version (the night's next page). */
export interface MusicTrackRow {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  composer: string;
  year: number;
  /** Seconds. */
  dur: number;
}
export interface MusicTracksResponse {
  items: MusicTrackRow[];
  /** Every track the words match, though only `limit` come back. With `untagged=1` it counts this
   * page only (counting them all would read the whole catalog); `more` says whether more follow. */
  total: number;
  more?: boolean;
}

// --- What the mind knows of each song (MUSIC.md §10.5; Music schema step 4, `track_notes`) ------
// The night reads a page of the catalog's tags and writes a note per song from what it knows; the
// listening pass (step 3) measures the audio and scores the SAME moods, so the two can be blended.

/** The moods both passes use, one fixed list. */
export const MUSIC_MOODS = [
  'calm',
  'peaceful',
  'melancholy',
  'sad',
  'hopeful',
  'joyful',
  'romantic',
  'nostalgic',
  'dark',
  'tense',
  'energetic',
  'triumphant',
  'playful',
  'dreamy',
  'reverent',
  'focused',
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

/** When a song fits. */
export const MUSIC_OCCASIONS = [
  'focus',
  'wind-down',
  'morning',
  'workout',
  'drive',
  'study',
  'worship',
  'party',
  'rainy-day',
  'sunday',
  'sleep',
] as const;
export type MusicOccasion = (typeof MUSIC_OCCASIONS)[number];

/** What a song's words are about (none for a song without words). */
export const MUSIC_THEMES = [
  'love',
  'heartbreak',
  'longing',
  'faith',
  'gratitude',
  'family',
  'friendship',
  'home',
  'loss',
  'freedom',
  'journey',
  'nature',
  'night',
  'celebration',
  'struggle',
  'growing-up',
] as const;
export type MusicTheme = (typeof MUSIC_THEMES)[number];

/** ISO 639-1: a note's `language` is one of these two-letter codes. */
export const ISO_639_1: readonly string[] = (
  'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el ' +
  'en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ' +
  'ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na ' +
  'nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so ' +
  'sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
).split(' ');

/** The note format's version: a page of untagged songs also holds songs whose note is older. */
export const MUSIC_NOTE_VERSION = 1;

export const MUSIC_NOTE_LIMITS = {
  /** Notes in one PUT /v1/music/notes, ids in one GET, tracks in one untagged page. */
  batch: 200,
  /** Moods, occasions and themes a note may name. */
  moods: 5,
  occasions: 4,
  themes: 3,
  /** Every confidence is in [conf_min, 1]; a song the mind doesn't know (`known: false`) says only
   * what its tags imply, so none of its confidences may pass `unknown_conf_max`. */
  conf_min: 0.05,
  unknown_conf_max: 0.5,
  /** A note's era is a decade from this one to the present one. */
  era_min: 1000,
  /** The night's budget (night step 11, RUNTIME.md §12.1): at most this many songs a night, in
   * pages of `batch`, within the step's minutes. */
  night_songs: 400,
  /** Find reads the notes packed this many to a row (`find_packs`), so a cold find reads tens of
   * rows, not one a song; the listening pass's moods and energy are packed again after `pack_ms`. */
  pack_size: 500,
  pack_ms: 24 * 60 * 60 * 1000,
  /** GET /v1/music/find: results, by default and at most; moods asked at once. */
  find_default: 30,
  find_max: 100,
  find_moods: 4,
  /** A skip before this many ms counts against a song in `find` for `skip_days` days; this many
   * such skips leave it out (MUSIC.md §4.2's rule for mixes). */
  early_skip_ms: 30_000,
  skip_days: 30,
  skip_exclude: 3,
} as const;

/** "Never play this again" said to the mind in other words (MUSIC.md §10.5): a rule fact from the
 * owner's own words (MEMORY.md §6 M4) under this subject, its text naming the song as `music:<id>`
 * and nothing else of it (no title: a title in a shell argument could break out of its quotes).
 * Find leaves every song named in a current one out, and so do the mixes built from it. */
export const MUSIC_NEVER_SUBJECT = 'music.never';
/** The songs a rule's text names. */
export const MUSIC_REF_IN_TEXT = /\bmusic:(r2_[A-Za-z0-9_-]{10,200})/g;

/** One note, as the mind writes it (PUT /v1/music/notes). Each mood and occasion carries its own
 * confidence; `conf` has one for each other thing said (and none for a field left empty). */
export interface MusicNote {
  id: string;
  /** The mind knows this song itself, not only its tags. */
  known: boolean;
  moods: Partial<Record<MusicMood, number>>;
  occasions: Partial<Record<MusicOccasion, number>>;
  themes: MusicTheme[];
  /** ISO 639-1, or null: no words, or not known. */
  language: string | null;
  /** The decade it comes from (1990), or null. */
  era: number | null;
  /** 0 (still) to 1 (driving), or null. */
  energy: number | null;
  conf: Partial<Record<'themes' | 'language' | 'era' | 'energy', number>>;
}
/** A note as kept: who wrote it (`mind:night`, `mind:chat`), in which format, when. */
export interface MusicNoteRow extends MusicNote {
  by: string;
  v: number;
  at: Ms;
}
export interface MusicNotesRequest {
  items: MusicNote[];
}
/** Notes that changed a row, notes the same as the one kept (no row written), and notes the night
 * sent for a song whose note the owner corrected through the chat (`by: mind:chat`), which stands. */
export interface MusicNotesWritten {
  written: number;
  unchanged: number;
  kept: number;
}
/** GET /v1/music/notes?ids= (each track asked for, its note or null; ids not in the catalog are
 * `missing`) or ?cursor=&limit= (the notes in track id order, a page at a time). */
export interface MusicNotesResponse {
  items: (MusicTrackRow & { note: MusicNoteRow | null })[];
  missing: string[];
  next: string | null;
}

/** GET /v1/music/find: songs by feeling (`moods`, `occasion`, `energy`) or like another (`like`),
 * from the notes and, where the listening pass has measured them, the audio. Left out: songs the
 * owner told the mind never to play again (`never`, rule facts), songs whose newest rating is 1
 * (`rated`: kept in `track_ratings` from the phone's `music.rate` senses: its "not for me", which
 * "never play this again" said to the phone sets) and songs skipped early `skip_exclude` times in
 * `skip_days` (`skipped`). */
export interface MusicFindItem extends MusicTrackRow {
  score: number;
  known: boolean | null;
  /** What the score is made of: the asked moods' and occasion's confidences, the energy used, the
   * closeness to `like`, and the early skips that cost it. */
  why: { moods?: Partial<Record<MusicMood, number>>; occasion?: number; energy?: number; like?: number; skips?: number };
}
export interface MusicFindResponse {
  items: MusicFindItem[];
  /** Songs that matched, before `limit`. */
  total: number;
  /** Whether the listening pass's data (step 3) was there to use. */
  analysis: boolean;
  left_out: { never: number; rated: number; skipped: number };
}

/** GET /v1/music/waveforms/:id: base64 of one byte a bar (16–1000 bars). */
export interface MusicWaveform {
  id: string;
  bars: string;
}

/** POST /v1/media/sign. `music:<id>` is the track's audio, `music:<id>#art` its cover. */
export interface MediaSignRequest {
  refs: string[];
}
export interface MediaSignResponse {
  items: { ref: string; url: string; expires_at: Ms }[];
  errors: { ref: string; code: 'not_found' | 'not_signable' }[];
}
