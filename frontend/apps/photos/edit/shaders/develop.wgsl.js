// @ts-check
// The develop pass in WGSL for WebGPU, the same chain as WebGL2's (develop-body.js): a full-screen
// triangle, then for each target pixel the photo's pixel from the proxy (or the 1:1 detail proxy), the
// two blur levels and the tone lookup, sRGB-encoded out.
import { body } from './develop-body.js';
import { caBody, geoBody } from './geometry-body.js';
import { UNIFORMS } from '../uniforms.js';

const wgsl = (/** @type {string} */ s) =>
  s.replace(/\bD1 (\w+) = /g, 'var $1: f32 = ').replace(/\bD2 (\w+) = /g, 'var $1: vec2f = ')
    .replace(/\bD3 (\w+) = /g, 'var $1: vec3f = ').replace(/\bD4 (\w+) = /g, 'var $1: vec4f = ')
    .replace(/\bDI (\w+) = /g, 'var $1: i32 = ')
    .replace(/\bV3\(/g, 'vec3f(').replace(/\bV2\(/g, 'vec2f(').replace(/\bF\(/g, 'f32(')
    .replace(/\bU\((\d+)\)/g, 'u.v[$1]').replace(/\bSAMPLE\(/g, 'samp(')
    .replace(/\bTAP\(/g, 'tap(t, ').replace(/\bHC\(/g, 'hc(').replace(/\bADJ\(/g, 'adj(');

export const DEVELOP_WGSL = /* wgsl */ `
struct U { v: array<vec4f, ${UNIFORMS}> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var P0: texture_2d<f32>;
@group(0) @binding(3) var P1: texture_2d<f32>;
@group(0) @binding(4) var B2: texture_2d<f32>;
@group(0) @binding(5) var B3: texture_2d<f32>;
@group(0) @binding(6) var LUT: texture_2d<f32>;
const Y709 = vec3f(0.2126, 0.7152, 0.0722);

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn hc(i: i32) -> f32 {
  var c = array<f32, 9>(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);
  return c[i];
}
fn samp(t: texture_2d<f32>, c: vec2f) -> vec4f { return textureSampleLevel(t, smp, c, 0.0); }
fn adj(b: i32, i: i32) -> f32 { let j = i % 8; return u.v[b + j / 4][j % 4]; }
fn tap(t: bool, c: vec2f) -> vec4f {
  if (t) { return textureSampleLevel(P1, smp, c, 0.0); }
  return textureSampleLevel(P0, smp, c, 0.0);
}
fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
  let p = abs(fract(c.xxx + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), c.y);
}
fn hash(q: vec2f) -> f32 { var p = fract(q * vec2f(123.34, 456.21)); p = p + dot(p, p + 45.32); return fract(p.x * p.y); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), f.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = pos.xy;
  let q = px * u.v[18].xy + u.v[18].zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
${wgsl(geoBody((x) => x))}
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let t = u.v[20].z > 0.5 && uv.x >= u.v[19].z && uv.y >= u.v[19].w && uv.x <= u.v[20].x && uv.y <= u.v[20].y;
  let s = select(uv, (uv - u.v[19].zw) / (u.v[20].xy - u.v[19].zw), t);
  let ts = select(u.v[19].xy, u.v[22].xy, t);
  var c0 = tap(t, s);
${wgsl(caBody((x) => x))}
${wgsl(body((x) => x))}
  return vec4f(clamp(e, vec3f(0.0), vec3f(1.0)), 1.0);
}`;
