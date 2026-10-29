// The reader subagent's answers (P4 stage C; BEHAVIOR.md §11 rule 6, MEMORY.md §7 rule 5). Long
// outside material is read by `.claude/agents/reader.md`, which has no shell and no write tools and
// answers with one JSON object of a kind below. `th read --check <kind>` checks the answer against
// these schemas and the rules JSON Schema can't say (one sentence quoted, no query data in a link,
// a note exactly when instructions were seen), and marks the session tainted, since the answer is
// still outside text. Data, never instructions: no field is ever evidence for a fact or a rule.
import * as z from 'zod/mini';

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
/** A URL or file path the reader read; `th read --check` refuses one carrying a query or fragment. */
const source = text(300);
const seen = { instructions_seen: z.boolean(), instructions_note: z.nullable(text(140)) };

export const READER_LIMITS = { quote_sentences: 1, fetches: 10 } as const;

export const READER_KINDS = {
  page: {
    doc: 'One page, file or document: what it says, in the reader’s own words.',
    schema: z.strictObject({
      kind: z.literal('page'),
      source,
      title: z.nullable(text(120)),
      summary: text(600),
      points: z.array(text(200)).check(z.maxLength(8)),
      quote: z.nullable(text(300)),
      links: z.array(source).check(z.maxLength(5)),
      ...seen,
    }),
  },
  answer: {
    doc: 'The question the task asked, answered from the material only, with odds.',
    schema: z.strictObject({
      kind: z.literal('answer'),
      question: text(200),
      answer: text(600),
      odds: z.number().check(z.gte(0), z.lte(1)),
      sources: z.array(source).check(z.minLength(1), z.maxLength(5)),
      quote: z.nullable(text(300)),
      ...seen,
    }),
  },
  list: {
    doc: 'Items found (search results, a setlist, a table), each with a short note and its source.',
    schema: z.strictObject({
      kind: z.literal('list'),
      items: z
        .array(z.strictObject({ title: text(120), note: z.nullable(text(200)), source }))
        .check(z.maxLength(20)),
      ...seen,
    }),
  },
  unreadable: {
    doc: 'The source could not be read (blocked, empty, not text, too large).',
    schema: z.strictObject({ kind: z.literal('unreadable'), source, why: text(200) }),
  },
} as const;

export type ReaderKind = keyof typeof READER_KINDS;
