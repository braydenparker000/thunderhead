// @ts-check
// The develop pass in GLSL ES 3.0 for WebGL2 (the chain itself is develop-body.js): the photo's pixel
// for each canvas pixel, from the proxy (or the 1:1 detail proxy where it covers), the two blur
// levels and the tone lookup, sRGB-encoded out.
import { body } from './develop-body.js';

const glsl = (/** @type {string} */ s) =>
  s.replace(/\bD1 /g, 'float ').replace(/\bD2 /g, 'vec2 ').replace(/\bD3 /g, 'vec3 ').replace(/\bD4 /g, 'vec4 ').replace(/\bDI /g, 'int ')
    .replace(/\bV3\(/g, 'vec3(').replace(/\bV2\(/g, 'vec2(').replace(/\bF\(/g, 'float(');

export const DEVELOP_GLSL = `#version 300 es
precision highp float;
uniform sampler2D P0;
uniform sampler2D P1;
uniform sampler2D B2;
uniform sampler2D B3;
uniform sampler2D LUT;
uniform vec4 u[28];
out vec4 o;
const vec3 Y709 = vec3(0.2126, 0.7152, 0.0722);
const float HCS[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);
#define U(i) u[i]
#define HC(i) HCS[i]
#define SAMPLE(t, c) textureLod(t, c, 0.0)
float ADJ(int b, int i) { int j = i - (i / 8) * 8; return u[b + j / 4][j - (j / 4) * 4]; }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u[21].z > 0.5 ? u[21].y - gl_FragCoord.y : gl_FragCoord.y);
  vec2 uv = px * u[18].xy + u[18].zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  bool t = u[20].z > 0.5 && uv.x >= u[19].z && uv.y >= u[19].w && uv.x <= u[20].x && uv.y <= u[20].y;
  vec2 s = t ? (uv - u[19].zw) / (u[20].xy - u[19].zw) : uv;
  vec2 ts = t ? u[22].xy : u[19].xy;
  #define TAP(c) (t ? textureLod(P1, c, 0.0) : textureLod(P0, c, 0.0))
  vec4 c0 = TAP(s);
${body(glsl)}
  o = vec4(clamp(e, 0.0, 1.0), 1.0);
}`;
