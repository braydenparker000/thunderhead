// The tags a song's metadata keeps beyond the old catalog's (2026-11-25, MUSE-SOP.md step 6): `isrc`
// (12 letters or digits, kept upper-case), `label` (text), `trackTotal` and `discTotal` (whole
// numbers from 1), `compilation` (true or false) and `originalYear` (a whole year). The tags'
// lower-case spellings (`tracktotal`, `disctotal`, `originalyear`) are taken for them. A bad value
// throws `BadTag` naming the field, so the answer can say which.

type Obj = Record<string, unknown>;

export class BadTag extends Error {}

/** The lower-case spellings taken for a field; the field's own spelling wins when both are sent. */
export const ALIASES: Readonly<Record<string, string>> = {
  tracktotal: 'trackTotal',
  disctotal: 'discTotal',
  originalyear: 'originalYear',
};
export const EXTRA_KEYS = ['isrc', 'label', 'trackTotal', 'discTotal', 'compilation', 'originalYear'];

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL = /[\x00-\x1f\x7f]/;
const whole = (v: unknown, lo: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo;

/** The changes with each alias under its field's name (the field's own spelling first). */
export function canonical(input: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(input)) {
    const to = Object.hasOwn(ALIASES, k) ? ALIASES[k] : null;
    if (!to) out[k] = v;
    else if (!Object.hasOwn(input, to)) out[to] = v;
  }
  return out;
}

/** Copies the extra tags of `input` (aliases taken) into `out`, each checked. */
export function extras(input: Obj, out: Obj): void {
  const at = canonical(input);
  const bad = (k: string): never => {
    throw new BadTag(k);
  };
  if (at.isrc != null) {
    if (typeof at.isrc !== 'string' || !/^[A-Za-z0-9]{12}$/.test(at.isrc)) bad('isrc');
    out.isrc = (at.isrc as string).toUpperCase();
  }
  if (at.label != null) {
    if (typeof at.label !== 'string' || at.label.length > 512 || CONTROL.test(at.label)) bad('label');
    out.label = at.label;
  }
  for (const k of ['trackTotal', 'discTotal'])
    if (at[k] != null) {
      if (!whole(at[k], 1)) bad(k);
      out[k] = at[k];
    }
  if (at.compilation != null) {
    if (typeof at.compilation !== 'boolean') bad('compilation');
    out.compilation = at.compilation;
  }
  if (at.originalYear != null) {
    if (!whole(at.originalYear, 0)) bad('originalYear');
    out.originalYear = at.originalYear;
  }
}
