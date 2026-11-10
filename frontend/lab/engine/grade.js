// @ts-check
// The colour tools that live inside the colour table (wgsl.js, develop): the mixer's eight colours, grading's
// four wheels, and the point curve. This turns what the boards hold into the rows the frame's settings carry.
// None of them costs anything per frame: they are baked into the table with the look and the tone curve.

export const COLOURS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
export const ZONES = ['Shadows', 'Midtones', 'Highlights', 'Global'];
/** Their adjustments and where each starts: "Mix Red Hue" … (−100..100), "Grade Shadows Hue" (0..360), "… Sat"
 * (0..100), "… Lum" (−100..100), Blending (0..100) and Balance (−100..100). */
export const START = /** @type {Record<string, number>} */ ({ Blending: 50, Balance: 0 });
for (const c of COLOURS) for (const a of ['Hue', 'Sat', 'Lum']) START[`Mix ${c} ${a}`] = 0;
for (const z of ZONES) for (const a of ['Hue', 'Sat', 'Lum']) START[`Grade ${z} ${a}`] = 0;

/** The mixer's rows (hue, saturation, brightness for each colour, −1..1), or null when nothing is set. @param {Record<string, number>} v */
export function mixerRows(v) {
  const out = new Float32Array(32);
  COLOURS.forEach((c, i) => out.set([(v[`Mix ${c} Hue`] || 0) / 100, (v[`Mix ${c} Sat`] || 0) / 100, (v[`Mix ${c} Lum`] || 0) / 100, 0], i * 4));
  return out.some((x) => x !== 0) ? out : null;
}
/** A wheel's hue (degrees, as the wheel shows it: 0 red, 120 green, 240 blue) as a direction in Oklab's colour plane. */
function towards(/** @type {number} */ deg) {
  const h = ((deg % 360) + 360) % 360, x = 1 - Math.abs(((h / 60) % 2) - 1), rgb = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h / 60) % 6];
  const [r, g, b] = rgb, l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, n = Math.hypot(A, B) || 1;
  return [A / n, B / n];
}
/** Grading's rows: for shadows, midtones, highlights and the whole, the tint as a step in Oklab's colour plane
 * and the brightness in stops; then blending (0..1) and balance (−1..1). Null when nothing is set. @param {Record<string, number>} v */
export function gradeRows(v) {
  const out = new Float32Array(20);
  ZONES.forEach((z, i) => { const [a, b] = towards(v[`Grade ${z} Hue`] || 0), s = ((v[`Grade ${z} Sat`] || 0) / 100) * 0.08; out.set([a * s, b * s, ((v[`Grade ${z} Lum`] || 0) / 100) * 0.6, 0], i * 4); });
  if (!out.some((x) => x !== 0)) return null;
  out.set([(v.Blending ?? 50) / 100, (v.Balance || 0) / 100, 0, 0], 16);
  return out;
}

/** @typedef {Record<string, number[][]>} Curves the point curve: for RGB (all three) and for R, G and B, points from (0, 0) to (1, 1) */
const SAMPLES = 128;
/** The curve through a channel's points at x: the monotone cubic the board draws. */
function through(/** @type {number[][]} */ pts, /** @type {number} */ x) {
  const n = pts.length, dk = [], m = [];
  for (let i = 0; i < n - 1; i++) dk.push((pts[i + 1][1] - pts[i][1]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
  for (let i = 0; i < n; i++) m.push(i === 0 ? dk[0] : i === n - 1 ? dk[n - 2] : dk[i - 1] * dk[i] <= 0 ? 0 : (dk[i - 1] + dk[i]) / 2);
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < n - 1; i++) if (x <= pts[i + 1][0]) {
    const h = pts[i + 1][0] - pts[i][0], t = (x - pts[i][0]) / (h || 1), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1];
  }
  return pts[n - 1][1];
}
const straight = (/** @type {number[][] | undefined} */ p) => !p || (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1);
/** The curves as a table: 128 steps, each all three channels' curve then red's, green's and blue's. Null when all are straight. @param {Curves | null | undefined} c */
export function curveRows(c) {
  if (!c || ['RGB', 'R', 'G', 'B'].every((k) => straight(c[k]))) return null;
  const out = new Float32Array(SAMPLES * 4);
  ['RGB', 'R', 'G', 'B'].forEach((k, j) => { for (let i = 0; i < SAMPLES; i++) { const x = i / (SAMPLES - 1); out[i * 4 + j] = straight(c[k]) ? x : Math.max(0, Math.min(1, through(c[k], x))); } });
  return out;
}

