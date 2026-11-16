// The picture filter's WebGL2 work: the film's frame is uploaded once per
// presented frame, then drawn through the passes that are on:
//   frame -> [tone map, HDR films only] -> [deband] -> upscale -> [RCAS] -> canvas
// where the upscale is either EASU to the output size (Standard, fsr.js) or Anime4K's network to
// twice the film's size (anime4k.js), then resampled to the output size. Everything before the
// upscale runs at the film's size. Passes that are off are skipped, not run as no-ops. Targets are
// RGBA8, except where values outside 0..1 or finer steps matter: the tone-mapped picture and
// Anime4K's layers are RGBA16F, which needs a float-renderable WebGL2 (Filter.half).

import {VERTEX, DEBAND, EASU, RCAS, BLIT} from './fsr.js';
import {TONEMAP, WHITE, SOURCE_PEAK, SHOWN_PEAK, curve} from './tonemap.js';
import * as anime4k from './anime4k.js';

/** The screen shows Display P3: an HDR film is brought into it rather than into sRGB. */
const wideScreen = () => !!globalThis.matchMedia?.('(color-gamut: p3)').matches;

export class Filter {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw Error('This browser has no WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    this.programs = {deband: program(gl, DEBAND, ['src', 'size', 'seed']), easu: program(gl, EASU, ['src', 'outSize', 'scale']), rcas: program(gl, RCAS, ['src', 'sharp']), blit: program(gl, BLIT, ['src', 'outSize'])};
    this.frame = texture(gl, gl.LINEAR); // the deband pass and Anime4K sample between texels
    this.targets = {};
    this.size = {in: [0, 0], out: [0, 0]};
    this.seed = 0;
    this.hdr = false; this.space = 'srgb';
    this.used = ''; // the upscale the last draw used: 'standard' or 'anime'
    // Half-float render targets: needed for HDR (values above 1.0 until tone-mapped) and Anime4K (signed layers).
    this.half = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) && renderable(gl, gl.RGBA16F);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** A render target of this size, kept and reused. */
  target(name, w, h, format = this.gl.RGBA8, filter = this.gl.NEAREST) {
    const gl = this.gl;
    let t = this.targets[name];
    if (t && t.w === w && t.h === h && t.format === format) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = texture(gl, filter);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return this.targets[name] = {tex, fb, w, h, format};
  }

  /**
   * Uploads the element's current frame. Throws SecurityError for a film the
   * page may not read (the caller turns the filter off for that film). An HDR film goes up as
   * half floats, which keeps its highlights (an 8-bit upload clips everything over 203 nits), with
   * the browser converting it into the canvas's colour space: Display P3 on a wide-gamut screen.
   * @param {HTMLVideoElement} video
   */
  upload(video, hdr = false) {
    const gl = this.gl, space = hdr && wideScreen() ? 'display-p3' : 'srgb';
    if (space !== this.space && 'unpackColorSpace' in gl) { gl.unpackColorSpace = space; gl.drawingBufferColorSpace = space; this.space = space; }
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, video);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.hdr = hdr;
    this.size.in = [video.videoWidth, video.videoHeight];
  }

  /**
   * Draws the uploaded frame to the canvas at its current size. `upscale` 'anime' runs Anime4K
   * where it applies (half floats, and a picture shown over 1.2 times larger); otherwise Standard.
   * @param {{sharpen: number, deband: boolean, upscale?: string, restore?: boolean}} s
   */
  draw({sharpen, deband, upscale = 'standard', restore = false}) {
    const gl = this.gl, [iw, ih] = this.size.in, ow = this.canvas.width, oh = this.canvas.height;
    let src = this.frame;
    if (this.hdr) {
      const t = this.target('mapped', iw, ih, gl.RGBA16F, gl.LINEAR), p = this.programs.tonemap ||= program(gl, TONEMAP, ['src', 'top', 'maxLum', 'ks', 'white', 'shownPeak']), c = curve(SOURCE_PEAK, SHOWN_PEAK);
      pass(gl, p, t.fb, iw, ih, src);
      gl.uniform1f(p.u.top, c.top); gl.uniform1f(p.u.maxLum, c.maxLum); gl.uniform1f(p.u.ks, c.ks); gl.uniform1f(p.u.white, WHITE); gl.uniform1f(p.u.shownPeak, SHOWN_PEAK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t.tex;
    }
    if (deband) {
      const t = this.target('deband', iw, ih, gl.RGBA8, gl.LINEAR), p = this.programs.deband;
      pass(gl, p, t.fb, iw, ih, src);
      gl.uniform2f(p.u.size, iw, ih); gl.uniform1f(p.u.seed, this.seed = (this.seed + 1) % 64);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t.tex;
    }
    let [sw, sh] = [iw, ih];
    this.used = upscale === 'anime' && this.half && anime4k.runs([iw, ih], [ow, oh]) ? 'anime' : 'standard';
    if (this.used === 'anime') {
      if (!this.a4k || !!this.a4k.restore !== restore) this.a4k = anime4k.build((f, u) => program(gl, f, u), restore);
      src = anime4k.run(this, this.a4k, src, iw, ih); sw = iw * 2; sh = ih * 2;
    }
    // To the output size: EASU enlarges (Standard, or past Anime4K's 2x); a picture already larger
    // than the output (Anime4K's 2x shown at 1.2 to 2 times) is brought down bilinearly.
    const sharp = sharpen > 0, t = sharp ? this.target('easu', ow, oh) : null;
    const easu = sw <= ow && sh <= oh, p = easu ? this.programs.easu : this.programs.blit;
    pass(gl, p, t?.fb || null, ow, oh, src);
    gl.uniform2f(p.u.outSize, ow, oh); if (easu) gl.uniform2f(p.u.scale, sw / ow, sh / oh);
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
    for (const p of [...Object.values(this.programs), ...[...this.a4k?.upscale || [], ...this.a4k?.restore || []].map(a => a.prog)]) gl.deleteProgram(p.program);
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

/** Whether this context can draw into a texture of this format (checked once, at start). */
function renderable(gl, format) {
  const tex = texture(gl, gl.NEAREST), fb = gl.createFramebuffer();
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, 1, 1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
  return ok;
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
