// @ts-check
// Masks: adjustments that reach only part of the picture. A mask says how much of itself each place gets (0..1):
// a linear or a radial gradient laid on the picture, or a range of colour or of brightness picked from it. Its
// own adjustments are then added to the photo's, pixel by pixel, in the frame pass (wgsl.js `main`), so they
// cost one sum a mask and are the same at every zoom and in the export.
//
// A mask's shape lives in the upright, uncropped picture, in units of its width (x 0..1, y 0..height/width):
// crop, straighten or turn the photo and the mask stays on what it was laid on.

/** @typedef {{ kind: 'Linear' | 'Radial' | 'Color' | 'Luminance' | 'Brush', n: number, vals: Record<string, number>, invert: boolean,
 *   a?: number[] | null, pick?: number[] | null }} Mask
 * `a`: a linear gradient's two points (in full at the first, gone by the second), or a radial's centre and radii;
 * `pick`: the colour (two numbers) or brightness (one) a range mask was given by a tap. */
export const MOST = 8, ROWS = 7, FLOATS = 16 + MOST * ROWS * 4;
const KIND = { Brush: 1, Linear: 2, Radial: 3, Color: 4, Luminance: 5 };

const mul = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]));
function inverse(/** @type {number[]} */ m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}
/** The 3 × 3 from a place in the picture as shown (0..1 across and down it) to mask units (warp.js `toSensor`,
 * up to the lens). @param {ReturnType<typeof import('./warp.js').geometry>} g */
export function toMask(g) {
  const uw = g.rot % 2 ? g.H : g.W, s = g.cos;
  return mul([1 / uw, 0, 0, 0, 1 / uw, 0, 0, 0, 1], mul(Array.from(g.h), [g.ow * s, 0, g.cx - (g.ow * s) / 2, 0, g.oh * s, g.cy - (g.oh * s) / 2, 0, 0, 1]));
}
/** A point through a 3 × 3. @param {number[]} m @param {number} x @param {number} y */
export const through = (m, x, y) => { const q = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / q, (m[3] * x + m[4] * y + m[5]) / q]; };
/** Mask units back to a place in the picture as shown. @param {ReturnType<typeof import('./warp.js').geometry>} g */
export const fromMask = (g) => inverse(toMask(g));

/** A colour as the masks see it: Oklab lightness (0..1), then its colour as a share of that lightness, which stays
 * the same however bright the thing is. The same maths as the shader's `lab`. @param {number[]} c linear ProPhoto */
export function toneOf(c) {
  const q = [0.7153289 * c[0] + 0.3529082 * c[1] - 0.0682371 * c[2], 0.2743544 * c[0] + 0.6678509 * c[1] + 0.0577947 * c[2], 0.1097542 * c[0] + 0.1862089 * c[1] + 0.704037 * c[2]].map(Math.cbrt);
  const l = 0.2104543 * q[0] + 0.7936178 * q[1] - 0.004072 * q[2], a = 1.9779985 * q[0] - 2.4285922 * q[1] + 0.4505937 * q[2], b = 0.025904 * q[0] + 0.7827718 * q[1] - 0.8086758 * q[2];
  return [Math.max(0, Math.min(1, l)), a / Math.max(l, 1e-4), b / Math.max(l, 1e-4)];
}

/** The masks as the frame's settings carry them: the 3 × 3 to mask units, how many there are and which one to
 * show in red, then seven rows a mask. Null when there are none.
 * @param {Mask[] | null | undefined} masks @param {ReturnType<typeof import('./warp.js').geometry>} g
 * @param {number} show the mask to lay red over the picture (−1: none) @param {number} base the stops the range masks read brightness at */
