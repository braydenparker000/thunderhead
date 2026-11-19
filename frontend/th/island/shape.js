// @ts-check
// The island's one surface (HOME §12.1): capsule, card and app are one shape, clipped, on one spring; content melts.
import { animator, motionReduced, springs, spring, response } from '../motion.js';
import { timed } from '../../ui/feel/log.js';
import { st } from './island.js';
export const clamp = (/** @type {number} */ n) => Math.max(0, Math.min(1, n));
const mix = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ p) => a + (b - a) * p;
export const token = (/** @type {string} */ name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const ms = (/** @type {string} */ name) => { const v = token(`--d-${name}`); return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000); };
/** Each movement starts here, named for the feel report (ui/feel/log.js). @param {string} name @param {ReturnType<typeof animator>} a @param {number} to @param {object} [o] */
export const go = (name, a, to, o) => { a.to(to, o); timed(name, a, to); };
// The owner's island spring: growing overshoots about 4%, shrinking never.
export const grow = () => spring({ stiffness: springs.island.stiffness, damping: springs.island.damping - .1 });
export const settle = () => spring({ stiffness: springs.island.stiffness * 1.4, damping: 1 });

/** [x, y, width, height, radius] as a clip-path with Figma's corner smoothing (.6): continuous corners, round pill
 * ends. @param {number[]} q */
function outline([x, y, w, h, r]) {
  const m = Math.max(0, Math.min(w, h) / 2), R = Math.max(0, Math.min(r, m)), p = Math.min(1.6 * R, m), s = R ? Math.max(0, Math.min(.6, m / R - 1)) : 0;
  const L = Math.sin(Math.PI / 4 * (1 - s)) * R * Math.SQRT2, c = R * Math.tan(Math.PI * s / 8) * Math.cos(Math.PI * s / 4), d = c * Math.tan(Math.PI * s / 4), b = (p - L - c - d) / 3, a = 2 * b;
  const n = (/** @type {number} */ v) => +v.toFixed(2), at = [x + w - p, y, x + w, y + h - p, x + p, y + h, x, y + p];
  let path = '';
  for (let k = 0; k < 4; k++) {
    const turn = (/** @type {number[]} */ v) => v.map((_, i) => { let u = v[i & 6], z = v[i | 1]; for (let j = 0; j < k; j++) [u, z] = [-z, u]; return n(i & 1 ? z : u); }).join(' ');
    path += `${k ? 'L' : 'M'}${n(at[2 * k])} ${n(at[2 * k + 1])}c${turn([a, 0, a + b, 0, a + b + c, d])}a${n(R)} ${n(R)} 0 0 1 ${turn([L, L])}c${turn([d, c, d, b + c, d, a + b + c])}`;
  }
  return `path('${path}Z')`;
}

