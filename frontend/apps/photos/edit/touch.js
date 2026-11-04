// @ts-check
// Two touches on the photo (PHOTOS.md, the editor): the white-balance picker's tap (what you tap is
// made neutral) and Mix's targeted drag (drag up or down on a colour: its two nearest ranges move,
// shared by how near each is). Kept apart from editor.js, which wires them to the photo's gestures.
import { linear, neutralFor, srgbTo2020 } from './color.js';
import { HUES, val, withValue } from './fields.js';
import { colourAt } from './histogram.js';

/** @typedef {{ px: Uint8Array, w: number, h: number }} Small */
/**
 * @param {{ ed: import('./tools.js').Ed, asShot: () => number[], uvAt: (x: number, y: number) => number[],
 *   readSmall: (r: import('./fields.js').Recipe) => Promise<Small>, asShotWb: () => import('./fields.js').Recipe,
 *   small: () => Small | null, changed: (done: boolean) => void, picked: () => void, remix: () => void }} c
 */
export function touches(c) {
  const { ed } = c;
  /** @type {null | { k: number, f: number, a: number, b: number }} */
  let base = null;
  return {
    /** @param {number} x @param {number} y */
    async tap(x, y) {
      if (ed.mode !== 'pick') return;
      const [u, v] = c.uvAt(x, y);
      const s = await c.readSmall(c.asShotWb());
      const wb = neutralFor(c.asShot(), srgbTo2020(colourAt(s.px, s.w, s.h, u, v).map(linear)));
      ed.setMode('view');
      ed.setWb(wb.temperature, wb.tint, true);
      c.picked();
    },
    /** @param {number} x @param {number} y @param {number} dy @param {boolean} done */
    target(x, y, dy, done) {
      const small = c.small();
      if (!small) return;
      if (!base) {
        const [u, v] = c.uvAt(x, y);
        const col = colourAt(small.px, small.w, small.h, u, v);
        const mx = Math.max(...col), mn = Math.min(...col), d = mx - mn || 1e-6;
        const hue = (((mx === col[0] ? (col[1] - col[2]) / d : mx === col[1] ? 2 + (col[2] - col[0]) / d : 4 + (col[0] - col[1]) / d) * 60) + 360) % 360;
        const C = [0, 30, 60, 120, 180, 240, 270, 300, 360];
        const k = Math.max(0, C.findIndex((h, i) => hue >= h && hue < C[i + 1]));
        const key = (/** @type {number} */ i) => `${ed.mixProp}Adjustment${HUES[i % 8]}`;
        base = { k, f: (hue - C[k]) / (C[k + 1] - C[k]), a: val(ed.recipe, key(k)), b: val(ed.recipe, key(k + 1)) };
        ed.mixHue = HUES[base.f < 0.5 ? k : (k + 1) % 8];
      }
      const t = base, delta = -dy / 2;
      const clamp = (/** @type {number} */ q) => Math.round(Math.max(-100, Math.min(100, q)));
      ed.recipe = withValue(ed.recipe, `${ed.mixProp}Adjustment${HUES[t.k]}`, clamp(t.a + delta * (1 - t.f)));
      ed.recipe = withValue(ed.recipe, `${ed.mixProp}Adjustment${HUES[(t.k + 1) % 8]}`, clamp(t.b + delta * t.f));
      c.changed(done);
      if (done) { base = null; c.remix(); ed.setMode('target'); }
    },
  };
}
