// The island line (BEHAVIOR.md §2, HOME.md §12.1): one sentence the mind puts in the capsule while
// Music or Podcasts plays there. The phone runs it (th/island/line.js); the next one replaces it,
// its undo (`island.clear`, never queued by the mind) takes it away, and it goes when that app
// leaves the island.
import * as z from 'zod/mini';
import { lintMindText } from './lint.ts';
import type { VerbSpec } from './verb-spec.ts';

/** Characters in one island line. */
export const ISLAND_LINE_MAX = 80;
const line = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(ISLAND_LINE_MAX),
    z.refine((s) => s.trim() === s && !/[\n\r\t]/.test(s), 'one line, no spaces at its ends'),
    z.refine((s) => !s.includes('?'), 'never a question'),
    z.refine((s) => !/[.!;:]\s+\S/.test(s), 'one sentence'),
    z.refine((s) => lintMindText(s) === null, 'the phrase lint (BEHAVIOR.md §10)'),
  );
/** The phone's own name for the line it showed, so an undo takes back that one and no later one. */
const lineId = z.string().check(z.regex(/^[A-Za-z0-9-]{8,40}$/));

export const ISLAND_VERBS = {
  'island.show': {
    app: 'shell',
    class: 'reversible',
    // A line in front of the owner, like a home line or a Briefing tile.
    permit: 'tiles',
    side: 'phone',
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ text: line }),
        result: z.object({ app: z.enum(['music', 'podcasts']), line: lineId }),
      },
    },
    what: 'one sentence in the island; never a question',
    doc: "Shows one sentence (at most 80 characters, never a question, under the phrase lint) in the island's capsule while Music or Podcasts plays there; the next one replaces it, and it goes when that app leaves the island (opened full screen, or another app takes the capsule). Nothing playing in the island is `not_playing`. The phone reports `island.clear` as its undo.",
  },
  'island.clear': {
    app: 'shell',
    class: 'reversible',
    permit: 'tiles',
    side: 'phone',
    // Only ever island.show's undo.
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ line: lineId }),
        result: z.object({ cleared: z.boolean() }),
      },
    },
    what: "take the island's line away (island.show's undo)",
    doc: 'Takes away the island line that `island.show` put up, if it still stands; a later line stays (`cleared: false`).',
  },
} as const satisfies Record<string, VerbSpec>;
