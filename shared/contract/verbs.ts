// Verbs: the actions the mind may ask for, as data with runtime schemas (API.md §11.11). One
// entry per verb, versioned by `schema`, so the Worker validates args and results, the phone
// looks up its executor, `th help` lists them and CONTRACT.md documents them from the same
// source. A phone that does not know a verb (or its schema version) reports `unsupported_verb`;
// nothing breaks while new verbs ship. Ask-first verbs need an approved proposal (P4).
import * as z from 'zod/mini';
import { APP_IDS } from './feed.ts';

export interface VerbVersion {
  args: z.ZodMiniType;
  result: z.ZodMiniType;
}

export interface VerbSpec {
  /** The app that owns it; `shell` = the Thunderhead's own home and menu. */
  app: string;
  /** `reversible`: done at once and undoable; `ask_first`: only with an approved proposal. */
  class: 'reversible' | 'ask_first';
  /** Where it runs: on a signed-in `device` (claim → result) or inside the `worker`. */
  executor: 'device' | 'worker';
  /** Whether an agent may queue it with PUT /v1/verbs/:id. `false` = owner taps only (a chip). */
  queueable: boolean;
  /** `reported`: the executor returns its inverse as `undo`; `none`: nothing to undo. */
  undo: 'reported' | 'none';
  /** Schema versions, newest last. A device runs the newest version it knows. */
  versions: Record<number, VerbVersion>;
  doc: string;
}

const SONG_REF = /^music:r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
const LIST_ID = /^[a-z0-9]{6,24}$/;

const path = z.string().check(z.minLength(1), z.maxLength(200), z.regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@/?#%-]*$/));
const mode = z.enum(['auto', 'day', 'night']);

export const VERBS = {
  'app.open': {
    app: 'shell',
    class: 'reversible',
    executor: 'device',
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ app: z.enum(APP_IDS as [string, ...string[]]), path }),
        result: z.object({}),
      },
    },
    doc: "Opens an app at a place. Runs only when the owner taps a reply's action chip; the mind never opens an app by itself (BEHAVIOR.md §2.2).",
  },
  'music.create_playlist': {
    app: 'music',
    class: 'reversible',
    executor: 'device',
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
    doc: "Makes a playlist in the Music player from tracks (`music:<id>`), on this phone. Open it with a reply chip to `/music/#pl=<list_id>`. Its undo removes it while the owner hasn't changed it.",
  },
  'music.delete_playlist': {
    app: 'music',
    class: 'reversible',
    executor: 'device',
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ list_id: z.string().check(z.regex(LIST_ID)) }),
        result: z.object({}),
      },
    },
    doc: "Only the undo of music.create_playlist: removes a playlist the Thunderhead made, while the owner hasn't changed it (else `owner_edited`). Deleting the owner's own playlists is ask-first and no verb.",
  },
  'shell.appearance': {
    app: 'shell',
    class: 'reversible',
    executor: 'device',
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ mode }),
        result: z.object({ previous: mode }),
      },
    },
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
