// Anime4K (github.com/bloc97/Anime4K, MIT, notice in LICENSES.md and in the two shader files) on
// the filter's WebGL2 pipeline: the "Upscale CNN x2 (S)" network, optionally after "Restore CNN (S)",
// the smallest pieces of its "Mode A". The shaders are mpv hooks; each pass here is one draw into
// its own texture, with the same bindings and sizes as mpv gives it:
//
//   restore (optional), all at the film's size w x h:
//     MAIN -> conv2d_tf -> conv2d_1_tf -> conv2d_2_tf;  conv2d_2_tf + MAIN -> MAIN (cleaned)
//   upscale:
//     MAIN -> conv2d_tf -> conv2d_1_tf -> conv2d_2_tf -> conv2d_last_tf      (w x h, 4 channels each)
//     conv2d_last_tf + MAIN -> MAIN at 2w x 2h  (depth-to-space: each low-res texel's 4 channels are
//     its 2 x 2 output pixels, added to a bilinear enlargement of MAIN)
//
// The network's activations are signed (each layer reads max(x, 0) and max(-x, 0) of the last), so
// they need float targets: an 8-bit target would clip every negative to 0 and break the network.
// RGBA16F is what mpv itself uses; WebGL2 can render to it only with EXT_color_buffer_float (or
// EXT_color_buffer_half_float), which the filter checks at start (Filter.half). Without it this mode
// is not offered by the device and the Standard upscale (FSR) is drawn instead.
//
// mpv's names map to WebGL like this, for a pass drawing an outSize target: NAME_pos is the output
// pixel's centre in 0..1, NAME_tex(p) a bilinear sample, NAME_texOff(o) the texel o away (always on
// texel centres in these passes, so a texelFetch, edges clamped as mpv's textures are), NAME_size
// and NAME_pt the texture's size and texel. Image rows run top-down in every texture, as in mpv.

import {UPSCALE_S, UPSCALE_S_WHEN} from './anime4k-upscale.js';
import {RESTORE_S} from './anime4k-restore.js';

/** Anime4K's own rule (its passes' WHEN): it runs only when the picture is shown more than 1.2 times larger both ways. */
export const runs = (film, out) => out[0] > film[0] * UPSCALE_S_WHEN && out[1] > film[1] * UPSCALE_S_WHEN;

/** One pass's fragment shader: mpv's macros for each bound texture, then the hook as published. */
export function fragment({binds, code}) {
  const head = ['#version 300 es', 'precision highp float;', 'precision highp int;', 'uniform vec2 outSize;', 'out vec4 astraOut;'];
  for (const n of binds) head.push(`uniform sampler2D ${n};`,
    `#define ${n}_size vec2(textureSize(${n}, 0))`, `#define ${n}_pt (1.0 / ${n}_size)`, `#define ${n}_pos (gl_FragCoord.xy / outSize)`,
    `#define ${n}_tex(p) texture(${n}, p)`, `#define ${n}_texOff(o) texelFetch(${n}, clamp(ivec2(gl_FragCoord.xy) + ivec2(o), ivec2(0), textureSize(${n}, 0) - 1), 0)`);
  return `${head.join('\n')}\n${code}\nvoid main() { astraOut = hook(); }`;
}

/**
 * Builds the programs once, on first use (nine long shaders: compiling them costs a moment, so a
 * viewer who never picks this mode never pays it).
 * @param {(fragment: string, uniforms: string[]) => object} program  the filter's program builder
 */
export function build(program, restore) {
  const make = list => list.map(p => ({...p, prog: program(fragment(p), ['outSize', ...p.binds])}));
  return {upscale: make(UPSCALE_S), restore: restore ? make(RESTORE_S) : null};
}

/**
 * Runs the chain on `src` (w x h, sampled bilinearly, so its texture filters LINEAR) and returns the
 * doubled picture's texture (RGBA16F, LINEAR, 2w x 2h).
 * @param {import('./filter.js').Filter} f
 */
export function run(f, programs, src, w, h) {
  const gl = f.gl, saved = {MAIN: src};
  const step = (list, tag) => list.forEach((p, i) => {
    const ow = w * p.scale, oh = h * p.scale, last = i === list.length - 1;
    // MAIN's replacement is sampled between texels (bilinear), the others only on their centres.
    const t = f.target(`a4k-${tag}-${i}`, ow, oh, gl.RGBA16F, last ? gl.LINEAR : gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, ow, oh);
    gl.useProgram(p.prog.program);
    p.binds.forEach((n, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, saved[n]); gl.uniform1i(p.prog.u[n], unit); });
    gl.uniform2f(p.prog.u.outSize, ow, oh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    saved[p.save] = t.tex;
  });
  if (programs.restore) step(programs.restore, 'r');
  step(programs.upscale, 'u');
  gl.activeTexture(gl.TEXTURE0);
  return saved.MAIN;
}

/**
 * Work per pixel of each pass's own target, counted from the shaders: distinct texels read (go_0
 * and go_1 read the same texel; compilers merge the repeat) and multiply-adds (16 per mat4 * vec4).
 */
export function cost(list) {
  return list.map(p => ({desc: p.desc, at: p.scale === 2 ? '2x' : 'film', reads: new Set(p.code.match(/go_\d\([-0-9.]+, [-0-9.]+\)/g)?.map(g => g.slice(5)) || []).size + (p.code.match(/_tex\(/g)?.length || 0), mads: 16 * (p.code.match(/mat4\(/g)?.length || 0)}));
}
