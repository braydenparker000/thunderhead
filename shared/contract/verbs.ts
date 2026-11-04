// Verbs: the actions the mind may ask for, as data with runtime schemas (API.md §11.11). One
// entry per verb, versioned by `schema`, so the Worker validates args and results, the phone
// looks up its executor, `th help` lists them and CONTRACT.md documents them from the same
// source. A phone that does not know a verb (or its schema version) reports `unsupported_verb`;
// nothing breaks while new verbs ship. Each verb names its standing-permission class (`permit`,
// permits.ts) and, by hand, its floor; a floor's verbs are ask-first and need an approved card.
// `side` says who runs it: the Worker, inside the commit that queues it (done at once, its undo
// stored on the ledger row, backend/src/areas/verbs/worker.ts), or a phone. A phone verb whose
// state lives in an app that may be closed (the play queue, the player's ratings, Podcasts' shows
// and Up Next) is an `intent`: it waits for that app to open and apply it (API.md §11.11,
// "Pending intents").
import * as z from 'zod/mini';
import { APP_IDS } from './feed.ts';
import type { VerbSpec } from './verb-spec.ts';
import { ISLAND_VERBS } from './verbs-island.ts';
import { MUSIC_VERBS } from './verbs-music.ts';
import { PODCAST_VERBS } from './verbs-podcasts.ts';
import { SHELL_VERBS } from './verbs-shell.ts';
import { WATCH_VERBS } from './watches.ts';

export type { VerbSpec, VerbVersion } from './verb-spec.ts';
export { ISLAND_LINE_MAX } from './verbs-island.ts';
export { PLAY_MAX } from './verbs-music.ts';
export { PINNABLE_TILES, PINS_MAX } from './verbs-shell.ts';

const path = z.string().check(z.minLength(1), z.maxLength(200), z.regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@/?#%-]*$/));
const mode = z.enum(['auto', 'day', 'night']);

/** Every verb, in the order `th help` and CONTRACT.md list them; each app's in its own file. */
export const VERBS = {
  'app.open': {
    app: 'shell',
    class: 'reversible',
    // Owner taps only (never queued), so its class decides nothing; filed with what the mind puts
    // in front of the owner.
    permit: 'tiles',
    side: 'phone',
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ app: z.enum(APP_IDS as [string, ...string[]]), path }),
        result: z.object({}),
      },
    },
    what: 'open an app at a place (owner tap only)',
    doc: "Opens an app at a place. Runs only when the owner taps a reply's action chip; the mind never opens an app by itself (BEHAVIOR.md §2.2).",
  },
  ...MUSIC_VERBS,
  ...PODCAST_VERBS,
  ...SHELL_VERBS,
  ...ISLAND_VERBS,
  ...WATCH_VERBS,
  'shell.appearance': {
    app: 'shell',
    class: 'reversible',
    // The theme is a setting (the top of Settings), so the mind changes it under `settings`.
    permit: 'settings',
    side: 'phone',
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ mode }),
        result: z.object({ previous: mode }),
      },
    },
    what: "set the phone's look: auto, day or night",
    doc: "Sets the phone's appearance (auto, day or night). The phone reports the previous mode as the undo.",
  },
} as const satisfies Record<string, VerbSpec>;

export type VerbName = keyof typeof VERBS;

export function verbSpec(name: string): VerbSpec | null {
  return Object.hasOwn(VERBS, name) ? (VERBS as Record<string, VerbSpec>)[name] : null;
}

/** The newest schema version of a verb. */
export function latestVersion(spec: VerbSpec): number {
  return Math.max(...Object.keys(spec.versions).map(Number));
}
