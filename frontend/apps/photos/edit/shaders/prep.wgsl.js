// @ts-check
// The prep and blur passes in WGSL for WebGPU, as prep.glsl.js describes them.

export const PREP_WGSL = /* wgsl */ `
struct P { p: array<vec4f, 2> }
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var T0: texture_2d<f32>;
@group(0) @binding(3) var T1: texture_2d<f32>;
@group(0) @binding(4) var T2: texture_2d<f32>;
const Y = vec3f(0.2627, 0.6780, 0.0593);
const SRGB_2020 = mat3x3f(0.6274039, 0.0690973, 0.0163914, 0.3292830, 0.9195404, 0.0880133, 0.0433131, 0.0113623, 0.8955953);
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn src(s: vec2f, mode: i32) -> vec4f {
  if (mode == 0) {
    return vec4f(textureSampleLevel(T0, smp, s, 0.0).r, textureSampleLevel(T1, smp, s, 0.0).r, textureSampleLevel(T2, smp, s, 0.0).r, 1.0);
  }
  let c = textureSampleLevel(T0, smp, s, 0.0);
  if (mode == 1) {
    let l = mix(c.rgb / 12.92, pow((c.rgb + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), c.rgb));
    return vec4f(SRGB_2020 * l, 1.0);
  }
  return c;
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mode = i32(u.p[1].z);
  let n = u.p[1].w;
  let cell = (u.p[0].zw - u.p[0].xy) / u.p[1].xy;
  var acc = vec4f(0.0);
  for (var j = 0.0; j < 4.0; j = j + 1.0) {
    for (var i = 0.0; i < 4.0; i = i + 1.0) {
      if (i >= n || j >= n) { continue; }
      let c = src(u.p[0].xy + (floor(pos.xy) + (vec2f(i, j) + 0.5) / n) * cell, mode);
      if (mode == 2) { acc = acc + vec4f(c.a, max(min(min(c.r, c.g), c.b), 0.0), (c.a + 6.0) * (c.a + 6.0), 0.0); }
      else if (mode == 3) { acc = acc + vec4f(c.rgb, 0.0); }
      else { acc = acc + vec4f(max(c.rgb, vec3f(0.0)), 0.0); }
    }
  }
  acc = acc / (n * n);
  if (mode < 2) { acc.a = log2(max(dot(acc.rgb, Y), exp2(-16.0))); } else { acc.a = 1.0; }
  return acc;
}`;

export const BLUR_WGSL = /* wgsl */ `
struct P { p: array<vec4f, 2> }
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var T0: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let s = pos.xy / u.p[0].zw;
  var a = vec4f(0.0);
  var w = 0.0;
  for (var i = -4; i <= 4; i = i + 1) {
    let g = exp(-f32(i * i) / 8.0);
    a = a + g * textureSampleLevel(T0, smp, s + f32(i) * u.p[0].xy, 0.0);
    w = w + g;
  }
  return a / w;
}`;
