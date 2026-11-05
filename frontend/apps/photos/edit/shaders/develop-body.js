// @ts-check
// The develop pass's per-pixel chain, written once in the subset GLSL ES 3.0 and WGSL share after two
// small rewrites (develop.glsl.js, develop.wgsl.js): white balance → exposure → tone (Highlights and
// Shadows as local exposure from the large blur; Contrast, Whites, Blacks and the point curves in the
// lookup) → HSL in eight ranges → Vibrance, Saturation → B&W → Grading → Texture, Clarity, Dehaze
// (local contrast at three scales) → Sharpening → Noise reduction → Vignette → Grain → sRGB. The
// neighbourhood steps are measured on the source (log2 luminance in the proxy's alpha) and applied as
// luminance changes at their place, so the chain stays one pass. Highlights and Shadows read a guided base:
// the large blur's mean and variance of log2 luminance give, per pixel, mix(mean, L, var / (var + ε)), so
// across a strong edge the base is the pixel's own level (no halo) while inside a region it is the region's
// (its local contrast kept). Exposure ends in a hue-keeping shoulder (fields.js BASE_TONE). D1–D4 and DI declare a float, vectors and an int
// (each dialect spells them); V2, V3 and F build them. uv is the photo's point, q the output's (geometry-body.js):
// vignette and grain are laid on the output, after the crop.

import { BASE_TONE } from '../fields.js';

const KNEE = BASE_TONE.knee.toFixed(4), PW = BASE_TONE.power.toFixed(4);
/** Variance of log2 luminance (stops²) at which the guided base is half the region's, half the pixel's. */
const EPS = '0.1';

