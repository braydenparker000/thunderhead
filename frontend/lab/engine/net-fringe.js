// @ts-check
// The lens's colour fringing, undone before the network sees the sensor (AUDIT.md 3.1). A lens draws red and blue a
// hair larger or smaller than green, more so towards the corners, so a red site records the red of a place a little
// way from its own. Given those readings as they are, the network compares the wrong places when it works out
// colour, and undoing the fringing after it (the lens pass) leaves rims of false colour on every hard edge towards
// the frame's sides: measured on real files, two to seven times the usual demosaic's colour speckle there. So, as
// demosaic.js does in its first look (`lead`, `trust`), each red and blue site is given the value its own colour has
// at that site's place: read from the sites of that colour round where the lens drew it, each carried over by its
// ratio to green (so detail is not lost to the spacing of the sparse colours), and the network is told how much
// that averaging lowered the site's noise. Near the centre, where the spread is under half a pixel, a site keeps
// mostly its own reading, as in demosaic.js. Green is never moved: the lens pass is told the picture is aligned.

/** The uniform's part (after the spots): the lens's centre, 15 / its reach, on (1) or off (0); then its table. */
export const FRINGE_FLOATS = 4 + 64;

/** Writes the fringing into the uniform at `at` (floats). @param {Float32Array} f @param {number} at
 * @param {{ centre: number[], reach: number, table: Float32Array } | null | undefined} fringe lens.js `fringeOf` */
export function packFringe(f, at, fringe) {
  if (!fringe) { f.fill(0, at, at + FRINGE_FLOATS); return; }
  f.set([...fringe.centre, 15 / fringe.reach, 1], at); f.set(fringe.table, at + 4);
}

/** WGSL, after `raw`, `colour` and the uniform `d` (with `cen` and `ca`). `site(q)`: a site's value at its own
 * place, and the factor its noise is lowered by. */
export const fringeWGSL = /* wgsl */ `
fn lead(x: vec2f, k: u32) -> vec2f {
  let v = x - d.cen.xy; let t = min(length(v) * d.cen.z, 15.0); let j = min(u32(t), 14u); let a = mix(d.ca[j], d.ca[j + 1u], t - f32(j));
  return v * select(a.x, a.y, k == 2u);
}
// green at a site: its own reading, or the green sites round it (every 3 x 3 has some), those beside it four times
// those across a corner (measured on the known picture: 0.6 dB of colour at the edges over a plain mean)
fn greenOf(q: vec2i) -> f32 {
  if (colour(q) == 1u) { return raw(q); }
  var s = 0.0; var n = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let a = q + vec2i(i, j); if (colour(a) == 1u) { let w = select(0.25, 1.0, i == 0 || j == 0); s += raw(a) * w; n += w; } } }
  return s / max(n, 1.0);
}
fn greenAtF(p: vec2f) -> f32 {
  let b = vec2i(floor(p)); let f = p - floor(p);
  return mix(mix(greenOf(b), greenOf(b + vec2i(1, 0)), f.x), mix(greenOf(b + vec2i(0, 1)), greenOf(b + vec2i(1, 1)), f.x), f.y);
}
fn site(q: vec2i) -> vec2f {
  let k = colour(q); let own = raw(q);
  if (d.cen.w == 0.0 || k == 1u) { return vec2f(own, 1.0); }
  let dk = lead(vec2f(q), k); let trust = clamp(1.0 - 2.0 * length(dk), 0.0, 1.0);
  if (trust >= 1.0) { return vec2f(own, 1.0); }
  // the sites of this colour round where the lens drew this site's place, each by its ratio to green where it belongs
  let p = vec2f(q) + dk; let base = vec2i(round(p)); let gq = greenOf(q);
  var s = 0.0; var w = 0.0; var w2 = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let a = base + vec2i(i, j); if (colour(a) != k) { continue; }
    let o = vec2f(a) - p; let wt = exp(-dot(o, o));
    s += raw(a) * (1e-4 + gq) / (1e-4 + greenAtF(vec2f(a) - dk)) * wt; w += wt; w2 += wt * wt;
  } }
  if (w <= 0.0) { return vec2f(own, 1.0); }
  let moved = clamp(s / w, 0.0, 1.0); let nf = sqrt(w2) / w;
  return vec2f(mix(moved, own, trust), mix(nf, 1.0, trust));
}`;
