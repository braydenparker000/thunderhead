// @ts-check
// The prep and blur passes in GLSL ES 3.0 for WebGL2. Prep fills a proxy: mode 0 reads the engine's
// planar f16 linear Rec.2020 working copy (three textures), mode 1 a browser-decoded sRGB bitmap
// (linearised, to Rec.2020), mode 2 a proxy reduced to log2 luminance and the darkest channel (the
// blur levels' input), mode 3 such a reduction reduced again; each output pixel averages n×n taps over
// its footprint. Blur is a 9-tap Gaussian along one axis.

export const VERT_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const PREP_GLSL = `#version 300 es
precision highp float;
uniform sampler2D T0;
uniform sampler2D T1;
uniform sampler2D T2;
uniform vec4 p[2];
out vec4 o;
const vec3 Y = vec3(0.2627, 0.6780, 0.0593);
const mat3 SRGB_2020 = mat3(0.6274039, 0.0690973, 0.0163914, 0.3292830, 0.9195404, 0.0880133, 0.0433131, 0.0113623, 0.8955953);
vec4 src(vec2 s, int mode) {
  if (mode == 0) return vec4(textureLod(T0, s, 0.0).r, textureLod(T1, s, 0.0).r, textureLod(T2, s, 0.0).r, 1.0);
  vec4 c = textureLod(T0, s, 0.0);
  if (mode == 1) {
    vec3 l = mix(c.rgb / 12.92, pow((c.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, c.rgb));
    return vec4(SRGB_2020 * l, 1.0);
  }
  return c;
}
void main() {
  int mode = int(p[1].z);
  float n = p[1].w;
  vec2 cell = (p[0].zw - p[0].xy) / p[1].xy;
  vec4 acc = vec4(0.0);
  for (float j = 0.0; j < 4.0; j++) for (float i = 0.0; i < 4.0; i++) {
    if (i >= n || j >= n) continue;
    vec4 c = src(p[0].xy + (floor(gl_FragCoord.xy) + (vec2(i, j) + 0.5) / n) * cell, mode);
    if (mode == 2) acc += vec4(c.a, max(min(min(c.r, c.g), c.b), 0.0), 0.0, 0.0);
    else if (mode == 3) acc += vec4(c.rg, 0.0, 0.0);
    else acc += vec4(max(c.rgb, vec3(0.0)), 0.0);
  }
  acc /= n * n;
  if (mode < 2) acc.a = log2(max(dot(acc.rgb, Y), exp2(-16.0)));
  else acc.ba = vec2(0.0, 1.0);
  o = acc;
}`;

export const BLUR_GLSL = `#version 300 es
precision highp float;
uniform sampler2D T0;
uniform vec4 p[2];
out vec4 o;
void main() {
  vec2 s = gl_FragCoord.xy / p[0].zw;
  vec4 a = vec4(0.0);
  float w = 0.0;
  for (int i = -4; i <= 4; i++) {
    float g = exp(-float(i * i) / 8.0);
    a += g * textureLod(T0, s + float(i) * p[0].xy, 0.0);
    w += g;
  }
  o = a / w;
}`;
