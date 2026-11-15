// The picture filter's shaders, GLSL ES 3.0: a de-banding pass, then AMD
// FidelityFX Super Resolution 1.0 (EASU, the edge-adaptive upscale, then RCAS,
// the contrast-adaptive sharpen). EASU and RCAS are ported from AMD's public
// reference (ffx_fsr1.h); the notice below is the reference's licence, which
// must stay with this code (also in LICENSES.md in this folder). The deband
// pass is Astra's own, after the idea of mpv's deband shader.
//
// Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Texture taps per output pixel: deband 5 per input pixel (1 exact, 4
// bilinear), EASU 12, RCAS 5. Image rows run top-down in every texture; EASU
// turns them over once, for the canvas (whose rows run bottom-up).

const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

/** One triangle covering the target; no vertex buffer. */
export const VERTEX = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/**
 * De-band at the film's own size: the average of four taps on a random ring
 * (radius up to 12 px, turned each pixel and frame) replaces a channel only
 * where it differs from the pixel by less than about 2.5 steps of 8-bit (a
 * smooth gradient, not detail); then ±1 step of triangular noise breaks up
 * what is left, as grain.
 */
export const DEBAND = `${HEAD}
uniform sampler2D src; uniform vec2 size; uniform float seed;
out vec4 color;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 c = texelFetch(src, ivec2(px), 0).rgb;
  float a = hash(px + seed) * 6.2831853, r = (0.5 + 0.5 * hash(px.yx + seed * 1.7)) * 12.0;
  vec2 d = vec2(cos(a), sin(a)) * r / size, e = vec2(-d.y, d.x), uv = px / size;
  vec3 avg = 0.25 * (texture(src, uv + d).rgb + texture(src, uv - d).rgb + texture(src, uv + e).rgb + texture(src, uv - e).rgb);
  vec3 o = mix(avg, c, step(vec3(2.5 / 255.0), abs(c - avg)));
  float n = hash(px * 1.3 + seed * 3.1) + hash(px * 0.7 + seed * 5.3) - 1.0;
  color = vec4(o + n / 255.0, 1.0);
}`;

/** EASU: the 12-tap edge-adaptive upscale (FsrEasuF), from inSize to the target's size. */
export const EASU = `${HEAD}
uniform sampler2D src; uniform vec2 outSize; uniform vec2 scale;
out vec4 color;
ivec2 last;
vec3 T(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), last), 0).rgb; }
float L(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void edge(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float lenX = max(abs(lD - lC), abs(lC - lB)), dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) / max(lenX, 1e-8), 0.0, 1.0); len += lenX * lenX * w;
  float lenY = max(abs(lE - lC), abs(lC - lA)), dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) / max(lenY, 1e-8), 0.0, 1.0); len += lenY * lenY * w;
}
void tap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  aC += c * w; aW += w;
}
void main() {
  last = textureSize(src, 0) - 1;
  vec2 ip = vec2(gl_FragCoord.x - 0.5, outSize.y - gl_FragCoord.y - 0.5);
  vec2 pp = (ip + 0.5) * scale - 0.5, fp = floor(pp);
  pp -= fp;
  ivec2 o = ivec2(fp);
  vec3 b = T(o + ivec2(0, -1)), c = T(o + ivec2(1, -1));
  vec3 e = T(o + ivec2(-1, 0)), f = T(o), g = T(o + ivec2(1, 0)), h = T(o + ivec2(2, 0));
  vec3 i = T(o + ivec2(-1, 1)), j = T(o + ivec2(0, 1)), k = T(o + ivec2(1, 1)), l = T(o + ivec2(2, 1));
  vec3 n = T(o + ivec2(0, 2)), q = T(o + ivec2(1, 2));
  float bL = L(b), cL = L(c), eL = L(e), fL = L(f), gL = L(g), hL = L(h), iL = L(i), jL = L(j), kL = L(k), lL = L(l), nL = L(n), qL = L(q);
  vec2 dir = vec2(0.0); float len = 0.0;
  edge(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  edge(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  edge(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  edge(dir, len, pp.x * pp.y, gL, jL, kL, lL, qL);
  float dirR = dot(dir, dir);
  bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5; len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + (0.21 - 0.5) * len, clp = 1.0 / lob;
  vec3 aC = vec3(0.0); float aW = 0.0;
  tap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  tap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  tap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  tap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  tap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  tap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  tap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  tap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  tap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  tap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  tap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, q);
  tap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);
  vec3 mn = min(min(f, g), min(j, k)), mx = max(max(f, g), max(j, k));
  color = vec4(min(mx, max(mn, aC / aW)), 1.0);
}`;

/**
 * RCAS: the 5-tap contrast-adaptive sharpen (FsrRcasF, with its noise
 * damping on, which keeps a low-bitrate film's grain from being sharpened).
 * `sharp` is exp2(-stops): 1 is the strongest.
 */
export const RCAS = `${HEAD}
uniform sampler2D src; uniform float sharp;
out vec4 color;
ivec2 last;
vec3 T(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), last), 0).rgb; }
float L(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void main() {
  last = textureSize(src, 0) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = T(p + ivec2(0, 1)), d = T(p + ivec2(-1, 0)), e = T(p), f = T(p + ivec2(1, 0)), h = T(p + ivec2(0, -1));
  float bL = L(b), dL = L(d), eL = L(e), fL = L(f), hL = L(h);
  float nz = 0.25 * (bL + dL + fL + hL) - eL;
  float range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
  nz = -0.5 * clamp(abs(nz) / max(range, 1e-5), 0.0, 1.0) + 1.0;
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1e-5));
  vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, vec3(-1e-5));
  vec3 lobes = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max(lobes.r, max(lobes.g, lobes.b)), 0.0)) * sharp * nz;
  color = vec4((lobe * (b + d + h + f) + e) / (4.0 * lobe + 1.0), 1.0);
}`;
