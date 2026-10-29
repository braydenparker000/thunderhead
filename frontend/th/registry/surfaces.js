// @ts-check
// Surface renderers (EXTENDING.md rule 3, API.md §11.12): how this phone shows each surface kind
// and version of the contract. A kind or version without a renderer becomes the generic card with
// the surface's `why`, so a new kind can reach the Worker before any phone draws it.

/** @typedef {import('../../../shared/contract/api.ts').Surface} Surface */
/** @typedef {{ place: 'voice', order: number, text: string, lang: string | null } | { place: 'card', order: number, text: string, kind: string }} Placed */

/** @type {Record<string, Record<number, (s: Surface) => Placed | null>>} */
export const RENDERERS = {
  // A home line is the voice line's second line (HOME.md §2.1); the lowest slot number wins.
  line: {
    1: (s) =>
      s.app === 'home'
        ? { place: 'voice', order: Number(s.slot.split('.')[1]) || 9, text: String(s.payload.text ?? ''), lang: typeof s.payload.lang === 'string' ? s.payload.lang : null }
        : null,
  },
};

/** @param {string} kind @param {number} schema */
export const hasRenderer = (kind, schema) => Boolean(RENDERERS[kind]?.[schema]);

/** @param {Surface} s @returns {Placed | null} */
export function place(s) {
  const r = RENDERERS[s.kind]?.[s.schema];
  return r ? r(s) : { place: 'card', order: 0, text: s.why, kind: s.kind };
}

/** The voice line's second line from a set of surfaces, if any. @param {Surface[]} items */
export function homeLine(items) {
  const lines = items.map(place).filter((p) => p?.place === 'voice');
  lines.sort((a, b) => /** @type {Placed} */ (a).order - /** @type {Placed} */ (b).order);
  return /** @type {{ text: string, lang: string | null } | undefined} */ (lines[0]) ?? null;
}

/** Surfaces this phone cannot draw, shown as generic cards. @param {Surface[]} items */
export const fallbackCards = (items) => items.map(place).filter((p) => p?.place === 'card');
