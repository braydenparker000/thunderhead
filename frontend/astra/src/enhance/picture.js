// A sharper picture for small, low-bitrate films on a bigger screen: the film
// is drawn through the filter (filter.js: de-band, an upscale, either FSR 1.0 or
// Anime4K for drawn animation, and a sharpen) onto a canvas laid exactly over the <video>, which keeps playing,
// and keeps its sound, underneath. No UI: the player's menus call set().
//
// It never makes the film worse than the plain video:
// - it draws only when the element presents a new frame (requestVideoFrameCallback),
//   and not while the page is hidden or the film is in picture-in-picture;
// - the canvas is added after the first good frame and removed when the filter
//   is off, so the plain video shows;
// - a film the page may not read (SecurityError on upload), a lost WebGL context
//   (one more try when it comes back) or a device too slow for it turn it off,
//   and onReport says why;
// - when frames start to be missed it steps down: Anime4K to Standard, then
//   de-band off, then a smaller output, then off.

import {Filter} from './filter.js';
import {unreadable} from './origin.js';

/** The largest output drawn, in device pixels. */
export const MAX_OUT = [1920, 1080];
/** Output sizes tried in turn when the device falls behind, as a share of the full size. */
const SCALES = [1, 0.75, 0.5];

/**
 * HDR films, measured in this repository's Chromium with a VP9 profile 2, PQ, BT.2020 clip of grey
 * patches (5, 20, 100, 203 and 1000 nits). An RGBA8 upload is converted to sRGB with 203 nits as
 * white and clipped above it: 43, 88, 184, 255, 255. A half-float upload (RGBA16F) keeps them:
 * 0.169, 0.346, 0.723, 0.998, 1.977, which is still display-encoded, not linear: the sRGB curve
 * extended past 1.0, 1.0 at 203 nits, already in the canvas's primaries (unpackColorSpace; colours
 * outside them come as negative values). Chrome's own picture (a plain <video>, read through a 2D
 * canvas) tone-maps: 29, 63, 135, 187, 254. So an HDR film is uploaded as half floats and
 * tone-mapped (tonemap.js, BT.2390) before the other passes; on this clip the filter draws 29, 63,
 * 136, 188, 255. Where half floats cannot be drawn into, the plain video shows, with this reason.
 */
export const HDR = Object.freeze({whiteNits: 203, toneMapped: true, reason: 'HDR films keep the plain picture on this device: it cannot draw them at the precision their highlights need.'});
/** Upscales the filter offers: FSR 1.0 for any film, Anime4K's network for drawn animation. */
export const UPSCALES = ['standard', 'anime'];

/**
 * The size, in CSS pixels, at which the element shows its picture: its box
 * fitted by object-fit (contain, cover, fill, none, scale-down).
 */
export function shownSize(box, video, fit) {
  const [bw, bh] = box, [vw, vh] = video;
  if (!vw || !vh) return [bw, bh];
  const contain = Math.min(bw / vw, bh / vh), cover = Math.max(bw / vw, bh / vh);
  if (fit === 'fill') return [bw, bh];
  if (fit === 'cover') return [vw * cover, vh * cover];
  if (fit === 'none') return [vw, vh];
  if (fit === 'scale-down') return contain < 1 ? [vw * contain, vh * contain] : [vw, vh];
  return [vw * contain, vh * contain];
}

/**
 * The output size in device pixels for a picture shown at `shown` CSS
 * pixels: capped to MAX_OUT (keeping its shape), times `scale`, and never
 * below the film's own size (smaller than that, the filter has nothing to add).
 */
export function outputSize(shown, dpr, film, scale = 1) {
  let [w, h] = [shown[0] * dpr, shown[1] * dpr];
  const cap = Math.min(1, MAX_OUT[0] / w, MAX_OUT[1] / h);
  w = Math.round(w * cap * scale); h = Math.round(h * cap * scale);
  if (w <= film[0] * 1.05 || h <= film[1] * 1.05) return [film[0], film[1]];
  return [w, h];
}

/** An element's place in the page from its offsets, which leave out CSS transforms. */
function offsetOf(el) {
  let x = 0, y = 0;
  for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft + (e === el ? 0 : e.clientLeft); y += e.offsetTop + (e === el ? 0 : e.clientTop); }
  return [x, y];
}