/** @param {(s: string) => string} t the dialect's rewrite */
export const body = (t) => t(`
  D1 L = c0.a;
  D3 ch = c0.rgb / max(exp2(L), 1e-6);
  D1 dL = 0.0;
  D1 nrL = U(5).x; D1 nrC = U(5).z; D1 sh = U(4).x; D1 tx = U(3).x;
  if (nrL > 0.0 || nrC > 0.0 || sh > 0.0 || tx != 0.0) {
    D1 r = clamp(U(4).y, 0.5, 3.0);
    D1 sr = mix(0.35, 0.06, U(5).y);
    D1 cr = mix(1.5, 0.2, U(5).w);
    D1 g0 = 0.0; D1 lb = 0.0; D1 wn = 0.0; D1 ln = 0.0; D1 cw = 0.0; D3 cs = V3(0.0);
    for (DI j = -2; j <= 2; j = j + 1) {
      for (DI i = -2; i <= 2; i = i + 1) {
        D2 d = V2(F(i), F(j));
        D4 q = TAP(s + d * ts * r);
        D1 g = exp(-dot(d, d) / 4.5);
        lb = lb + g * q.a; g0 = g0 + g;
        D1 dq = (q.a - L) * (q.a - L);
        D1 w = g * exp(-dq / (2.0 * sr * sr));
        ln = ln + w * q.a; wn = wn + w;
        D1 wc = g * exp(-dq / (2.0 * cr));
        cs = cs + wc * q.rgb / max(exp2(q.a), 1e-6); cw = cw + wc;
      }
    }
    lb = lb / g0; ln = ln / wn; cs = cs / cw;
    ch = mix(ch, cs, nrC);
    D1 dd = L - lb;
    D1 m = mix(1.0, smoothstep(0.02, 0.25, abs(dd)), U(4).w);
    dL = (ln - L) * nrL + sh * 1.2 * dd * m * mix(0.5, 1.5, U(4).z) + tx * 1.5 * dd;
  }
  D4 b2 = SAMPLE(B2, uv); D4 b3 = SAMPLE(B3, uv);
  D1 ev = log2(U(0).a);
  D1 mid = 1.0 - smoothstep(0.0, 1.0, abs(L + ev + 2.5) / 6.0);
  dL = dL + U(3).y * 0.7 * (L - b2.r) * mid;
  D1 gv = max(b3.b - (b3.r + 6.0) * (b3.r + 6.0), 0.0);
  D1 base = mix(b3.r, L, gv / (gv + ${EPS})) + ev;
  dL = dL + U(1).z * 1.6 * (1.0 - smoothstep(-7.0, -2.0, base)) + U(1).y * 1.6 * smoothstep(-3.5, 0.5, base);
  D3 lin = ch * exp2(L + dL) * U(0).rgb * U(0).a * lv;
  D1 k = U(3).z;
  D1 hz = clamp(b3.g * U(0).a, 0.0, 1.0);
  if (k > 0.0) {
    D1 tt = max(1.0 - k * 0.95 * hz / 0.8, 0.15);
    lin = max((lin - V3(0.8 * (1.0 - tt))) / tt, V3(0.0));
  } else if (k < 0.0) {
    lin = mix(lin, V3(0.48), -k * 0.45);
  }
  D3 sl = V3(dot(U(23).xyz, lin), dot(U(24).xyz, lin), dot(U(25).xyz, lin));
  D1 mx = max(max(sl.r, sl.g), sl.b);
  if (mx > ${KNEE}) {
    D1 su = (mx - ${KNEE}) / (1.0 - ${KNEE});
    D1 sm = ${KNEE} + (1.0 - ${KNEE}) * su / pow(1.0 + pow(su, ${PW}), 1.0 / ${PW});
    sl = sl * mix(min(mx, 1.0), sm, U(3).w) / mx;
  }
  D3 lt = clamp((log2(max(sl, V3(exp2(-12.0)))) + 12.0) / 14.0, V3(0.0), V3(1.0));
  D3 lc = (lt * 1023.0 + 0.5) / 1024.0;
  D3 e = V3(SAMPLE(LUT, V2(lc.r, 0.5)).r, SAMPLE(LUT, V2(lc.g, 0.5)).g, SAMPLE(LUT, V2(lc.b, 0.5)).b);
  D3 h = rgb2hsv(e);
  D1 hd = h.x * 360.0;
  DI kk = 0;
  for (DI i = 0; i < 8; i = i + 1) { if (hd >= HC(i)) { kk = i; } }
  D1 f = (hd - HC(kk)) / (HC(kk + 1) - HC(kk));
  D1 ha = mix(ADJ(12, kk), ADJ(12, kk + 1), f);
  D1 sa = mix(ADJ(14, kk), ADJ(14, kk + 1), f);
  D1 la = mix(ADJ(16, kk), ADJ(16, kk + 1), f);
  D1 sw = smoothstep(0.0, 0.25, h.y);
  h.x = fract(h.x + ha * 30.0 / 360.0 * sw + 1.0);
  h.z = h.z * (1.0 + la * 0.6 * sw * h.y);
  h.y = clamp(h.y * (1.0 + sa * sw), 0.0, 1.0);
  e = hsv2rgb(h);
  D1 y = dot(e, Y709);
  D1 vib = U(2).y;
  e = mix(V3(y), e, 1.0 + vib * (1.0 - h.y));
  e = mix(V3(y), e, 1.0 + U(2).z);
  if (U(2).w > 0.5) { e = V3(dot(e, Y709)); }
  y = clamp(dot(e, Y709), 0.0, 1.0);
  D1 p = 0.5 + U(11).y * 0.3;
  D1 bx = mix(2.0, 0.5, U(11).x);
  D1 wS = pow(clamp(1.0 - y / max(p, 0.05), 0.0, 1.0), bx);
  D1 wH = pow(clamp((y - p) / max(1.0 - p, 0.05), 0.0, 1.0), bx);
  D1 wM = clamp(1.0 - wS - wH, 0.0, 1.0);
  e = e + U(8).rgb * wS + U(9).rgb * wM + U(10).rgb * wH;
  e = e * (1.0 + (U(8).a * wS + U(9).a * wM + U(10).a * wH) * 0.35);
  D1 asp = U(11).z;
  D2 q2 = (q - V2(0.5)) * 2.0;
  D2 circ = q2 * V2(asp, 1.0) / max(asp, 1.0);
  q2 = mix(q2, circ, max(U(6).w, 0.0));
  D1 nn = mix(2.0, 6.0, max(-U(6).w, 0.0));
  D1 dv = pow(pow(abs(q2.x), nn) + pow(abs(q2.y), nn), 1.0 / nn) / pow(2.0, 1.0 / nn);
  D1 st = mix(0.2, 0.95, U(6).y);
  D1 wd = mix(0.05, 0.9, U(6).z);
  D1 vt = smoothstep(st - wd * 0.5, st + wd * 0.5, dv);
  D1 a = U(6).x;
  if (a < 0.0) { e = e * (1.0 + a * vt); } else { e = mix(e, V3(1.0), a * vt * 0.8); }
  if (U(7).x > 0.0) {
    D2 gp = q * V2(U(7).w, U(7).w / asp) / mix(1.2, 5.0, U(7).y);
    D1 gn = mix(vnoise(gp), vnoise(gp * 2.7 + V2(13.1)), U(7).z * 0.6) - 0.5;
    D1 yy = clamp(dot(e, Y709), 0.0, 1.0);
    e = e + V3(U(7).x * 0.5 * gn * (yy * (1.0 - yy) * 2.4 + 0.2));
  }
`);
