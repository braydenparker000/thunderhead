// @ts-check
// The GPU stage's shaders (gpu.js runs them): one pass per frame, and the pass that bakes the colour table.
/** The colour table's points per axis. */
import { TOOLS } from './grade.js';
import { LOCAL } from './local.js';

/** The frame's settings in bytes (struct P below). */
export const USIZE = 3632;

export const N = 65;
/** Editing-copy pixels per cell of the tone mask, each way (mask.js). */
export const CELL = 8;
/** What every pass starts from: the frame's settings, the editing copy, and one of its pixels as linear ProPhoto. */
export const HEAD = /* wgsl */ `
struct P { m0: vec4f, m1: vec4f, m2: vec4f, o0: vec4f, o1: vec4f, o2: vec4f, a0: vec4f, a1: vec4f, a2: vec4f, b0: vec4f, b1: vec4f, b2: vec4f,
  f: vec4f,      // ev, contrast, table amount, tone-mask pixels per pixel (1; a full-resolution view: 1/3)
  size: vec4u,   // w, h, rotation (0..3), flags (1 hsm, 2 look, 4 tone, 8 table, 16 hsm sRGB value, 32 look sRGB value,
                 // 64 no table, 128 second look, 256 its value is sRGB, 512 leave clipped highlights as they are, 1024 no dither,
                 // 2048 Highlights and Shadows by the pixel's own brightness (no tone mask), 4096 show the tone mask,
                 // two for the test page's stage timer: 8192 the table's nearest entry, 16384 no colour work,
                 // 32768 the mixer, 65536 grading, 131072 the point curve, 262144 a look's own table (cube.js),
                 // and 524288 for a full-size view: its fourth value out is 1 + the masks' sharpness here)
  hsm: vec4u, look: vec4u, tab: vec4u,     // dims h, s, v, offset · same · tone offset, table n, table offset, unused
  g: vec4f,      // highlights, shadows, whites, blacks (−1..1)
  k: vec4f,      // saturation, vibrance (−1..1), then where this frame's first pixel sits in the tone mask's photo (x, y)
  look2: vec4u,  // a look file's own table, after the profile's: dims h, s, v, offset
  wb: vec4f,     // the white balance as gains on camera R, G, B (green 1); then what the stored values are multiplied by (warp.js keeps room above them)
  chroma: vec4f, // the highlight rebuild's colour offsets, white-balanced (raw's chroma() × wb)
  fx: vec4f,     // clarity, texture, dehaze (−1..1), vignette (−1 darker corners .. 1 lighter)
  air: vec4f,    // the haze's own colour, for Dehaze (haze.js)
  sharp: vec4f,  // sharpening's amount, radius in pixels and detail (0..1): used by full-size views alone (finish.js); then grain (0..1)
  noise: vec4f,  // noise reduction, in multiples of the sensor's noise: brightness, colour (0: off): full-size views alone
                 // (denoise.js); then the picture's size in editing-copy pixels
  mx: array<vec4f, 8>,     // the colour mixer: hue, saturation and brightness for each of its eight colours (grade.js)
  gr: array<vec4f, 5>,     // colour grading: a tint and stops for shadows, midtones, highlights and the whole; then blending, balance
  crv: array<vec4f, 128>,  // the point curve: all three channels', then red's, green's, blue's, at 128 steps
  mh: array<vec4f, 3>, mi: vec4f, mk: array<vec4f, 56> };   // masks (local.js): the 3 × 3 from the picture to mask units · how many, the one shown, the stops range masks read at (then defringe, for finish.js) · seven rows a mask
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<uniform> p: P;
const CELL = ${CELL}u;
const LUM = vec3f(0.288, 0.712, 0.0);   // luminance of linear ProPhoto
const FLOOR = 1.0 / 16384.0;            // the darkest luminance a logarithm is taken of
fn mv(r0: vec4f, r1: vec4f, r2: vec4f, c: vec3f) -> vec3f { return vec3f(dot(r0.xyz, c), dot(r1.xyz, c), dot(r2.xyz, c)); }
// Blown highlights (after darktable's "inpaint opposed"): a colour the sensor clipped is rebuilt from the
// pixel's other two, white-balanced: the cube of their mean cube root, plus how far the photo's own colours
// near its clipped areas sit from that (raw's chroma(), fading as more colours clip). Only ever raised; with
// all three clipped they settle on neutral at the brightest. Without it a clipped sky turns pink: the green
// clips first, and the white balance then lifts red and blue above it.
fn est(a: f32, b: f32) -> f32 { let m = 0.5 * (pow(max(a, 0.0), 1.0 / 3.0) + pow(max(b, 0.0), 1.0 / 3.0)); return m * m * m; }
fn rebuild(raw: vec3f, bits: u32) -> vec3f {
  var x = raw * p.wb.xyz; let ch = p.chroma.xyz * (0.5 * f32(3u - countOneBits(bits)));
  for (var k = 0; k < 3; k++) {
    if ((bits & 2u) != 0u) { x.g = max(x.g, est(x.r, x.b) + ch.g); }
    if ((bits & 4u) != 0u) { x.b = max(x.b, est(x.r, x.g) + ch.b); }
    if ((bits & 1u) != 0u) { x.r = max(x.r, est(x.g, x.b) + ch.r); }
  }
  return x / p.wb.xyz;
}
// one pixel of the editing copy: clipped colours rebuilt, then the camera matrix
fn pixel(x: u32, y: u32) -> vec3f {
  let i = (y * p.size.x + x) * 2u; let rg = unpack2x16unorm(src[i]); let ba = unpack2x16unorm(src[i + 1u]);
  var raw = vec3f(rg.x, rg.y, ba.x) * p.wb.w; let bits = (src[i + 1u] >> 16u) & 7u;   // alpha: which colours clipped
  if (bits != 0u && (p.size.w & 512u) == 0u) { raw = rebuild(raw, bits); }
  return max(mv(p.m0, p.m1, p.m2, raw), vec3f(0.0));
}`;
export const DITHER = /* wgsl */ `
// Dither, against banding in skies: the screen holds 256 levels a channel, so each pixel gets a fixed
// triangular-spread offset of up to one level (the same on all three channels: no colour speckle), fading
// to none at pure black and white.
fn dither(o: vec3f, at: vec2u) -> vec3f {
  var s = at.x * 1664525u + at.y * 22695477u + 1013904223u; s = (s ^ (s >> 16u)) * 2246822519u; s = (s ^ (s >> 13u)) * 3266489917u; s = s ^ (s >> 16u);
  let n = (f32(s & 0xffffu) - f32(s >> 16u)) / 65536.0;
  return o + n * clamp(min(o, 1.0 - o) * 255.0, vec3f(0.0), vec3f(1.0)) / 255.0;
}`;
export const WGSL = /* wgsl */ `${HEAD}
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> t: array<f32>;
@group(0) @binding(4) var lutOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var lutIn: texture_3d<f32>;
@group(0) @binding(6) var mask: texture_2d<f32>;
@group(0) @binding(7) var fine: texture_2d<f32>;   // the finer mask, for Texture (mask.js)
@group(0) @binding(8) var haze: texture_2d<f32>;   // how much of the air's light each area holds, for Dehaze
const N = ${N}u;
// the 3D table's input: log2 of linear ProPhoto over 16 stops, 2^-12 to 2^4, so shadows get as many points as
// highlights: four cells a stop, with 1.0 (where the tone curve clips) on a point
fn shape(c: vec3f) -> vec3f { return clamp((log2(max(c, vec3f(1e-9))) + 12.0) / 16.0, vec3f(0.0), vec3f(1.0)); }
fn unshape(u: vec3f) -> vec3f { return exp2(u * 16.0 - 12.0); }
fn at(i: vec3u) -> vec3f { return textureLoad(lutIn, i, 0).rgb; }
// Reading the table: tetrahedral, not trilinear. Each cell is cut into six tetrahedra around its grey diagonal
// and a colour mixes only its own four corners, so greys mix only greys, and the creases the hue-preserving
// steps make where two channels are equal (r=g, g=b, b=r) lie on the cuts, not inside a cell.
fn lookup(c: vec3f) -> vec3f {
  let g = shape(c) * f32(N - 1u); let i = min(vec3u(g), vec3u(N - 2u)); let f = g - vec3f(i);
  let ge = step(f.yzx, f.xyz); let lt = 1.0 - ge;               // x≥y, y≥z, z≥x, and the opposites
  let hi = vec3u(ge * lt.zxy); let lo = vec3u(lt * ge.zxy);   // the axis with the largest fraction; the smallest
  let mx = max(f.x, max(f.y, f.z)); let mn = min(f.x, min(f.y, f.z)); let md = f.x + f.y + f.z - mx - mn;
  return at(i) * (1.0 - mx) + at(i + hi) * (mx - md) + at(i + 1u - lo) * (md - mn) + at(i + 1u) * mn;
}
fn enc(x: f32) -> f32 { return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, 12.92 * x, x <= 0.0031308); }
fn dec(x: f32) -> f32 { return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045); }
fn hsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b)); let d = mx - mn;
  if (mx <= 0.0) { return vec3f(0.0); }
  var h = 0.0;
  if (d > 0.0) { if (mx == c.r) { h = (c.g - c.b) / d; } else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; } else { h = 4.0 + (c.r - c.g) / d; } }
  if (h < 0.0) { h += 6.0; }
  return vec3f(h, d / mx, mx);
}
fn rgb(x: vec3f) -> vec3f {
  let h = x.x - 6.0 * floor(x.x / 6.0); let i = floor(h); let f = h - i; let v = x.z;
  let p1 = v * (1.0 - x.y); let q = v * (1.0 - x.y * f); let r = v * (1.0 - x.y * (1.0 - f));
  switch (u32(i)) { case 0u: { return vec3f(v, r, p1); } case 1u: { return vec3f(q, v, p1); } case 2u: { return vec3f(p1, v, r); }
    case 3u: { return vec3f(p1, q, v); } case 4u: { return vec3f(r, p1, v); } default: { return vec3f(v, p1, q); } }
}
fn cell(o: u32, d: vec3u, h: u32, s: u32, v: u32) -> vec3f { let k = o + ((v * d.x + h) * d.y + s) * 3u; return vec3f(t[k], t[k + 1u], t[k + 2u]); }
// a HueSatMap or LookTable: hue wraps, saturation and value clamp; entries are (hue shift °, sat scale, value scale)
fn hsd(c: vec3f, d: vec4u, srgbV: bool) -> vec3f {
  var x = hsv(max(c, vec3f(0.0)));
  if (x.z <= 0.0) { return c; }
  let vv = select(x.z, enc(min(x.z, 1.0)), srgbV);
  let hf = x.x * f32(d.x) / 6.0; let h0 = u32(floor(hf)) % d.x; let h1 = (h0 + 1u) % d.x; let fh = fract(hf);
  let sf = x.y * f32(d.y - 1u); let s0 = min(u32(floor(sf)), d.y - 1u); let s1 = min(s0 + 1u, d.y - 1u); let fs = sf - floor(sf);
  let vf = clamp(vv, 0.0, 1.0) * f32(max(d.z, 1u) - 1u); let v0 = min(u32(floor(vf)), max(d.z, 1u) - 1u); let v1 = min(v0 + 1u, max(d.z, 1u) - 1u); let fv = vf - floor(vf);
  let a = mix(mix(cell(d.w, d.xyz, h0, s0, v0), cell(d.w, d.xyz, h1, s0, v0), fh), mix(cell(d.w, d.xyz, h0, s1, v0), cell(d.w, d.xyz, h1, s1, v0), fh), fs);
  let b = mix(mix(cell(d.w, d.xyz, h0, s0, v1), cell(d.w, d.xyz, h1, s0, v1), fh), mix(cell(d.w, d.xyz, h0, s1, v1), cell(d.w, d.xyz, h1, s1, v1), fh), fs);
  let e = mix(a, b, fv);
  x.x = x.x + e.x / 60.0; x.y = clamp(x.y * e.y, 0.0, 1.0);
  if (srgbV && x.z <= 1.0) { x.z = dec(clamp(vv * e.z, 0.0, 1.0)); } else { x.z = x.z * e.z; }
  return rgb(x);
}
fn curve(x: f32) -> f32 { let f = clamp(x, 0.0, 1.0) * 1023.0; let i = u32(floor(f)); let j = min(i + 1u, 1023u); return mix(t[p.tab.x + i], t[p.tab.x + j], f - floor(f)); }
// Adobe's hue-preserving tone: the curve on the largest and smallest channel, the middle one in proportion
fn tone(c0: vec3f) -> vec3f {
  let c = clamp(c0, vec3f(0.0), vec3f(1.0)); let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b));
  let tx = curve(mx); let tn = curve(mn); let k = select((tx - tn) / (mx - mn), 0.0, mx - mn <= 1e-6);
  return vec3f(tn + (c.r - mn) * k, tn + (c.g - mn) * k, tn + (c.b - mn) * k);
}
fn film(c: vec3f) -> vec3f { let y = dot(c, vec3f(0.2126, 0.7152, 0.0722)); let ty = y / (1.0 + y * 0.6) * 1.6; return c * (ty / max(y, 1e-6)); }
fn tab(c: vec3f) -> vec3f {
  let n = p.tab.y; let a = clamp(mv(p.a0, p.a1, p.a2, c), vec3f(0.0), vec3f(1.0));
  let g = pow(a, vec3f(1.0 / 2.2)) * f32(n - 1u); let i = min(vec3u(floor(g)), vec3u(n - 2u)); let f = g - vec3f(i);
  var acc = vec3f(0.0);
  for (var k = 0u; k < 8u; k++) {
    let o = vec3u(k & 1u, (k >> 1u) & 1u, (k >> 2u) & 1u); let w = select(1.0 - f, f, o == vec3u(1u));
    let q = p.tab.z + (((i.x + o.x) * n + (i.y + o.y)) * n + (i.z + o.z)) * 3u;
    acc += vec3f(t[q], t[q + 1u], t[q + 2u]) * w.x * w.y * w.z;
  }
  let lin = pow(acc, vec3f(2.2));
  return mix(c, mv(p.b0, p.b1, p.b2, lin), p.f.z);
}
// Contrast, Whites and Blacks are one curve over stops from middle grey, which stays where it is: Contrast is
// the curve's slope there. Above grey it runs to white (1.0, where the profile's curve ends), below to black
// (BLACK stops under grey), and Whites and Blacks move the scene brightness that lands on each: a stop either
// way for Whites, four for Blacks. Each half is the one-bend curve through (0,0) and (1,1) with slope a at the
// start and 1/a at the end, carried on straight past the end, so nothing clips that didn't before.
const WHITE = 2.474;   // stops from middle grey to white: log2(1 / 0.18)
const BLACK = 8.0;     // stops from middle grey to what counts as black
fn bend(u: f32, a: f32) -> f32 { return select(a * u / (1.0 + (a - 1.0) * u), 1.0 + (u - 1.0) / a, u > 1.0); }
fn shade(v: f32, con: f32, wh: f32, bl: f32) -> f32 {
  let x = log2(max(v, 1e-9) / 0.18);
  if (x >= 0.0) { let w = WHITE - wh; return 0.18 * exp2(WHITE * bend(x / w, con * w / WHITE)); }
  let b = BLACK + 4.0 * bl; return 0.18 * exp2(-BLACK * bend(-x / b, con * b / BLACK));
}
// The curve goes on as the profile's own does (tone()): on the largest and smallest channel, the middle one
// keeping its place between them. Hue stays, and colour strengthens with contrast, as it does in Lightroom.
fn tones(c0: vec3f, con: f32, wh: f32, bl: f32) -> vec3f {
  let c = max(c0, vec3f(0.0)); let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b));
  let tx = shade(mx, con, wh, bl); let tn = shade(mn, con, wh, bl); let k = select((tx - tn) / (mx - mn), 0.0, mx - mn <= 1e-7 * mx);
  return vec3f(tn) + (c - vec3f(mn)) * k;
}
// Saturation and Vibrance, in Oklab (Björn Ottosson's): the colour is made stronger or weaker about its own
// lightness, so its hue holds (a blue sky doesn't turn purple) and the same move looks the same on every
// colour. Saturation moves every colour alike; Vibrance moves the muted ones most, goes easy on skin's
// hues, and taken down fades the muted colours first. Neither pushes a colour off the edge of what the
// screen can show: past the knee the move eases off towards the edge, where a plain one would clip to a
// flat patch of the wrong hue. The tuning is ours.
const SKIN = 0.5;                        // how much of Vibrance skin's hues are spared
const SKIN_HUE = vec2f(0.530, 0.848);    // where skin sits: 58° in Oklab (light to dark skin runs 40°..76°)
const KNEE = 0.75;                       // how near the edge a strengthened colour starts to ease off
// How near a colour is to the strongest sRGB can show: 0 grey, 1 on the edge, more beyond it. The square
// root allows for the tone curve to come, which strengthens colour.
fn near(c: vec3f) -> f32 {
  let s = mv(p.o0, p.o1, p.o2, c); let mx = max(s.r, max(s.g, s.b)); let mn = min(s.r, min(s.g, s.b));
  if (mx <= 0.0) { return select(2.0, 0.0, mn >= 0.0); }
  return 1.0 - sign(mn) * sqrt(abs(mn) / mx);
}
// Oklab's cone response r (lightness l) with its colour k times as strong, as linear ProPhoto.
fn strong(r: vec3f, l: f32, k: f32) -> vec3f {
  let n = vec3f(l) + (r - vec3f(l)) * k; let m = n * n * n;
  return vec3f(dot(m, vec3f(1.7387399, -0.9884013, 0.2496614)), dot(m, vec3f(-0.7070029, 1.9343162, -0.2273134)), dot(m, vec3f(-0.0840634, -0.3575177, 1.4415810)));
}
fn vivid(c: vec3f) -> vec3f {
  let q = vec3f(dot(c, vec3f(0.7153289, 0.3529082, -0.0682371)), dot(c, vec3f(0.2743544, 0.6678509, 0.0577947)), dot(c, vec3f(0.1097542, 0.1862089, 0.7040370)));
  let r = sign(q) * pow(abs(q), vec3f(1.0 / 3.0)); let l = dot(r, vec3f(0.2104543, 0.7936178, -0.0040720));
  let ab = vec2f(dot(r, vec3f(1.9779985, -2.4285922, 0.4505937)), dot(r, vec3f(0.0259040, 0.7827718, -0.8086758)));
  let t = min(near(c), 1.0); let skin = pow(max(dot(ab, SKIN_HUE) / max(length(ab), 1e-9), 0.0), 8.0);
  var k = (1.0 + p.k.x) * (1.0 + p.k.y * select(1.0 - 0.5 * t, (1.0 - t) * (1.0 - SKIN * skin), p.k.y > 0.0));
  if (k > 1.0) {
    let edge = max(KNEE, t); let x = near(strong(r, l, k));
    if (edge > 0.999) { k = 1.0; } else if (x > edge) {
      let goal = edge + (1.0 - edge) * (1.0 - exp((edge - x) / (1.0 - edge)));
      var lo = 1.0; var hi = k;
      for (var i = 0; i < 10; i++) { let mid = 0.5 * (lo + hi); if (near(strong(r, l, mid)) > goal) { hi = mid; } else { lo = mid; } }
      k = lo;
    }
  }
  return max(strong(r, l, k), vec3f(0.0));
}
// A colour the screen cannot show: after the last matrix a part of it is below zero. Cutting it off at the edge
// bends its hue (over a wheel of strong colours: by 5 degrees on average and 23 at worst, measured). Its strength is
// taken down instead, in Oklab, holding its lightness and hue, until it fits (0.1 degree on average); and a colour
// within a tenth of the edge eases in ahead of it, so a petal's shading is not all laid on the edge. Colours
// further in than that are not touched. This runs when the colour table is made, never per pixel.
const EDGE_KNEE = 0.9;
fn fits(r: vec3f, l: f32, k: f32) -> bool { let s = mv(p.o0, p.o1, p.o2, strong(r, l, k)); return min(s.r, min(s.g, s.b)) >= 0.0; }
fn fit(c: vec3f) -> vec3f {
  let q = vec3f(dot(c, vec3f(0.7153289, 0.3529082, -0.0682371)), dot(c, vec3f(0.2743544, 0.6678509, 0.0577947)), dot(c, vec3f(0.1097542, 0.1862089, 0.7040370)));
  let r = sign(q) * pow(abs(q), vec3f(1.0 / 3.0)); let l = dot(r, vec3f(0.2104543, 0.7936178, -0.0040720));
  if (fits(r, l, 4.0)) { return c; }   // nowhere near the edge
  var lo = 0.0; var hi = 4.0;          // the largest multiple of this colour's strength that fits
  for (var i = 0; i < 16; i++) { let mid = 0.5 * (lo + hi); if (fits(r, l, mid)) { lo = mid; } else { hi = mid; } }
  let x = 1.0 / max(lo, 1e-4);         // how far out towards the edge it is: 1 on it
  // 2097152: a picture (picture.js). Every colour it holds is one the screen shows, so none of them eases in: only
  // what an edit pushes past the edge is brought back to it, and a picture nothing has moved comes out as it went in.
  let knee = select(EDGE_KNEE, 1.0, (p.size.w & 2097152u) != 0u);
  if (x <= knee) { return c; }
  return strong(r, l, lo * (knee + (1.0 - knee) * tanh((x - knee) / max(1.0 - knee, 1e-6))));
}
${TOOLS}
// A colour as the screen shows it with nothing done to it. For a picture (picture.js) the table holds only what the
// edit adds to this, and each pixel works this part out itself: a table read between its points blurs the hard edge
// of the screen's range, and a picture is full of colours that sit near that edge (a deep blue was out by 28 levels
// of 255). With nothing moved the table is all zeros, and the picture comes out as it went in.
fn plain(c: vec3f) -> vec3f { let o = clamp(mv(p.o0, p.o1, p.o2, c), vec3f(0.0), vec3f(1.0)); return vec3f(enc(o.r), enc(o.g), enc(o.b)); }
fn develop(c0: vec3f) -> vec3f {
  var c = c0; let fl = p.size.w;
  if ((fl & 1u) != 0u && p.hsm.z <= 1u) { c = hsd(c, p.hsm, (fl & 16u) != 0u); }
  if (p.f.y != 1.0 || p.g.z != 0.0 || p.g.w != 0.0) { c = tones(c, p.f.y, p.g.z, p.g.w); }
  if (p.k.x != 0.0 || p.k.y != 0.0) { c = vivid(c); }
  if ((fl & 32768u) != 0u) { c = mixer(c); }
  if ((fl & 65536u) != 0u) { c = grade(c); }
  if ((fl & 2u) != 0u) { c = hsd(c, p.look, (fl & 32u) != 0u); }
  if ((fl & 128u) != 0u) { c = hsd(c, p.look2, (fl & 256u) != 0u); }
  if ((fl & 4u) != 0u) { c = tone(c); } else { c = film(c); }
  if ((fl & 8u) != 0u) { c = tab(c); }
  // 1048576: strong colours cut off at the edge, as before (to compare). In a picture's table a point the screen
  // could never have shown is no pixel's colour: it is left as plain() has it, so it adds nothing to its neighbours.
  if ((fl & 1048576u) == 0u && ((fl & 2097152u) == 0u || all(mv(p.o0, p.o1, p.o2, c0) >= vec3f(0.0)))) { c = fit(c); }
  let o = clamp(mv(p.o0, p.o1, p.o2, c), vec3f(0.0), vec3f(1.0)); var e = vec3f(enc(o.r), enc(o.g), enc(o.b));
  if ((fl & 262144u) != 0u) { e = cube(e); }
  if ((fl & 131072u) != 0u) { e = vec3f(point(point(e.r, 0u), 1u), point(point(e.g, 0u), 2u), point(point(e.b, 0u), 3u)); }
  return e;
}
@compute @workgroup_size(4, 4, 4)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(N))) { return; }
  let c = unshape(vec3f(id) / f32(N - 1u)); var v = develop(c);
  if ((p.size.w & 2097152u) != 0u) { v -= plain(c); }
  textureStore(lutOut, id, vec4f(v, 1.0));
}
${DITHER}
// Highlights and Shadows work on how bright the pixel's area is, not the pixel: the tone mask (mask.js) holds
// a slope and an offset for each cell of 8 × 8 pixels, and the area's brightness in stops is the slope × the
// pixel's own log2 luminance + the offset, read between the four cells around the pixel.
fn areaOf(m: texture_2d<f32>, cell: f32, at: vec2u, l: f32) -> f32 {
  let n = vec2i(textureDimensions(m)); let u = ((vec2f(at) + 0.5) * p.f.w + p.k.zw) / cell - 0.5; let i = vec2i(floor(u)); let f = u - floor(u);
  let i0 = clamp(i, vec2i(0), n - 1); let i1 = clamp(i + 1, vec2i(0), n - 1);
  let k = mix(mix(textureLoad(m, i0, 0).xy, textureLoad(m, vec2i(i1.x, i0.y), 0).xy, f.x),
    mix(textureLoad(m, vec2i(i0.x, i1.y), 0).xy, textureLoad(m, i1, 0).xy, f.x), f.y);
  return k.x * l + k.y;
}
fn area(at: vec2u, l: f32) -> f32 { return areaOf(mask, f32(CELL), at, l); }
// The stops they add for an area x stops from middle grey. Highlights: above it, in full from 3.5 stops up.
// Shadows: below it, in full from 4 stops down, easing back to half in the deepest blacks (lifting those shows
// noise, not detail). Recovering (darker highlights, lighter shadows) reaches 2 stops, the other way 1. The
// slope stays above −1 a stop, so a brighter area never comes out darker than a dimmer one.
fn relight(x: f32, hi: f32, sh: f32) -> f32 {
  return hi * select(2.0, 1.0, hi > 0.0) * smoothstep(0.0, 3.5, x)
    + sh * select(1.0, 2.0, sh > 0.0) * smoothstep(0.0, 4.0, -x) * (1.0 - 0.5 * smoothstep(6.0, 10.0, -x));
}
${LOCAL}
// How bright a pixel is, in stops, for the tools that work by areas (Highlights, Shadows, Clarity, Texture, Dehaze).
// A full-size view takes it over the three pixels each way that make one of the editing copy's, so those tools do
// at full size exactly what the fitted photo showed, and leave the finest detail and the grain to Sharpening and Noise.
fn lightAt(q: vec2i, c: vec3f) -> f32 {
  var s = dot(c, LUM);
  if ((p.size.w & 524288u) != 0u) { s = 0.0; for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let t = vec2u(clamp(q + vec2i(i, j), vec2i(0), vec2i(p.size.xy) - 1)); s += dot(pixel(t.x, t.y), LUM) / 9.0; } } }
  return log2(max(s, FLOOR));
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let w = p.size.x; let h = p.size.y; let fl = p.size.w;
  if (id.x >= w || id.y >= h) { return; }
  var c = pixel(id.x, id.y);
  let l = lightAt(vec2i(id.xy), c);
  let spot = ((vec2f(id.xy) + 0.5) * p.f.w + p.k.zw) / max(p.noise.zw, vec2f(1.0));   // 0..1 across the picture
  // what the masks add here to the photo's own exposure, highlights and shadows, and clarity, texture, dehaze
  var ev = p.f.x; var hi = p.g.x; var sh = p.g.y; var fx = p.fx.xyz; var lo = Local(vec4f(0.0), vec4f(0.0), vec3f(0.0), vec4f(0.0), 0.0);
  if (p.mi.x > 0.0) { lo = locals(spot, c); ev += lo.a.x; hi += lo.a.z; sh += lo.a.w; fx = clamp(fx + lo.fx.xyz, vec3f(-1.0), vec3f(1.0)); c = c * exp2(lo.wb); }
  // Dehaze: an area holding a share d of the air's light lets 1 − d of the scene through; take the air's part out
  // and scale what is left back up. Less than none lays the air's colour over everything instead.
  if (fx.z > 0.0) { let t = max(1.0 - 0.65 * fx.z * clamp(areaOf(haze, f32(CELL), id.xy, l), 0.0, 1.0), 0.15); c = max((c - p.air.rgb * (1.0 - t)) / t, vec3f(0.0)); }
  else if (fx.z < 0.0) { c = mix(c, p.air.rgb, -0.2 * fx.z); }
  if ((fl & 1u) != 0u && p.hsm.z > 1u) { c = hsd(c, p.hsm, (fl & 16u) != 0u); }
  c = c * exp2(ev);
  if (hi != 0.0 || sh != 0.0 || fx.x != 0.0 || (fl & 4096u) != 0u) {
    var m = l + ev;
    if ((fl & 2048u) == 0u) { m = area(id.xy, l) + ev; }
    // Clarity: what the pixel adds to its area's brightness, in stops, made more or less; eased off in areas near black or white
    let local = fx.x * select(0.6, 0.8, fx.x > 0.0) * (l + ev - m) * (1.0 - smoothstep(3.0, 6.0, abs(m - log2(0.18))));
    if ((fl & 4096u) != 0u) { c = vec3f(exp2(m)); } else { c = c * exp2(relight(m - log2(0.18), hi, sh) + local); }
  }
  // Texture: the same against the finer mask, so it is the small detail that moves
  if (fx.y != 0.0) { c = c * exp2(fx.y * select(0.7, 0.9, fx.y > 0.0) * (l - areaOf(fine, 4.0, id.xy, l))); }
  // the masks' own contrast, whites and blacks (the photo's curve, laid on here alone), then their saturation and hue
  if (lo.a.y != 0.0 || lo.b.x != 0.0 || lo.b.y != 0.0) { c = tones(c, exp2(lo.a.y), lo.b.x, lo.b.y); }
  if (lo.b.z != 0.0 || lo.b.w != 0.0) { c = tinted(c, lo.b.z, lo.b.w); }
  // Vignette, after the crop: the picture's corners darker or lighter by up to 2 stops, easing in from near its middle
  if (p.fx.w != 0.0) { let d = (spot - 0.5) * 2.0; c = c * exp2(p.fx.w * 2.0 * smoothstep(0.1, 1.1, 0.5 * dot(d, d))); }
  var o = c;
  if ((fl & 16384u) == 0u) {
    if ((fl & 64u) != 0u) { o = develop(c); } else {
      if ((fl & 8192u) != 0u) { o = at(vec3u(shape(c) * f32(N - 1u) + 0.5)); } else { o = lookup(c); }
      if ((fl & 2097152u) != 0u) { o = clamp(o + plain(c), vec3f(0.0), vec3f(1.0)); }
    }
  }
  o = mix(o, vec3f(0.91, 0.13, 0.16), 0.55 * lo.show);   // the mask being worked on, in red
  if (p.sharp.w > 0.0) { o = grain(o, spot); }
  let at = id.xy;
  if ((fl & 1024u) == 0u) { o = dither(o, at); }
  textureStore(dst, vec2i(at), vec4f(o, select(1.0, clamp(1.0 + lo.fx.w, 0.0, 2.0), (fl & 524288u) != 0u)));   // a full-size view's last pass (finish.js) reads the masks' sharpness here
}`;