/** Art, progress line, compact and expanded groups, inner fill. @type {HTMLElement[]} */
export const movers = [];
export const size = { w: 124, r: 18 };
const W = () => Math.min(360, innerWidth - 24);
let lifted = false, melted = '', top = 10, ends = { a: [0, 0, 0, 0, 0], i: [0, 0, 0, 0, 0] }, isle = [0, 0, 124, 36, 18];
/** @type {number[]|null} */
let cov = null;
/** 0 compact, 1 expanded (reduced motion: the shape snaps, what is inside fades in 150 ms). */
export const shape = animator(paint, { unit: 'opacity' });
export const alertWidth = animator(paint);
export const artOn = animator(paint, { unit: 'scalar' });
/** Scale in thousandths (a press, a breath) and a sideways nudge in px (a skip). */
export const pulse = animator(v => { if (st.island) st.island.style.scale = v ? String(1 + v / 1000) : ''; });
export const nudge = animator(v => { if (st.island) st.island.style.translate = v ? `${v}px 0` : ''; });
/** An impulse on springs.pop peaking at `peak`. @param {ReturnType<typeof animator>} a @param {number} peak @param {string} name */
export function kick(a, peak, name) {
  let most = 0;
  for (let t = 0; t < .5; t += .002) most = Math.max(most, response(springs.pop, t, 0, 1, 0).value);
  go(name, a, 0, { spring: springs.pop, velocity: peak / most });
}
function hull(p = motionReduced() ? +st.expanded : shape.value) {
  const w = mix(size.w + alertWidth.value, W(), p);
  return [(innerWidth - w) / 2, 0, w, mix(36, 180, p), mix(size.r, 28, p)];
}
/** The shared artwork (x, y, scale of 72 px, radius): from the 24 px lobe (22 px dot) to the 72 px art. */
function artAt(/** @type {number} */ p) {
  const a = clamp(artOn.value), from = 22 + 2 * a, at = (36 - from) / 2;
  return [mix((innerWidth - size.w - alertWidth.value) / 2 + at, (innerWidth - W()) / 2 + 16, p), mix(at, 38, p), mix(from, 72, p) / 72, mix(mix(from / 2, 7, a), 16, p)];
}
export function box() { const q = hull(); q[1] += top = st.island?.offsetTop || top; return q; }
/** Draws the island at the shape's value: outline, hairline, artwork, progress line, content. */
export function paint() {
  const is = st.island;
  if (!is || lifted) return;
  const v = shape.value, q = hull(), p = (q[3] - 36) / 144, [art, line, compact, , fill] = movers, [x, y, k, r] = artAt(p);
  is.style.clipPath = outline(q);
  fill.style.clipPath = outline([q[0] + 1, 1, q[2] - 2, q[3] - 2, q[4] - 1]);
  art.style.transform = `translate(${x}px,${y}px) scale(${k})`;
  art.style.borderRadius = `${r / k}px`;
  line.style.transform = `translateY(${mix(33, 124, p)}px) scale(${(q[2] - 32) / (W() - 32)},${(2 + clamp(p)) / 3})`;
  compact.style.translate = alertWidth.value ? `${-alertWidth.value / 2}px 0` : '';
  // Compact content leaves by 45%; details arrive from 30%.
  const e = clamp(v / .45), a = clamp((v - .3) / .7), b = motionReduced() ? 0 : 1;
  if (`${e}${a}` === melted) return;
  melted = `${e}${a}`;
  fade(compact, 1 - e, 1 - .25 * e * b, 5 * e * b);
  fade(movers[3], a, 1 - .08 * (1 - a) * b, 5 * (1 - a) * b);
  art.style.setProperty('--details', String(a)); line.style.setProperty('--details', String(a));
}
/** @param {HTMLElement} n @param {number} o @param {number} s @param {number} b */
function fade(n, o, s, b) {
  const t = n.style;
  t.opacity = String(o);
  t.transform = o && s < 1 ? `scale(${s})` : '';
  t.filter = o && b > .1 ? `blur(${b.toFixed(1)}px)` : '';
}

const along = (/** @type {number} */ p) => ends.a.map((n, k) => mix(n, ends.i[k], clamp(p)));
export const morph = animator(v => { if (st.layer) surface(st.layer, along(v), v); }, { unit: 'opacity' });
/** Sends the app's surface into the island (1) or full screen (0) from where it is (or `from`, where a drag left it
 * at `speed`, px/s), its speed in size carried on. @param {number} to @param {number[]} [from] @param {number[]} [speed] @param {string} [name]
 */
export function aim(to, from, speed, name = to ? 'island:close-app' : 'island:open-app') {
  const l = st.layer;
  if (!l) return;
  const F = [0, 0, innerWidth, innerHeight, 0], I = box(), now = from ?? (morph.resting ? (morph.value ? I : F) : along(morph.value)), v = speed ?? ends.a.map((n, k) => (ends.i[k] - n) * morph.velocity);
  // The app's cover, where the artwork travels.
  cov = null;
  try { for (const n of l.frame.contentDocument?.querySelectorAll(l.id === 'music' ? '.art' : '#player-art') ?? []) { const c = n.getBoundingClientRect(); if (c.width > (cov?.[2] ?? 40)) cov = [c.x, c.y, c.width, parseFloat(getComputedStyle(n).borderRadius) || 0]; } } catch {}
  ends = to ? { a: now, i: I } : { a: F, i: now }; isle = I;
  const [, , pw, ph] = to ? I.map((n, k) => n - now[k]) : now.map((n, k) => n - F[k]), len = pw * pw + ph * ph;
  morph.set(1 - to);
  go(name, morph, to, { spring: to ? settle() : grow(), velocity: len > 1 ? (pw * v[2] + ph * v[3]) / len : 0 });
}
/** The app's surface at rect C, the app zoomed in it; near the island its own content takes over. Reduced
 * motion: a 150 ms cross-fade (p). @param {import('./frames.js').Layer} l @param {number[]} C @param {number} p
 */
