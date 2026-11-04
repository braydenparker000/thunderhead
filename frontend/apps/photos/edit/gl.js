// @ts-check
// The pipeline on WebGL2, for phones without WebGPU (iOS before 26): the source uploaded as textures
// (the engine's three f16 planes, or the browser's 8-bit bitmap), the proxy at screen size with its
// two blur levels made once per source, then the develop pass per frame (shaders/). Needs float
// render targets (EXT_color_buffer_float or _half_float), which every phone with WebGL2 has.
import { DEVELOP_GLSL } from './shaders/develop.glsl.js';
import { BLUR_GLSL, PREP_GLSL, VERT_GLSL } from './shaders/prep.glsl.js';

/** @typedef {import('./renderer.js').Source} Source */
/** @typedef {{ t: WebGLTexture, f: WebGLFramebuffer | null, w: number, h: number }} Target */

/** @param {HTMLCanvasElement} canvas */
export async function webgl2(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available');
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('no float render targets');
  const compile = (/** @type {string} */ fs) => {
    const p = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT_GLSL], [gl.FRAGMENT_SHADER, fs]]) {
      const s = /** @type {WebGLShader} */ (gl.createShader(/** @type {number} */ (type)));
      gl.shaderSource(s, /** @type {string} */ (src));
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    return p;
  };
  const prog = { prep: compile(PREP_GLSL), blur: compile(BLUR_GLSL), develop: compile(DEVELOP_GLSL) };
  const at = (/** @type {WebGLProgram} */ p, /** @type {string} */ n) => gl.getUniformLocation(p, n);
  gl.bindVertexArray(gl.createVertexArray());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  /** @param {number} w @param {number} h @param {number} internal @param {number} format @param {number} type @param {ArrayBufferView | ImageBitmap | null} data */
  const texture = (w, h, internal, format, type, data) => {
    const t = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    if (data && 'close' in data) gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, type, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, /** @type {ArrayBufferView | null} */ (data));
    return t;
  };
  /** @param {number} w @param {number} h @param {boolean} [bytes] @returns {Target} */
  const target = (w, h, bytes = false) => {
    const t = bytes ? texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null) : texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  };
  const drop = (/** @type {Target | null | undefined} */ x) => { if (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } };
  const bind = (/** @type {WebGLProgram} */ p, /** @type {(WebGLTexture | null)[]} */ ts, /** @type {string[]} */ names) =>
    ts.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(at(p, names[i]), i); });
  const pass = (/** @type {Target} */ dst, /** @type {WebGLProgram} */ p, /** @type {number[]} */ params) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(p);
    gl.uniform4fv(at(p, 'p'), new Float32Array(params));
  };
  /** @param {Target} dst @param {WebGLTexture[]} src @param {number} mode @param {number[]} region @param {number} n */
  const prep = (dst, src, mode, region, n) => {
    pass(dst, prog.prep, [...region, dst.w, dst.h, mode, n]);
    bind(prog.prep, [src[0], src[1] ?? src[0], src[2] ?? src[0]], ['T0', 'T1', 'T2']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const blur = (/** @type {Target} */ dst, /** @type {Target} */ src, /** @type {number} */ dx, /** @type {number} */ dy) => {
    pass(dst, prog.blur, [dx / src.w, dy / src.h, dst.w, dst.h, 0, 0, 0, 0]);
    bind(prog.blur, [src.t], ['T0']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const taps = (/** @type {number} */ from, /** @type {number} */ to) => Math.min(4, Math.max(1, Math.ceil(from / to)));
  /** @param {Source} s */
  const upload = (s) => s.kind === 'planar'
    ? [0, 1, 2].map((c) => texture(s.width, s.height, gl.R16F, gl.RED, gl.HALF_FLOAT, s.data.subarray(c * s.width * s.height, (c + 1) * s.width * s.height)))
    : [texture(s.width, s.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, s.bitmap)];

  /** @type {{ src: WebGLTexture[], mode: number, w: number, h: number, p0: Target, levels: Target[] } | null} */
  let base = null;
  /** @type {Target | null} */
  let p1 = null;
  /** @type {Target | null} */
  let small = null;
  const lut = texture(1024, 1, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);

  const develop = (/** @type {Float32Array} */ u, /** @type {Uint16Array} */ table) => {
    if (!base) return;
    gl.useProgram(prog.develop);
    gl.uniform4fv(at(prog.develop, 'u'), u);
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 1, gl.RGBA, gl.HALF_FLOAT, table);
    bind(prog.develop, [base.p0.t, (p1 ?? base.p0).t, base.levels[0].t, base.levels[1].t, lut], ['P0', 'P1', 'B2', 'B3', 'LUT']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    kind: /** @type {const} */ ('webgl2'),
    maxSize: /** @type {number} */ (gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    /** The photo's source and its proxy at `pw × ph`, with the blur levels. @param {Source} s @param {number} pw @param {number} ph */
    source(s, pw, ph) {
      if (base) { base.src.forEach((t) => gl.deleteTexture(t)); drop(base.p0); base.levels.forEach(drop); }
      drop(p1);
      p1 = null;
      const src = upload(s), mode = s.kind === 'planar' ? 0 : 1, p0 = target(pw, ph);
      prep(p0, src, mode, [0, 0, 1, 1], taps(s.width, pw));
      const levels = [];
      let from = p0;
      for (const mode2 of [2, 3]) {
        const w = Math.max(1, Math.ceil(from.w / 4)), h = Math.max(1, Math.ceil(from.h / 4));
        const r = target(w, h), tmp = target(w, h), out = target(w, h);
        prep(r, [from.t], mode2, [0, 0, 1, 1], 4);
        blur(tmp, r, 1, 0);
        blur(out, tmp, 0, 1);
        drop(r); drop(tmp);
        levels.push(out);
        from = out;
      }
      base = { src, mode, w: s.width, h: s.height, p0, levels };
    },
    /** A detail proxy for `region` (uv of the photo) at `w × h`: from a 1:1 tile when given, else from the source.
     * @param {Source | null} tile @param {number[]} region @param {number} w @param {number} h */
    detail(tile, region, w, h) {
      if (!base) return;
      drop(p1);
      p1 = target(w, h);
      if (tile) {
        const t = upload(tile);
        prep(p1, t, tile.kind === 'planar' ? 0 : 1, [0, 0, 1, 1], taps(tile.width, w));
        t.forEach((x) => gl.deleteTexture(x));
      } else prep(p1, base.src, base.mode, region, taps((region[2] - region[0]) * base.w, w));
    },
    clearDetail() { drop(p1); p1 = null; },
    /** @param {Float32Array} u @param {Uint16Array} table */
    draw(u, table) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      develop(u, table);
    },
    /** The developed photo at `w × h` as RGBA bytes, top row first. @param {Float32Array} u @param {Uint16Array} table @param {number} w @param {number} h */
    async read(u, table, w, h) {
      if (!small || small.w !== w || small.h !== h) { drop(small); small = target(w, h, true); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, small.f);
      gl.viewport(0, 0, w, h);
      develop(u, table);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    },
  };
}
