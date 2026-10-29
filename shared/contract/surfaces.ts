// Surface kinds: what the mind may place on a screen, as data with runtime schemas (API.md
// §11.12). Each kind is versioned by `schema`; the Worker validates the payload against it and
// the phone renders it with the renderer registered for that kind. A phone that lacks a renderer
// for a kind or version shows the generic card (its `why`), so new kinds ship without breaking
// old phones.
import * as z from 'zod/mini';

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

export const SURFACE_KINDS = {
  line: {
    slots: { home: /^line\.[1-4]$/ },
    versions: { 1: z.object({ text: lineText, lang: z.optional(z.string().check(z.regex(/^[a-z]{2,3}(-[A-Z]{2})?$/))) }) },
    doc: 'A home line under the voice line (HOME.md §2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line.',
  },
} as const satisfies Record<string, SurfaceKind>;

export type SurfaceKindName = keyof typeof SURFACE_KINDS;

export function surfaceKind(name: string): SurfaceKind | null {
  return Object.hasOwn(SURFACE_KINDS, name) ? (SURFACE_KINDS as Record<string, SurfaceKind>)[name] : null;
}
