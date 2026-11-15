// The picture filter's WebGL2 work: the film's frame is uploaded once per
// presented frame, then drawn through up to three passes (fsr.js):
//   frame -> [deband, at the film's size] -> EASU, to the output size -> [RCAS] -> canvas
// Passes that are off are skipped, not run as no-ops. All targets are RGBA8.

import {VERTEX, DEBAND, EASU, RCAS} from './fsr.js';

export class Filter {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw Error('This browser has no WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    this.programs = {deband: program(gl, DEBAND, ['src', 'size', 'seed']), easu: program(gl, EASU, ['src', 'outSize', 'scale']), rcas: program(gl, RCAS, ['src', 'sharp'])};
    this.frame = texture(gl, gl.LINEAR); // the deband pass samples between texels
    this.targets = {};
    this.size = {in: [0, 0], out: [0, 0]};
    this.seed = 0;
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** A render target of this size, kept and reused. */
  target(name, w, h) {
    const gl = this.gl;
    let t = this.targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = texture(gl, gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return this.targets[name] = {tex, fb, w, h};
  }

  /**
   * Uploads the element's current frame. Throws SecurityError for a film the
   * page may not read (the caller turns the filter off for that film).
   * @param {HTMLVideoElement} video
   */
  upload(video) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.size.in = [video.videoWidth, video.videoHeight];
  }

  /**
   * Draws the uploaded frame to the canvas at its current size.
   * @param {{sharpen: number, deband: boolean}} s
   */
  draw({sharpen, deband}) {
    const gl = this.gl, [iw, ih] = this.size.in, ow = this.canvas.width, oh = this.canvas.height;
    let src = this.frame;
    if (deband) {
      const t = this.target('deband', iw, ih), p = this.programs.deband;
      pass(gl, p, t.fb, iw, ih, src);
      gl.uniform2f(p.u.size, iw, ih); gl.uniform1f(p.u.seed, this.seed = (this.seed + 1) % 64);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t.tex;
    }
    const easu = this.programs.easu, sharp = sharpen > 0;
    const t = sharp ? this.target('easu', ow, oh) : null;
    pass(gl, easu, t?.fb || null, ow, oh, src);
    gl.uniform2f(easu.u.outSize, ow, oh); gl.uniform2f(easu.u.scale, iw / ow, ih / oh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!t) return;
    const rcas = this.programs.rcas;
    pass(gl, rcas, null, ow, oh, t.tex);
    gl.uniform1f(rcas.u.sharp, 2 ** -(2 * (1 - Math.min(1, sharpen)))); // sharpen 1 is RCAS at 0 stops (its strongest), a small amount 2 stops
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Frees what the GPU holds (the context itself goes with the canvas). */
  destroy() {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    gl.deleteTexture(this.frame);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function pass(gl, p, fb, w, h, src) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, w, h);
  gl.useProgram(p.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(p.u.src, 0);
}

function texture(gl, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function program(gl, fragment, uniforms) {
  const shader = (type, text) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, text); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw Error('A picture shader did not compile: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw Error('A picture shader did not link: ' + gl.getProgramInfoLog(p));
  return {program: p, u: Object.fromEntries(uniforms.map(n => [n, gl.getUniformLocation(p, n)]))};
}
