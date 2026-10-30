// Surface kinds: what the mind may place on a screen, as data with runtime schemas (API.md
// §11.12). Each kind is versioned by `schema`; the Worker validates the payload against it and
// the phone renders it with the renderer registered for that kind. A phone that lacks a renderer
// for a kind or version shows the generic card (its `why`), so new kinds ship without breaking
// old phones.
import * as z from 'zod/mini';
import { APP_IDS, APPS, type AppId } from './feed.ts';

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
    doc: 'A home line under the voice line (HOME.md §2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line.',
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
} as const satisfies Record<string, SurfaceKind>;

export type SurfaceKindName = keyof typeof SURFACE_KINDS;

export function surfaceKind(name: string): SurfaceKind | null {
  return Object.hasOwn(SURFACE_KINDS, name) ? (SURFACE_KINDS as Record<string, SurfaceKind>)[name] : null;
}
