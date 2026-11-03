// Music's verbs (verbs.ts; MUSIC.md §10.2): the playlists home makes on a phone, the queue, a mix
// and the ratings, which live in the player (intents Music applies when it opens), and the owner's
// "never play this again" and the mixes, which the Worker keeps.
import * as z from 'zod/mini';
import { MUSIC_MOODS, MUSIC_NOTE_LIMITS, MUSIC_OCCASIONS } from './music.ts';
import { ownerWords, SONG_ID, SONG_REF, song, songs, UUID7, type VerbSpec } from './verb-spec.ts';

const LIST_ID = /^[a-z0-9]{6,24}$/;
/** What GET /v1/music/find takes, as an object: songs by feeling, or like one. */
const findSpec = z.strictObject({
  moods: z.optional(z.array(z.enum(MUSIC_MOODS)).check(z.minLength(1), z.maxLength(MUSIC_NOTE_LIMITS.find_moods))),
  occasion: z.optional(z.enum(MUSIC_OCCASIONS)),
  energy: z.optional(z.enum(['low', 'mid', 'high'])),
  like: z.optional(z.string().check(z.regex(SONG_ID))),
  limit: z.optional(z.number().check(z.int(), z.gte(1), z.lte(MUSIC_NOTE_LIMITS.find_max))),
});
/** Songs a phone-side play takes at most (a queue restored by an undo is cut to this many). */
export const PLAY_MAX = 500;

export const MUSIC_VERBS = {
  'music.create_playlist': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({
          name: z.string().check(z.minLength(1), z.maxLength(60)),
          refs: z.array(z.string().check(z.regex(SONG_REF))).check(z.minLength(1), z.maxLength(500)),
        }),
        result: z.object({ list_id: z.string().check(z.regex(LIST_ID)), tracks: z.number() }),
      },
    },
    what: 'make a playlist in the player',
    doc: "Makes a playlist in the Music player from tracks (`music:<id>`), on this phone. Open it with a reply chip to `/music/#pl=<list_id>`. Its undo removes it while the owner hasn't changed it.",
  },
  'music.delete_playlist': {
    app: 'music',
    class: 'reversible',
    // Only the undo of a playlist the Thunderhead made, so no floor: deleting the owner's own
    // playlists is no verb (it would be `floor: 'delete'`).
    permit: 'music',
    side: 'phone',
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ list_id: z.string().check(z.regex(LIST_ID)) }),
        result: z.object({}),
      },
    },
    what: 'remove a playlist the Thunderhead made (undo only)',
    doc: "Only the undo of music.create_playlist: removes a playlist the Thunderhead made, while the owner hasn't changed it (else `owner_edited`). Deleting the owner's own playlists is ask-first and no verb.",
  },
  'music.queue': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ refs: songs(200), at: z.enum(['next', 'end']) }),
        result: z.object({ queued: z.number(), missing: z.number() }),
      },
    },
    what: 'add songs to the queue, next or at the end',
    doc: "Adds songs (`music:<id>`) to the player's queue, next or at the end. The play queue lives in the player, so Music applies it when it next opens (an intent); songs not in that phone's library are counted as `missing`. Its undo (`music.unqueue`) takes them back out.",
  },
  'music.unqueue': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    intent: true,
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ refs: songs(200) }),
        result: z.object({ removed: z.number() }),
      },
    },
    what: 'take queued songs back out (undo only)',
    doc: 'Only the undo of music.queue: takes those songs back out of the queue where they have not played yet.',
  },
  'music.play_mix': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        // Exactly one of: a mix saved with music.mix_save (`mix_id`), a find (`find`, the Worker
        // runs it and hands the phone its songs), or the songs themselves (`refs`, also what an undo
        // restores, with the place it was at).
        args: z
          .object({
            mix_id: z.optional(z.string().check(z.regex(UUID7))),
            find: z.optional(findSpec),
            refs: z.optional(songs(PLAY_MAX)),
            index: z.optional(z.number().check(z.int(), z.gte(0), z.lte(PLAY_MAX - 1))),
          })
          .check(
            z.refine(
              (a) => [a.mix_id, a.find, a.refs].filter((x) => x !== undefined).length === 1,
              'exactly one of mix_id, find or refs',
            ),
          ),
        result: z.object({ tracks: z.number(), started: z.boolean() }),
      },
    },
    what: 'load a saved mix, a find or songs as the queue',
    doc: "Loads a saved mix (`mix_id`), the songs a find picks (`find`: moods, occasion, energy, like, limit, as `th music find`; songs ruled out are left out) or songs (`refs`) as the player's queue; it starts only after an owner gesture (MUSIC.md §10.3), else it waits paused. Music applies it when it next opens (an intent). Its undo restores the queue before it (its first 500 songs and the place).",
  },
  'music.rate': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ ref: song, rating: z.number().check(z.int(), z.gte(1), z.lte(5)) }),
        result: z.object({ previous: z.number() }),
      },
    },
    what: 'rate a song the owner has not rated',
    doc: "Rates a song 1–5 in the player's library, only one the owner has not rated (else `owner_rated`): the owner's rating stays theirs. The ratings live in the player, so Music applies it when it next opens (an intent), and its own `music.rate` sense tells the Worker. Its undo (`music.unrate`) clears it while it is still the rating set.",
  },
  'music.unrate': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'phone',
    intent: true,
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ ref: song, rating: z.number().check(z.int(), z.gte(1), z.lte(5)) }),
        result: z.object({}),
      },
    },
    what: 'clear a rating the mind set (undo only)',
    doc: 'Only the undo of music.rate: clears the song\'s rating while it is still the one set (else `owner_edited`).',
  },
  'music.never': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'worker',
    // The owner's words of this session, through memory's rules: never later.
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ ref: song, evidence: ownerWords }),
        result: z.object({ fact_id: z.string() }),
      },
    },
    what: "never play a song again (from the owner's words)",
    doc: "Records the owner's \"never play this again\" as their rule (subject `music.never`, its text naming the song by `music:<id>` only), through memory's own rules: `evidence` must be the owner's messages. Find, like and every mix leave the song out at once. Its undo closes the rule.",
  },
  'music.mix_save': {
    app: 'music',
    class: 'reversible',
    permit: 'music',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({
          name: z.string().check(z.minLength(1), z.maxLength(60)),
          refs: songs(200),
          recipe: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
        }),
        result: z.object({ mix_id: z.string(), tracks: z.number() }),
      },
    },
    what: 'save songs (a find) as a named mix',
    doc: 'Saves songs (a find\'s result) as a named mix in the Worker (`GET /v1/music/mixes`), for `music.play_mix {mix_id}` later; `recipe` is the one line it was found by. The mix\'s id is the verb\'s id. Its undo deletes the mix.',
  },
} as const satisfies Record<string, VerbSpec>;
