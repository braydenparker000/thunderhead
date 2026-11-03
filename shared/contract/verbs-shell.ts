// The Thunderhead's own verbs that the Worker runs (verbs.ts): moving a reminder, a setting, the
// Briefing's pins and a fact in the owner's own words.
import * as z from 'zod/mini';
import { FACT_KIND_NAMES, PROVENANCES } from './memory.ts';
import { ownerWords, UUID7, type VerbSpec } from './verb-spec.ts';

/** The tiles the Briefing knows by name (briefing/assemble.ts): "Due", "Holidays" and the night
 * shift's slots. Weather is always first and "Waiting on you" second, so neither is pinned. */
export const PINNABLE_TILES = ['due', 'holidays', 'practice', 'study', 'built', 'note.1', 'note.2', 'note.3'] as const;
/** Tiles pinned at once; a fourth pin unpins the oldest. */
export const PINS_MAX = 3;
const pinned = z.object({ pinned: z.array(z.string()) });

export const SHELL_VERBS = {
  'reminder.move': {
    app: 'shell',
    class: 'reversible',
    permit: 'reminders',
    side: 'worker',
    // From the chat, a clean session, the owner's message that asked: all of the moment.
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({
          id: z.string().check(z.regex(UUID7)),
          at: z.number().check(z.int(), z.gte(0)),
          source_message_id: z.optional(z.string().check(z.maxLength(64))),
        }),
        result: z.object({ at: z.number(), fire_at: z.number() }),
      },
    },
    what: 'move a set reminder to a new time',
    doc: "Moves a set reminder to a new time, by the reminders' own rules: in the future, at most 400 days ahead, a time inside quiet hours rings at their end; only from the chat, from a clean session; one the owner set on the phone needs the owner's message that asked (`source_message_id`). Its undo puts back the time before, while the reminder is still set at the new one.",
  },
  'settings.set': {
    app: 'shell',
    class: 'reversible',
    permit: 'settings',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ key: z.string().check(z.minLength(1), z.maxLength(64)), value: z.json() }),
        result: z.object({ previous: z.json() }),
      },
    },
    what: 'change one setting (not permissions or privacy)',
    doc: "Changes one of the Worker's settings in the catalogue (MENU-AND-SETTINGS.md §6), to a value the catalogue allows. Never the standing permissions (`mind.permit.*`), the outside-sources switch (`mind.ask_outside`) or Privacy and data (`privacy.*`): those are the owner's alone. Its undo puts back the value before (or the default), while the setting still holds the new one.",
  },
  'briefing.pin_tile': {
    app: 'shell',
    class: 'reversible',
    permit: 'tiles',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ tile: z.enum(PINNABLE_TILES) }),
        result: pinned,
      },
    },
    what: 'pin a Briefing tile near the top',
    doc: 'Pins a tile the Briefing knows (`due`, `holidays`, or a night slot: `practice`, `study`, `built`, `note.1`–`note.3`) right after "Waiting on you", newest pin first, at most 3 (a fourth unpins the oldest); a pinned tile shows only when it has something to say. The owner\'s own arrangement on the phone still wins. Its undo puts back the pins before.',
  },
  'briefing.unpin_tile': {
    app: 'shell',
    class: 'reversible',
    permit: 'tiles',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ tile: z.enum(PINNABLE_TILES) }),
        result: pinned,
      },
    },
    what: 'unpin a Briefing tile',
    doc: 'Unpins a Briefing tile, which goes back to its usual place. Its undo pins it again where it was.',
  },
  'memory.note': {
    app: 'shell',
    class: 'reversible',
    // No standing permission: only ever the owner's own words, which memory's rules check (M3).
    permit: null,
    side: 'worker',
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({
          text: z.string().check(z.minLength(1), z.maxLength(280)),
          kind: z.enum(FACT_KIND_NAMES as [string, ...string[]]),
          subject: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
          evidence: ownerWords,
        }),
        result: z.object({ fact_id: z.string(), provenance: z.enum(PROVENANCES) }),
      },
    },
    what: "remember a fact in the owner's own words (no card)",
    doc: "Remembers a fact about the owner from their own message (source `user`), through memory's rules: every evidence ref must be the owner's own message (M3), never off the record; no card. `provenance` is the label memory gave it (MEMORY.md §6 M11): `owner`, or `outside` from a session that read outside text, which waits for the owner's keep. Its undo closes the fact (it stops being current, as a supersede closes the old version); forgetting it for good stays the owner's.",
  },
} as const satisfies Record<string, VerbSpec>;
