// @ts-check
// Retouching: a spot of the photo replaced by another spot of it. Clone copies the source as it is; Heal and
// Remove also bring it to the brightness and colour of what surrounds the spot, so only its texture is borrowed.
// The copy is made on the sensor's own values, before anything else sees them, in two places that follow one
// rule (mend.js): where the editing copy is laid out as the picture (warp.js) and where full resolution is made
// from the sensor (demosaic.js). So a retouched photo is retouched at every zoom, in every tile and in the export.
//
// A spot is kept in mask units (local.js: the upright, uncropped picture, in units of its width) and turned into
// sensor pixels here. The source is a whole number of the sensor's colour pattern away (6 pixels), so each
// colour's site takes a site of the same colour.
import { fromUpright } from './warp.js';
import { SPOTS, SPOT_ROWS } from './mend.js';

/** @typedef {{ x: number, y: number, r: number, sx: number, sy: number, tool: 'Heal' | 'Clone' | 'Remove', feather: number, opacity: number }} Spot
 * its centre and radius, its source's centre (mask units); feather and opacity 0..1 */
export const MOST = SPOTS, ROWS = SPOT_ROWS, FLOATS = MOST * ROWS * 4;
const RING = 16, OUT = 1.2;   // the samples round a spot that say what surrounds it, and how far out they sit (in radii)

/** The mean of the editing copy's three colours around a sensor position (a 3 × 3 of its pixels). */
function around(/** @type {{ proxy: Uint16Array, width: number, height: number }} */ img, /** @type {number} */ cell, /** @type {number} */ sx, /** @type {number} */ sy) {
  const { proxy: d, width: w, height: h } = img, x0 = Math.round(sx / cell - 0.5), y0 = Math.round(sy / cell - 0.5), s = [0, 0, 0];
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return s;
}
/** How a source's surroundings differ from the spot's own: for each colour, the stops to add at the centre and
 * across and down the spot (a tilted plane, fitted to the ring), and how badly even that fits (the texture that
 * differs). @param {number[]} c the spot's centre on the sensor @param {number} r @param {number[]} o the way to the source */
function fit(/** @type {any} */ img, /** @type {number} */ cell, c, r, o) {
  const rows = [], n = RING; let miss = 0;
  const L = [0, 1, 2].map(() => new Float64Array(n));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, x = c[0] + OUT * r * Math.cos(a), y = c[1] + OUT * r * Math.sin(a), d = around(img, cell, x, y), s = around(img, cell, x + o[0], y + o[1]);
    for (let ch = 0; ch < 3; ch++) L[ch][k] = Math.log2((d[ch] + 64) / (s[ch] + 64));
  }
  for (let ch = 0; ch < 3; ch++) {
    let a = 0, b = 0, cc = 0;
    for (let k = 0; k < n; k++) { const t = (k / n) * 2 * Math.PI; a += L[ch][k] / n; b += (L[ch][k] * Math.cos(t) * 2) / n / OUT; cc += (L[ch][k] * Math.sin(t) * 2) / n / OUT; }
    for (let k = 0; k < n; k++) { const t = (k / n) * 2 * Math.PI; miss += (L[ch][k] - a - OUT * (b * Math.cos(t) + cc * Math.sin(t))) ** 2; }
    rows.push([Math.max(-2, Math.min(2, a)), Math.max(-1, Math.min(1, b)), Math.max(-1, Math.min(1, cc)), 0]);
  }
  return { rows, miss: miss / n, lift: Math.abs(rows[1][0]) };
}
/** A spot on the sensor: its centre, its radius, and the way to its source in whole patterns. @param {Spot} s @param {import('./warp.js').Geo} g */
function placed(s, g) {
  const uw = g.rot % 2 ? g.H : g.W, c = fromUpright(g, s.x * uw, s.y * uw), e = fromUpright(g, (s.x + s.r) * uw, s.y * uw), src = fromUpright(g, s.sx * uw, s.sy * uw);
  return { c, r: Math.max(2, Math.hypot(e[0] - c[0], e[1] - c[1])), o: [Math.round((src[0] - c[0]) / 6) * 6, Math.round((src[1] - c[1]) / 6) * 6] };
}

/** The spots as the passes carry them, five rows each: centre and radius on the sensor, feather · the way to the
 * source, opacity · then for red, green and blue the stops to add (at the centre, across, down). Null for none.
 * @param {Spot[] | null | undefined} spots @param {import('./warp.js').Geo} g @param {{ proxy: Uint16Array, width: number, height: number }} img the editing copy */
export function spotRows(spots, g, img) {
  if (!spots?.length) return null;
  const live = spots.slice(0, MOST), out = new Float32Array(4 + FLOATS), cell = g.W / img.width;
  out[0] = live.length;
  live.forEach((s, k) => {
    const p = placed(s, g), f = s.tool === 'Clone' ? [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] : fit(img, cell, p.c, p.r, p.o).rows;
    out.set([p.c[0], p.c[1], p.r, 0.02 + 0.6 * Math.min(1, Math.max(0, s.feather)),   // the outer share of the radius that fades out: at most 0.62, so the middle is always fully replaced
       p.o[0], p.o[1], Math.min(1, Math.max(0, s.opacity)), 0, ...f.flat()], 4 + k * ROWS * 4);
  });
  return out;
}
/** Where to take a spot's replacement from: the place nearby whose surroundings are most like the spot's own once
 * brightness and colour are allowed for, nearer and less changed winning a tie. Returns its centre in mask units.
 * @param {{ x: number, y: number, r: number }} s @param {import('./warp.js').Geo} g @param {any} img @param {boolean} [wide] look further out too (Remove) */
export function findSource(s, g, img, wide = false) {
  const uw = g.rot % 2 ? g.H : g.W, uh = g.rot % 2 ? g.W : g.H, cell = g.W / img.width, tall = uh / uw;
  let best = [s.x + 2.4 * s.r, s.y], least = Infinity;
  for (const far of wide ? [2.3, 3.2, 4.5] : [2.3, 3.2]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI, sx = s.x + far * s.r * Math.cos(a), sy = s.y + far * s.r * Math.sin(a);
    if (sx < s.r || sy < s.r || sx > 1 - s.r || sy > tall - s.r) continue;
    const p = placed({ ...s, sx, sy, tool: 'Heal', feather: 0.5, opacity: 1 }, g), f = fit(img, cell, p.c, p.r, p.o), score = f.miss + 0.02 * f.lift + 0.002 * far;
    if (score < least) { least = score; best = [sx, sy]; }
  }
  return best;
}
