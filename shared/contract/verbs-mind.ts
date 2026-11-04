// Batch 3 of the verbs (verbs.ts): what the mind did through Core's own routes, now as verbs with a
// stored undo that a plan can carry: a conversation's title, the owner's keep of a fact learned
// from outside text (asked in the chat, always with a card: the owner's tap is the keep) and a
// Muse order that carries the owner's data (the reach-people floor). The Worker runs all three.
import * as z from 'zod/mini';
import { APP_IDS } from './feed.ts';
import { PROVENANCES } from './memory.ts';
import { UUID7, type VerbSpec } from './verb-spec.ts';
import { WORK_LIMITS } from './work.ts';

const line = (max: number) =>
  z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(max),
      z.refine((s) => s.trim() === s && !/[\n\r\t]/.test(s), 'one line, no spaces at its ends'),
    );

export const MIND_VERBS = {
  'thread.title': {
    app: 'shell',
    class: 'reversible',
    permit: 'titles',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ thread_id: z.string().check(z.regex(UUID7)), title: line(80) }),
        result: z.object({ previous: z.nullable(z.string()) }),
      },
    },
    what: 'name a conversation',
    doc: "Names a conversation (≤ 80 characters, one line), as `PATCH /v1/threads/:id` does; never one the owner named, one held off the record or deleted, or a title on law 8's topics. Its undo puts back the title before (or none), while it still holds this one.",
  },
  'memory.outside_keep': {
    app: 'shell',
    class: 'reversible',
    // Keeping outside text is the owner's alone (MEMORY.md §6 M11): this class always asks, whatever
    // its position (mind/permit.ts), so the approved card is the owner's Keep, asked in the chat.
    permit: 'outside',
    side: 'worker',
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ fact_id: z.string().check(z.regex(UUID7)) }),
        result: z.object({ fact_id: z.string(), provenance: z.enum(PROVENANCES) }),
      },
    },
    what: 'keep a fact learned from outside text (always a card)',
    doc: "The owner's Keep of a current `outside` fact, asked in the chat: it always waits for an approved card (no position loosens it), and then lifts the fact into an `owner` version as Keep under \"Learned from outside\" in Settings › Memory does. Only from a session that read no outside text. Its undo puts back the outside version, while the kept one is still current.",
  },
  'muse.order_personal': {
    app: 'shell',
    class: 'ask_first',
    permit: 'muse',
    // Muse runs on another provider (BEHAVIOR.md §7 rule 4): words that carry the owner's data reach
    // someone else, so only ever with the owner's tap on the card.
    floor: 'reach_people',
    side: 'worker',
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({
          title: line(WORK_LIMITS.title_words),
          words: z.string().check(z.minLength(1), z.maxLength(WORK_LIMITS.words)),
          app: z.optional(z.enum(APP_IDS as [string, ...string[]])),
        }),
        result: z.object({ order_id: z.string() }),
      },
    },
    what: "a Muse order with the owner's data (always a card)",
    doc: "A `muse.request` whose words carry the owner's data (the order is marked `personal`), placed for Muse with a 7-day deadline: always with an approved `reach_people` card, only from a session that read no outside text, never with what MEMORY.md §13 says is never stored or with words on law 8's topics. Its order id is the verb's. Its undo cancels the order while it is still open.",
  },
} as const satisfies Record<string, VerbSpec>;