export class Picture {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} layer  an element over the video and under the subtitles; the canvas goes in first
   * @param {{onReport?: (reason: string) => void, hdr?: boolean}} [options]  hdr: the film is HDR (PQ), uploaded and tone-mapped as such
   */
  constructor(video, layer, {onReport, hdr = false} = {}) {
    Object.assign(this, {video, layer, hdr, onReport: onReport || (() => {})});
    this.settings = {sharpen: 0, deband: false};
    this.upscale = 'standard'; this.restore = false; // Anime4K's Restore CNN before the upscale: off (its cost, see anime4k.js)
    this.fallback = ''; // why Standard is drawn although Anime4K was asked for: 'slow' (stepped down) or 'device' (no half floats)
    this.on = false; this.filter = null; this.canvas = null; this.frameId = 0;
    this.level = 0; // 0 everything, 1 no de-band, 2 and 3 smaller outputs
    this.reason = ''; this.restored = false; this.refused = '';
    this.stats = {ms: 0, frames: 0, missed: 0, dropped: 0, total: 0, bad: 0, last: 0};
    this.onFrame = (now, meta) => this.frame(meta);
    this.onShape = () => this.place();
    this.onWake = () => this.request();
    // A new film is a fresh start: it may be readable (or fast enough) where the last was not.
    this.onLoad = () => { this.refused = ''; this.level = 0; this.reason = ''; this.fallback = ''; if (this.wanted()) this.start(); };
    video.addEventListener('loadstart', this.onLoad);
  }

  report(reason) { this.reason = reason; this.onReport(reason); }
  wanted() { return this.settings.sharpen > 0 || this.settings.deband || this.upscale === 'anime'; }

  /** {sharpen: 0-1, deband: bool, upscale: 'standard' | 'anime'}; sharpen 0, de-band off and Standard turn the filter off. */
  set(next = {}) {
    const s = {...this.settings, ...next};
    this.settings = {sharpen: Math.min(1, Math.max(0, +s.sharpen || 0)), deband: !!s.deband};
    if ('upscale' in next) { const u = UPSCALES.includes(next.upscale) ? next.upscale : 'standard'; if (u !== this.upscale) this.fallback = ''; this.upscale = u; }
    if (!this.wanted()) { this.stop(); this.reason = ''; return true; }
    return this.start();
  }

  state() {
    return {on: this.on, shown: !!this.canvas?.isConnected, settings: {...this.settings}, upscale: this.upscale, drawn: this.filter?.used || '', fallback: this.fallback, level: this.level, size: this.filter && {...this.filter.size, out: [this.canvas?.width, this.canvas?.height]}, ms: +this.stats.ms.toFixed(2), reason: this.reason};
  }

  start() {
    const why = this.refused || unreadable(this.video);
    if (why) { this.stop(); this.report(why); return false; }
    if (this.on) { this.request(); return true; }
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'astra-picture';
      Object.assign(this.canvas.style, {position: 'absolute', pointerEvents: 'none', margin: '0'});
      // Only this canvas's loss counts: the one stop() lets go of is lost on purpose, a moment later.
      const canvas = this.canvas;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (canvas === this.canvas) this.lost(); });
      canvas.addEventListener('webglcontextrestored', () => { if (canvas === this.canvas) this.restore(); });
      this.filter = new Filter(this.canvas);
    } catch (e) { this.stop(); this.report(`The sharper picture could not start: ${e.message}`); return false; }
    if (this.hdr && !this.filter.half) { this.stop(); this.report(HDR.reason); return false; }
    this.on = true;
    this.watch = new ResizeObserver(this.onShape);
    this.watch.observe(this.video); this.watch.observe(this.layer);
    this.attrs = new MutationObserver(this.onShape);
    this.attrs.observe(this.video, {attributes: true, attributeFilter: ['class', 'style', 'data-aspect']});
    for (const [t, type] of [[this.video, 'resize'], [this.video, 'leavepictureinpicture'], [document, 'visibilitychange']]) t.addEventListener(type, type === 'resize' ? this.onShape : this.onWake);
    this.resetStats();
    this.place();
    this.request();
    return true;
  }

  stop() {
    this.on = false;
    if (this.frameId) this.video.cancelVideoFrameCallback(this.frameId);
    this.frameId = 0;
    this.watch?.disconnect(); this.attrs?.disconnect();
    this.video.removeEventListener('resize', this.onShape);
    this.video.removeEventListener('leavepictureinpicture', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    this.filter?.destroy(); this.filter = null;
    this.canvas?.remove(); this.canvas = null;
  }

  /** Off for this film, with the reason. */
  refuse(reason) { this.refused = reason; this.stop(); this.report(reason); }

  request() {
    if (!this.on || this.frameId || document.hidden || !this.filter) return;
    this.frameId = this.video.requestVideoFrameCallback(this.onFrame);
    // A paused film presents no new frame: draw the one shown now, once.
    if (this.video.paused && this.video.readyState >= 2 && !this.canvas?.isConnected) queueMicrotask(() => this.draw());
  }

  /** Lays the canvas over the video's box and mirrors how it fits the picture in it. */
  place() {
    const c = this.canvas, v = this.video;
    if (!c || !this.filter) return;
    // Untransformed boxes (offset sizes, not getBoundingClientRect): a pinch zoom scales the layer and the
    // canvas in it with the video, so a measured, already-zoomed size would be zoomed a second time.
    const at = offsetOf(v), base = offsetOf(this.layer), css = getComputedStyle(v);
    const box = {left: at[0] - base[0] - this.layer.clientLeft, top: at[1] - base[1] - this.layer.clientTop, width: v.offsetWidth, height: v.offsetHeight};
    Object.assign(c.style, {left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, objectFit: css.objectFit, objectPosition: css.objectPosition});
    const film = [v.videoWidth, v.videoHeight];
    if (!film[0]) return;
    const [w, h] = outputSize(shownSize([box.width, box.height], film, css.objectFit), devicePixelRatio || 1, film, SCALES[Math.max(0, this.level - 1)]);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.resetStats(); }
  }

  frame(meta) {
    this.frameId = 0;
    if (!this.on) return;
    if (document.pictureInPictureElement === this.video || document.hidden) return; // picked up again on leaving
    this.measure(meta);
    if (this.on) this.draw();
    this.request();
  }

  draw() {
    if (!this.on || !this.filter || this.filter.gl.isContextLost()) return;
    if (this.hdr && !this.filter.half) return this.refuse(HDR.reason);
    const t0 = performance.now();
    try { this.filter.upload(this.video, this.hdr); }
    catch (e) {
      if (e?.name === 'SecurityError') return this.refuse('This film comes from a host that does not let the page read its picture, so the plain picture stays.');
      if (this.hdr) return this.refuse(HDR.reason);
      return this.refuse(`The sharper picture stopped: ${e?.message || e}`);
    }
    if (this.canvas && this.filter.size.in[0] && (this.canvas.width < 2 || this.filter.size.in.join() !== this.film)) { this.film = this.filter.size.in.join(); this.place(); }
    const anime = this.upscale === 'anime' && !this.fallback;
    if (anime && !this.filter.half) this.fallback = 'device';
    this.filter.draw({sharpen: this.settings.sharpen, deband: this.settings.deband && this.level === 0, upscale: anime ? 'anime' : 'standard', restore: this.restore});
    this.stats.ms = this.stats.ms * 0.9 + (performance.now() - t0) * 0.1;
    if (this.canvas && !this.canvas.isConnected) this.layer.prepend(this.canvas);
  }

  resetStats() { Object.assign(this.stats, {frames: 0, missed: 0, last: 0, warm: 12, dropped: 0, total: 0, at: performance.now()}); this.stats.quality = this.video.getVideoPlaybackQuality?.(); }

  /**
   * Keeps count of frames the element presented that were never drawn here
   * (presentedFrames jumps) and frames the browser dropped, over two-second
   * windows. Two bad windows in a row step the filter down.
   */
  measure(meta) {
    const s = this.stats;
    if (s.last && meta.presentedFrames > s.last) { const gap = meta.presentedFrames - s.last; s.frames += gap; s.missed += gap - 1; }
    s.last = meta.presentedFrames;
    if (s.warm > 0) { s.warm--; if (!s.warm) { s.frames = s.missed = 0; s.at = performance.now(); s.quality = this.video.getVideoPlaybackQuality?.(); } return; }
    if (performance.now() - s.at < 2000 || s.frames < 12 || this.video.paused) return;
    const q = this.video.getVideoPlaybackQuality?.(), dropped = q && s.quality ? q.droppedVideoFrames - s.quality.droppedVideoFrames : 0, total = q && s.quality ? q.totalVideoFrames - s.quality.totalVideoFrames : s.frames;
    const slow = s.missed / s.frames > 0.15 || (total > 0 && dropped / total > 0.1);
    s.bad = slow ? s.bad + 1 : 0;
    Object.assign(s, {frames: 0, missed: 0, at: performance.now(), quality: q});
    if (s.bad >= 2) { s.bad = 0; this.stepDown(); }
  }

  stepDown() {
    // Anime4K first: Standard costs a fraction of it, so that alone may be enough.
    if (this.upscale === 'anime' && !this.fallback && this.filter?.used === 'anime') { this.fallback = 'slow'; return this.resetStats(); }
    const before = this.canvas?.width || 0, slow = 'This device cannot draw the sharper picture fast enough, so the plain picture stays.';
    this.level = this.level === 0 && this.settings.deband ? 1 : Math.max(2, this.level + 1);
    if (this.level > SCALES.length) return this.refuse(slow);
    this.place();
    // A smaller output that is no smaller (already the film's own size) is no step.
    if (this.level >= 2 && (this.canvas?.width || 0) >= before) return this.refuse(slow);
    this.resetStats();
  }

  lost() { this.canvas?.remove(); if (this.frameId) this.video.cancelVideoFrameCallback(this.frameId); this.frameId = 0; }

  /** One more try after the GPU comes back; a second loss turns the filter off. */
  restore() {
    if (this.restored) return this.refuse('The graphics context was lost twice, so the plain picture stays.');
    this.restored = true;
    try { this.filter = new Filter(/** @type {HTMLCanvasElement} */ (this.canvas)); }
    catch (e) { return this.refuse(`The sharper picture could not restart: ${e.message}`); }
    this.place(); this.request();
  }

  close() {
    this.stop();
    this.video.removeEventListener('loadstart', this.onLoad);
  }
}
