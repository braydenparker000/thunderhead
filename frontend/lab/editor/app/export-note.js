// @ts-check
// The line an exported file carries on how it was made (2026-11-13), so one file tells how it was developed: the
// release, the way (the network, the usual demosaic, or its faster one), the controls moved from their start, the
// white balance, the look, whether it is cropped, how many masks and spots, and the Export board's quality. One
// line of JSON under 1,500 bytes; never a file name, a place or anything of the owner's. Written only where the
// file carries metadata (save.js; engine/files.js puts it in the file). `scripts/export-note.mjs` reads it back.

/** The most bytes the line may take. */
export const MOST = 1500;

/** @typedef {{ build: string, way: 'network' | 'classic' | 'faster', values: Record<string, number>, wb: string, profile: string, crop: boolean, masks: number, spots: number, q: number }} Made */

/** Its size in the file, where anything past ASCII is written as a \u escape. @param {string} s */
const size = (s) => s.replace(/[^\x20-\x7e]/g, '\\u0000').length;

/** The line for an export made so. Values are kept to two decimals; should they not fit, the last are left out and
 * `cut` says how many. @param {Made} m */
export function noteLine(m) {
  const values = /** @type {Record<string, number>} */ ({});
  for (const [k, v] of Object.entries(m.values)) if (typeof v === 'number' && Number.isFinite(v)) values[k] = Math.round(v * 100) / 100;
  const o = /** @type {Record<string, unknown>} */ ({ th: 1, build: m.build, way: m.way, values, wb: m.wb, profile: m.profile, crop: m.crop, masks: m.masks, spots: m.spots, q: m.q });
  const keys = Object.keys(values);
  let line = JSON.stringify(o), cut = 0;
  while (size(line) >= MOST && keys.length) { delete values[/** @type {string} */ (keys.pop())]; o.cut = ++cut; line = JSON.stringify(o); }
  return line;
}