export function surface(l, C, p) {
  const s = l.shell.style, f = l.frame.style, is = st.island, k = C[2] / innerWidth;
  if (motionReduced()) { s.clipPath = f.transform = f.opacity = ''; s.opacity = String(1 - clamp(p)); if (is) is.style.opacity = String(clamp(p)); return; }
  // 0 at the island, 1 at the full screen, by size.
  const u = clamp((C[2] + C[3] - isle[2] - isle[3]) / (innerWidth + innerHeight - isle[2] - isle[3])), o = clamp((u - .08) / .5), e = clamp(1 - u / .5), full = u > .999;
  s.opacity = '';
  s.clipPath = full ? '' : outline(C);
  f.transform = full ? '' : `translate(${C[0]}px,${C[1]}px) scale(${k})`;
  f.opacity = o < 1 ? String(o) : '';
  if (!is) return;
  is.style.opacity = '';
  if (lifted !== u > .001) {
    is.classList.toggle('lift', lifted = !lifted);
    if (!lifted) { melted = ''; for (const n of movers) n.style.opacity = ''; paint(); }
  }
  if (!lifted) return;
  const [art, line, compact, details] = movers, [x, y, z, r] = artAt(clamp(shape.value));
  fade(st.expanded ? details : compact, e, .7 + .3 * e, 6 * (1 - e));
  fade(st.expanded ? compact : details, 0, 1, 0);
  line.style.opacity = String(e);
  art.style.opacity = String(e);
  if (cov && art.classList.contains('has-art')) {
    const S = mix(z, k * cov[2] / 72, u);
    art.style.transform = `translate(${mix(x, C[0] + k * cov[0], u)}px,${mix(y, C[1] + k * cov[1] - top, u)}px) scale(${S})`;
    art.style.borderRadius = `${mix(r, k * cov[3], u) / S}px`;
    art.style.opacity = String(1 - o);
  }
}

let ghosts = /** @type {HTMLElement[]} */ ([]), reals = ghosts, far = 0, from = 0;
/** A song change, 0 to 1: the old title and art (copies) leave, the new arrive. */
const swap = animator(q => {
  const done = swap.resting && q === 1;
  for (const g of ghosts) { g.style.translate = `${from - far * 1.6 * q}px 0`; g.style.opacity = String(1 - clamp(q / .6)); if (done) g.remove(); }
  for (const n of reals) { n.style.translate = done ? '' : `${far * (1 - q)}px 0`; n.style.opacity = done ? '' : String(clamp(q / .6)); }
}, { unit: 'opacity' });
/** A song change (`dir` 1 next), before its title is written: title and art slide out one way, from where a swipe
 * left them (`at` px), and in from the other; the capsule nudges. @param {number} dir @param {number} [at]
 */
export function slide(dir, at = 0) {
  const is = st.island, r = motionReduced();
  if (!is) return;
  for (const g of ghosts) g.remove();
  ghosts = []; far = r ? 0 : 28 * dir; from = at;
  reals = /** @type {HTMLElement[]} */ ([...is.querySelectorAll('.title,.heading,.art')]);
  for (const n of reals) {
    const g = /** @type {HTMLElement} */ (n.cloneNode(true));
    g.classList.add('ghost'); g.inert = true;
    g.querySelector('canvas')?.getContext('2d')?.drawImage(/** @type {HTMLCanvasElement} */ (n.firstChild), 0, 0);
    n.after(g); ghosts.push(g);
  }
  swap.set(0);
  go('island:skip', swap, 1, { spring: springs.page });
  if (!r) kick(nudge, -4 * dir, 'island:skip');
}
export const whenResting = () => Promise.all([shape, alertWidth, artOn, pulse, nudge, morph, swap].map(a => a.whenResting())).then(() => {});
