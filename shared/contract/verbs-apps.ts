// The apps' arrangement verbs (verbs.ts; BEHAVIOR.md §3.1, MIND-PLAN §3.7): what the mind places
// inside Astra, My Media, Study and Guitar, each in its app's one arrangement slot (surfaces.ts
// ARRANGEMENT_SLOTS) with its why, so the meter counts it like any arrangement (seen, tapped,
// dismissed, undone). A shortlist offers titles to pick from and never picks; Study's pace is only
// ever the owner's own words.
import * as z from 'zod/mini';
import { ownerWords, type VerbSpec } from './verb-spec.ts';

/** Titles a shortlist offers at most ("three for tonight"). */
export const SHORTLIST_MAX = 3;
/** Sections one practice plan names at most. */
export const PLAN_SECTIONS_MAX = 4;

const words = (max: number) =>
  z.string().check(
    z.minLength(1),
    z.maxLength(max),
    z.refine((s) => s.trim() === s && !/[\n\r\t]/.test(s), 'one line, no spaces at its ends'),
  );
const refOf = (kind: string) => z.string().check(z.regex(new RegExp(`^${kind}:[A-Za-z0-9._:/-]{1,160}$`)));
const shortlist = (kind: string) =>
  z
    .object({
      titles: z.optional(
        z.array(z.object({ ref: refOf(kind), title: words(80) })).check(z.minLength(2), z.maxLength(SHORTLIST_MAX)),
      ),
      filters: z.optional(z.array(words(40)).check(z.minLength(1), z.maxLength(3))),
    })
    .check(z.refine((a) => a.titles !== undefined || a.filters !== undefined, 'titles or filters to pick from'));
const placed = z.object({ placed: z.string() });
const section = z.object({
  key: z.string().check(z.regex(/^\d{1,4}-\d{1,4}$/)),
  bpm: z.number().check(z.int(), z.gte(20), z.lte(300)),
});
const passage = z.object({
  book: refOf('book'),
  left_off: words(60),
  next: words(60),
  page: z.optional(z.number().check(z.int(), z.gte(1), z.lte(100_000))),
});
const plan = z.object({
  tab: refOf('tab'),
  sections: z.array(section).check(z.minLength(1), z.maxLength(PLAN_SECTIONS_MAX)),
  label: z.optional(words(40)),
});

/** Where each arrangement verb places (`<app>/<slot>`), its kind, and the arg that names what it is
 * about (its ledger row's ref), for the Worker. */
export const ARRANGES = {
  'astra.shortlist': { at: 'astra/tonight', kind: 'shortlist', ref: null },
  'media.shortlist': { at: 'media/tonight', kind: 'shortlist', ref: null },
  'study.mark_next': { at: 'study/next', kind: 'passage', ref: 'book' },
  'guitar.set_plan': { at: 'guitar/today', kind: 'section', ref: 'tab' },
} as const;

/** What each of these verbs places, as its arrangement's payload (surfaces.ts reads them). */
export const ARRANGED = { shortlist: shortlist('(?:astra|media)'), passage, plan, words };

export const APP_VERBS = {
  'astra.shortlist': {
    app: 'astra',
    class: 'reversible',
    permit: 'watch',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: { 1: { args: shortlist('astra'), result: placed } },
    what: "Astra's three for tonight, for the owner to pick",
    doc: "Places Astra's arrangement \"three for tonight\" (`astra/tonight`, kind `shortlist`): two or three titles (`astra:<type>:<id>` with its name) and up to three filters (\"under two hours\") for the owner to pick from; it never picks or plays. The verb's why is the arrangement's why chip. Its undo clears it, or puts back the one before.",
  },
  'media.shortlist': {
    app: 'media',
    class: 'reversible',
    permit: 'watch',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: { 1: { args: shortlist('media'), result: placed } },
    what: "My Media's titles for tonight, to pick from",
    doc: 'As astra.shortlist, for My Media (`media/tonight`, titles `media:<drive file id>`). Its undo clears it, or puts back the one before.',
  },
  'study.mark_next': {
    app: 'study',
    class: 'reversible',
    permit: 'practice',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: passage,
        result: placed,
      },
    },
    what: 'Study: where you left off and what next',
    doc: "Places Study's arrangement (`study/next`, kind `passage`): the book (`book:<id>`), where the owner left off and the next passage (each ≤ 60 characters), with the page to open; the verb's why says why that one. Only the owner's own study plan, as they set it (BEHAVIOR.md §9 rule 3); a law-8 topic is refused like every verb's. Its undo clears it, or puts back the one before.",
  },
  'study.pace_goal': {
    app: 'study',
    class: 'reversible',
    permit: 'practice',
    side: 'worker',
    // The owner's words of this session, through memory's rules: never later.
    now_only: true,
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ pages: z.number().check(z.int(), z.gte(1), z.lte(1_000)), evidence: ownerWords }),
        result: z.object({ fact_id: z.string(), previous: z.nullable(z.string()) }),
      },
    },
    what: "Study's pages a week (the owner's words)",
    doc: "Records the owner's own pace for Study (pages a week) as their goal (subject `study.pace`), through memory's rules: `evidence` must be the owner's messages (M3). A pace already set is replaced (`previous`: its fact id). Its undo puts the previous pace back (or none).",
  },
  'guitar.set_plan': {
    app: 'guitar',
    class: 'reversible',
    permit: 'practice',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: plan,
        result: placed,
      },
    },
    what: "Guitar's next sections and tempos",
    doc: "Places Guitar's arrangement \"today's section\" (`guitar/today`, kind `section`): a song (`tab:<id>`), one to four sections (`<first bar>-<last bar>`, as the ladder keys them) each at a tempo (20–300 bpm) from the ladder's last ceilings, and a short label. Coaching, not doing (law 5): the owner plays it. Its undo puts back the plan before.",
  },
} as const satisfies Record<string, VerbSpec>;