export function localRows(masks, g, show, base) {
  if (!masks?.length) return null;
  const out = new Float32Array(FLOATS), h = toMask(g), live = masks.slice(0, MOST);
  out.set([h[0], h[1], h[2], 0, h[3], h[4], h[5], 0, h[6], h[7], h[8], 0, live.length, show + 1, base, 0]);
  live.forEach((m, k) => {
    const v = (/** @type {string} */ n, d = 0) => m.vals[n] ?? d, f = v('Feather', 50) / 100, range = v('Range', 30) / 100, o = 16 + k * ROWS * 4, a = m.a, p = m.pick;
    let kind = 0, s = [0, 0, 0, 0], e = [0, 0, 0, 0];
    if (m.kind === 'Linear' && a) { kind = KIND.Linear; s = a.slice(0, 4); e = [f, 0, 0, 0]; }
    else if (m.kind === 'Radial' && a) { kind = KIND.Radial; s = a.slice(0, 4); e = [1, 0, f, 0]; }
    else if (m.kind === 'Color' && p) { kind = KIND.Color; s = [p[0], p[1], 0.01 + 0.3 * range * range, f]; }   // colours sit close together in these units: the dial's low end is fine
    else if (m.kind === 'Luminance' && p) { kind = KIND.Luminance; s = [p[0], 0.03 + 0.5 * range, f, 0]; }
    const temp = v('Temp') / 100, tint = v('Tint') / 100;
    out.set([kind, v('Amount', 100) / 100, m.invert ? 1 : 0, 0, ...s, ...e,
      v('Exposure'), (v('Contrast') / 100) * 0.6, v('Highlights') / 100, v('Shadows') / 100,
      v('Whites') / 100, v('Blacks') / 100, v('Saturation') / 100, (v('Hue') / 100) * Math.PI,
      0.35 * temp + 0.1 * tint, -0.2 * tint, -0.35 * temp + 0.1 * tint, 0,
      v('Texture') / 100, v('Clarity') / 100, v('Dehaze') / 100, 0], o);
  });
  return out;
}

/** The masks' part of the frame's shader (wgsl.js puts it before `main`; `lab` is grade.js's). */
export const LOCAL = /* wgsl */ `
// What the masks add at one place: exposure, contrast, highlights, shadows · whites, blacks, saturation, hue ·
// white balance (stops on each colour) · texture, clarity, dehaze · and how much of the mask being shown is here.
struct Local { a: vec4f, b: vec4f, wb: vec3f, fx: vec3f, show: f32 }
// How much of mask k a place gets. q: the place in mask units; tone: its lightness and its colour as local.js's toneOf gives them.
fn weigh(k: u32, q: vec2f, tone: vec3f) -> f32 {
  let r = p.mk[k * 7u]; let s = p.mk[k * 7u + 1u]; let e = p.mk[k * 7u + 2u]; var w = 0.0;
  switch (u32(r.x)) {
    case 2u: { let d = s.zw - s.xy; let t = dot(q - s.xy, d) / max(dot(d, d), 1e-9); w = 1.0 - smoothstep(0.5 - 0.5 * e.x, 0.5 + 0.5 * e.x + 1e-4, t); }
    case 3u: { let v = q - s.xy; let d = vec2f(v.x * e.x + v.y * e.y, v.y * e.x - v.x * e.y) / max(s.zw, vec2f(1e-5)); w = 1.0 - smoothstep(1.0 - e.z, 1.0001, length(d)); }
    case 4u: { w = 1.0 - smoothstep(s.z * (1.0 - s.w), s.z * 1.0001, distance(tone.yz, s.xy)); }
    case 5u: { w = 1.0 - smoothstep(s.y * (1.0 - s.z), s.y * 1.0001, abs(tone.x - s.x)); }
    default: { return 0.0; }
  }
  return mix(w, 1.0 - w, r.z) * r.y;
}
fn locals(spot: vec2f, c: vec3f) -> Local {
  var o = Local(vec4f(0.0), vec4f(0.0), vec3f(0.0), vec3f(0.0), 0.0);
  let h = vec3f(dot(p.mh[0].xyz, vec3f(spot, 1.0)), dot(p.mh[1].xyz, vec3f(spot, 1.0)), dot(p.mh[2].xyz, vec3f(spot, 1.0)));
  let v = lab(c * exp2(p.mi.z)); let tone = vec3f(clamp(v.x, 0.0, 1.0), v.yz / max(v.x, 1e-4));
  for (var k = 0u; k < u32(p.mi.x); k++) {
    let w = weigh(k, h.xy / h.z, tone);
    if (f32(k) + 1.0 == p.mi.y) { o.show = w; }
    if (w <= 0.0) { continue; }
    o.a += w * p.mk[k * 7u + 3u]; o.b += w * p.mk[k * 7u + 4u]; o.wb += w * p.mk[k * 7u + 5u].xyz; o.fx += w * p.mk[k * 7u + 6u].xyz;
  }
  return o;
}
// The masks' own saturation and hue, in Oklab: the colour turned round its lightness and made stronger or weaker.
fn tinted(c: vec3f, sat: f32, hue: f32) -> vec3f {
  let v = lab(c); let co = cos(hue); let si = sin(hue);
  return unlab(vec3f(v.x, vec2f(v.y * co - v.z * si, v.y * si + v.z * co) * max(1.0 + sat, 0.0)));
}`;
