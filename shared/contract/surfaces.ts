// Surface kinds: what the mind may place on a screen, as data with runtime schemas (API.md
// §11.12). Each kind is versioned by `schema`; the Worker validates the payload against it and
// the phone renders it with the renderer registered for that kind. A phone that lacks a renderer
// for a kind or version shows the generic card (its `why`), so new kinds ship without breaking
// old phones.
import * as z from 'zod/mini';
import { APP_IDS, APPS, type AppId } from './feed.ts';
import { PODCAST_LIMITS, progressKeyProblem } from './podcasts.ts';
import { UUID7 } from './verb-spec.ts';
import { ARRANGED } from './verbs-apps.ts';

export interface SurfaceKind {
  /** Which app/slot pairs may hold this kind. */
  slots: Record<string, RegExp>;
  versions: Record<number, z.ZodMiniType>;
  doc: string;
}

/** Home lines (HOME.md §2.2): ≤ 44 characters, one line, ends with a full stop, no exclamation
 * marks and no emoji. */
const lineText = z.string().check(
  z.minLength(2),
  z.maxLength(44),
  z.refine((s) => !/[!\n]/.test(s) && !/\p{Extended_Pictographic}/u.test(s), 'no exclamation marks, emoji or line breaks'),
  z.refine((s) => s.trimEnd().endsWith('.'), 'ends with a full stop'),
);

/** Briefing tile text (BRIEFING.md §2 content limits): one line, no exclamation marks or emoji. */
const tileText = (max: number) =>
  z.string().check(
    z.minLength(1),
    z.maxLength(max),
    z.refine((s) => !/[!\n]/.test(s) && !/\p{Extended_Pictographic}/u.test(s), 'no exclamation marks, emoji or line breaks'),
  );
/** Where a tile opens: a path inside one shipped app's folder (as a reply chip's). */
const tileGo = (t: { app?: string; path?: string }) =>
  (t.app === undefined) === (t.path === undefined) &&
  (t.app === undefined ||
    ((APP_IDS as string[]).includes(t.app) &&
      typeof t.path === 'string' &&
      t.path.startsWith(APPS[t.app as AppId].path) &&
      !t.path.includes('..') &&
      !/%2f|%5c|\\/i.test(t.path)));

export const SURFACE_KINDS = {
  line: {
    slots: { home: /^line\.[1-4]$/ },
    versions: { 1: z.object({ text: lineText, lang: z.optional(z.string().check(z.regex(/^[a-z]{2,3}(-[A-Z]{2})?$/))) }) },
    doc: "A home line, shown as a card in today's chat at its time; the night's lines are one Overnight card shown when quiet hours end (HOME.md §2.2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line.",
  },
  tile: {
    slots: { briefing: /^(practice|study|built|note\.[1-3])$/ },
    versions: {
      1: z
        .object({
          label: tileText(24),
          value: tileText(32),
          detail: z.optional(tileText(60)),
          big: z.optional(tileText(5)),
          wide: z.optional(z.boolean()),
          app: z.optional(z.string()),
          path: z.optional(z.string().check(z.maxLength(300))),
        })
        .check(z.refine(tileGo, 'app and path together: a path inside that app')),
    },
    doc: 'A Briefing tile (BRIEFING.md §2), app `briefing`: `study` (today\'s reading), `practice`, `built` (what you made overnight), `note.1`–`note.3`. {label ≤24, value ≤32, detail? ≤60, big? ≤5, wide?, app?+path? (opens it)}; set --expires, else it goes after a day.',
  },
  // In-app arrangements (BEHAVIOR.md §3.1, rung 0): one slot per app, one kind each, placed by the
  // app's verb (verbs-apps.ts) or `th surface`; the app draws it with its why behind a tap and
  // reports it seen, tapped or dismissed (senses.ts `arrangement.*`), so the meter counts it.
  mix: {
    slots: { music: /^tonight$/ },
    versions: {
      1: z.object({
        mix_id: z.string().check(z.regex(UUID7)),
        name: ARRANGED.words(60),
        tracks: z.optional(z.number().check(z.int(), z.gte(1), z.lte(500))),
      }),
    },
    doc: 'Music\'s "tonight" (`music/tonight`): a mix saved with music.mix_save, on the home shelf, played by the owner\'s tap. {mix_id, name ≤60, tracks?}.',
  },
  section: {
    slots: { guitar: /^today$/ },
    versions: { 1: ARRANGED.plan },
    doc: 'Guitar\'s "today\'s section" (`guitar/today`), placed by guitar.set_plan: {tab, sections [{key, bpm}] 1–4, label? ≤40}.',
  },
  episode: {
    slots: { podcasts: /^next$/ },
    versions: {
      1: z.object({
        key: z
          .string()
          .check(
            z.maxLength(PODCAST_LIMITS.url_chars + 1 + PODCAST_LIMITS.id_chars),
            z.refine((k) => progressKeyProblem(k) === null, '<feed address>#<episode id>'),
          ),
        title: ARRANGED.words(80),
        show: z.optional(ARRANGED.words(60)),
      }),
    },
    doc: 'Podcasts\' "next up" (`podcasts/next`): one episode by its key (`<feed address>#<episode id>`), {key, title ≤80, show? ≤60}; the owner\'s tap plays it.',
  },
  passage: {
    slots: { study: /^next$/ },
    versions: { 1: ARRANGED.passage },
    doc: 'Study\'s "where you left off, and what next" (`study/next`), placed by study.mark_next: {book, left_off ≤60, next ≤60, page?}.',
  },
  shortlist: {
    slots: { astra: /^tonight$/, media: /^tonight$/ },
    versions: { 1: ARRANGED.shortlist },
    doc: 'Astra\'s "three for tonight" (`astra/tonight`) or My Media\'s (`media/tonight`), placed by astra.shortlist or media.shortlist: {titles? [{ref, title ≤80}] 2–3, filters? ≤3}; the owner picks.',
  },
} as const satisfies Record<string, SurfaceKind>;

/** The one arrangement slot of each app, `<app>/<slot>`: the meter counts what lands there as it
 * counts home's lines (seen, tapped, dismissed). */
export const ARRANGEMENT_SLOTS = ['music/tonight', 'guitar/today', 'podcasts/next', 'study/next', 'astra/tonight', 'media/tonight'] as const;

export type SurfaceKindName = keyof typeof SURFACE_KINDS;

export function surfaceKind(name: string): SurfaceKind | null {
  return Object.hasOwn(SURFACE_KINDS, name) ? (SURFACE_KINDS as Record<string, SurfaceKind>)[name] : null;
}
