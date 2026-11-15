// HDR films on an SDR canvas: the BT.2390 EETF (ITU-R BT.2390, section 5.4.1, "electrical-electrical
// transfer function"), the reference curve for showing PQ material on a screen with a lower peak.
// It works on PQ code values normalised to the source's range: below a knee nothing changes; above
// it a Hermite spline bends the rest of the range down to the target peak, meeting it with a level
// slope. The black lift of the full EETF is left out: both blacks are 0 here.
//
// What WebGL is handed (measured in this repository's Chromium, see picture.js): an HDR frame
// uploaded as RGBA16F arrives already in the canvas's primaries (sRGB, or Display P3 when
// unpackColorSpace says so), sRGB-encoded and extended past 1.0, with 1.0 at 203 nits (HDR
// reference white). The shader undoes that encoding, maps max(R, G, B) through the curve (so a
// colour keeps its hue as it is dimmed), and encodes the result for the canvas. Colours outside the
// screen's gamut (negative channels) are clipped, as the browser's own picture does.

const M1 = 2610 / 16384, M2 = 2523 / 4096 * 128, C1 = 3424 / 4096, C2 = 2413 / 4096 * 32, C3 = 2392 / 4096 * 32;
/** HDR reference white (BT.2408): 1.0 in what WebGL is handed. */
export const WHITE = 203;
/** The source's assumed peak: the mastering display's peak is not exposed to the page; 1000 nits is the usual one. */
export const SOURCE_PEAK = 1000;
/** The canvas's white, in the film's nits. Twice reference white puts mid-tones where Chrome's own picture does (see picture.js). */
export const SHOWN_PEAK = 2 * WHITE;

/** PQ (SMPTE ST 2084) inverse EOTF: nits to a code value in 0..1. */
export function pq(nits) {
  const y = Math.pow(Math.max(0, nits) / 10000, M1);
  return Math.pow((C1 + C2 * y) / (1 + C3 * y), M2);
}

/** PQ EOTF: a code value to nits. */
export function pqNits(e) {
  const p = Math.pow(Math.max(0, e), 1 / M2);
  return 10000 * Math.pow(Math.max(p - C1, 0) / (C2 - C3 * p), 1 / M1);
}

/** The curve's constants for a source and target peak: the source's PQ peak, the target's share of it, the knee. */
export function curve(source = SOURCE_PEAK, target = SHOWN_PEAK) {
  const top = pq(source), maxLum = Math.min(1, pq(target) / top);
  return {top, maxLum, ks: 1.5 * maxLum - 0.5};
}

/** BT.2390 EETF on a normalised PQ value e1 (0..1). */
export function eetfPQ(e1, {maxLum, ks}) {
  e1 = Math.min(1, Math.max(0, e1));
  if (maxLum >= 1 || e1 < ks) return e1;
  const t = (e1 - ks) / (1 - ks), t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum;
}

/** Nits in, nits out: the film's light as shown on a screen whose peak is `target`. */
export function eetf(nits, source = SOURCE_PEAK, target = SHOWN_PEAK) {
  const c = curve(source, target);
  return pqNits(eetfPQ(pq(nits) / c.top, c) * c.top);
}

/**
 * The tone-mapping pass, at the film's size: frame (RGBA16F, as described above) to an SDR,
 * sRGB-encoded picture the other passes take as they take any film. Same maths as eetf().
 */
export const TONEMAP = `#version 300 es
precision highp float;
uniform sampler2D src; uniform float top, maxLum, ks, white, shownPeak;
out vec4 color;
const float M1 = ${M1}, M2 = ${M2}, C1 = ${C1}, C2 = ${C2}, C3 = ${C3};
float pq(float n) { float y = pow(max(n, 0.0) / 10000.0, M1); return pow((C1 + C2 * y) / (1.0 + C3 * y), M2); }
float pqNits(float e) { float p = pow(max(e, 0.0), 1.0 / M2); return 10000.0 * pow(max(p - C1, 0.0) / (C2 - C3 * p), 1.0 / M1); }
vec3 decode(vec3 e) { vec3 a = abs(e); return sign(e) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a)); }
vec3 encode(vec3 l) { return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
void main() {
  vec3 c = max(decode(texelFetch(src, ivec2(gl_FragCoord.xy), 0).rgb), 0.0) * white;
  float m = max(max(c.r, c.g), c.b), e = clamp(pq(m) / top, 0.0, 1.0);
  if (maxLum < 1.0 && e >= ks) { float t = (e - ks) / (1.0 - ks), t2 = t * t, t3 = t2 * t; e = (2.0 * t3 - 3.0 * t2 + 1.0) * ks + (t3 - 2.0 * t2 + t) * (1.0 - ks) + (-2.0 * t3 + 3.0 * t2) * maxLum; }
  c *= m > 0.0 ? pqNits(e * top) / m : 0.0;
  color = vec4(encode(clamp(c / shownPeak, 0.0, 1.0)), 1.0);
}`;