/** Their part of the colour table's shader (wgsl.js puts it before `develop`, which calls mixer, grade and point). */
export const TOOLS = /* wgsl */ `
// Oklab from linear ProPhoto and back (Björn Ottosson's; the matrices are his, moved to ProPhoto).
fn lab(c: vec3f) -> vec3f {
  let q = vec3f(dot(c, vec3f(0.7153289, 0.3529082, -0.0682371)), dot(c, vec3f(0.2743544, 0.6678509, 0.0577947)), dot(c, vec3f(0.1097542, 0.1862089, 0.7040370)));
  let r = sign(q) * pow(abs(q), vec3f(1.0 / 3.0));
  return vec3f(dot(r, vec3f(0.2104543, 0.7936178, -0.0040720)), dot(r, vec3f(1.9779985, -2.4285922, 0.4505937)), dot(r, vec3f(0.0259040, 0.7827718, -0.8086758)));
}
fn unlab(v: vec3f) -> vec3f {
  let r = vec3f(v.x + 0.3963378 * v.y + 0.2158038 * v.z, v.x - 0.1055613 * v.y - 0.0638542 * v.z, v.x - 0.0894842 * v.y - 1.2914855 * v.z); let m = r * r * r;
  return max(vec3f(dot(m, vec3f(1.7387399, -0.9884013, 0.2496614)), dot(m, vec3f(-0.7070029, 1.9343162, -0.2273134)), dot(m, vec3f(-0.0840634, -0.3575177, 1.4415810))), vec3f(0.0));
}
// The colour mixer: eight colours round the hue circle (where sRGB's red, orange, yellow, green, aqua, blue,
// purple and magenta sit in Oklab), each with a hue shift, a saturation and a brightness. A colour between
// two of them takes a share of each; greys are left alone.
const HUES = array<f32, 8>(0.510, 1.012, 1.917, 2.487, 3.400, 4.609, 5.236, 5.731);
fn mixer(c: vec3f) -> vec3f {
  var v = lab(c); let ch = length(v.yz);
  if (ch < 1e-5) { return c; }
  var h = atan2(v.z, v.y); if (h < HUES[0]) { h += 6.2831853; }
  var i = 7u; for (var k = 0u; k < 7u; k++) { if (h < HUES[k + 1u]) { i = k; break; } }
  let j = (i + 1u) % 8u; let span = select(HUES[j] - HUES[i], HUES[0] + 6.2831853 - HUES[7], i == 7u);
  let a = mix(p.mx[i], p.mx[j], smoothstep(0.0, 1.0, (h - HUES[i]) / span)).xyz * smoothstep(0.0, 0.04, ch);
  let turn = a.x * 0.5; let s = sin(turn); let co = cos(turn);
  v = vec3f(v.x * exp2(a.z * 0.6 * min(1.0, ch / 0.12)), vec2f(v.y * co - v.z * s, v.y * s + v.z * co) * (1.0 + a.y));
  return unlab(v);
}
// Colour grading: a tint and a change of brightness for the shadows, the midtones, the highlights and the whole.
// Balance moves where shadows end and highlights begin; blending is how far the three run into each other.
fn grade(c: vec3f) -> vec3f {
  var v = lab(c); let l = pow(clamp(v.x, 0.0, 1.0), exp2(-p.gr[4].y)); let o = mix(0.12, 0.45, p.gr[4].x);
  let ws = 1.0 - smoothstep(0.33 - o, 0.33 + o, l); let wh = smoothstep(0.67 - o, 0.67 + o, l); let wm = max(1.0 - ws - wh, 0.0);
  let g = p.gr[0] * ws + p.gr[1] * wm + p.gr[2] * wh + p.gr[3];
  return unlab(vec3f(v.x * exp2(g.z * 0.5), v.yz + g.xy * (0.3 + 0.7 * clamp(v.x, 0.0, 1.0))));
}
// the point curve, on the finished value as the screen holds it: first the curve for all three channels, then the channel's own
fn point(x: f32, k: u32) -> f32 { let f = clamp(x, 0.0, 1.0) * 127.0; let i = u32(f); let j = min(i + 1u, 127u); return mix(p.crv[i][k], p.crv[j][k], f - f32(i)); }`;
