// Draws subtitle cues over the picture. Text is built from text nodes only.
// Style and timing offset are the viewer's; positions come from the cue.
// Picture subtitles (PGS, VobSub) are drawn on canvases placed over the part
// of the element the video actually fills, so Fit, Fill and Zoom line up.
// An ASS/SSA track can instead be drawn by libass (useLibass, libass.js).

import {MAX_FRAME} from './pgs.js';
import {LibassLayer} from './libass.js';

// Drawn pictures are kept only for a re-draw (a resize, a style change, a
// short seek back): the last few, and never more than 32 MB of pixels. A
// film has over a thousand, and the engine holds every cue until it ends.
const KEEP = 6, KEEP_PIXELS = 8 << 20;

export const DEFAULT_STYLE = Object.freeze({
  size: 1, // multiple of the base size (5.2% of the picture height)
  color: '#ffffff',
  background: 0, // 0..1 opacity of a box behind each line
  outline: true,
  bold: false,
  offset: 6, // % of the picture height above the bottom
});

const ZONES = ['top', 'middle', 'bottom'];
const zoneOf = align => align >= 7 ? 'top' : align >= 4 ? 'middle' : 'bottom';
const columnOf = align => ['left', 'center', 'right'][(align - 1) % 3];

export class CueList {
  constructor() { this.cues = []; this.keys = new Set(); this.longest = 0; }
  add(cues) {
    let added = 0;
    for (const cue of cues) {
      const key = cue.key || cue.start.toFixed(3) + '|' + cue.spans.map(s => s.text).join('');
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.longest = Math.max(this.longest, cue.end - cue.start);
      // Cues mostly arrive in order: insert from the end.
      let i = this.cues.length;
      while (i > 0 && this.cues[i - 1].start > cue.start) i--;
      this.cues.splice(i, 0, cue);
      added++;
    }
    return added;
  }
  /** Cues showing at time t. */
  at(t) {
    let lo = 0, hi = this.cues.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cues[mid].start <= t) lo = mid + 1; else hi = mid; }
    const active = [];
    for (let i = lo - 1; i >= 0 && this.cues[i].start >= t - this.longest; i--) if (this.cues[i].end > t) active.unshift(this.cues[i]);
    return active;
  }
  get size() { return this.cues.length; }
  /** Recomputes the longest cue after end times were changed in place. */
  refresh() { this.longest = this.cues.reduce((m, c) => Math.max(m, c.end - c.start), 0); }
}

export class SubtitleRenderer {
  /**
   * @param {HTMLElement} layer  positioned over the video, same box
   * @param {HTMLVideoElement} video
   */
  constructor(layer, video) {
    this.layer = layer;
    this.video = video;
    this.list = new CueList();
    this.delay = 0; // seconds; positive shows subtitles later
    this.style = {...DEFAULT_STYLE};
    this.shown = '';
    this.frame = 0;
    this.libass = null; // the LibassLayer for this track, once asked for
    this.libassDraws = false; // true once it has started: this renderer then draws no text
    layer.classList.add('astra-subs');
    layer.setAttribute('aria-live', 'off');
    this.zones = Object.fromEntries(ZONES.map(z => { const el = document.createElement('div'); el.className = 'astra-subs-zone ' + z; layer.append(el); return [z, el]; }));
    this.free = document.createElement('div');
    this.free.className = 'astra-subs-free';
    this.pictures = document.createElement('div');
    this.pictures.className = 'astra-subs-pictures';
    layer.append(this.free, this.pictures);
    this.canvases = new Map(); // cue part -> drawn canvas, least recently shown first
    this.resize = new ResizeObserver(() => { this.applyStyle(); this.shown = null; this.render(); });
    this.resize.observe(layer);
    this.tick = () => { this.frame = 0; this.render(); if (!this.video.paused) this.schedule(); };
    // Frame callbacks keep cues exact while playing; the events also draw at
    // once, since a paused seek may not present a frame callback.
    this.listening = new AbortController();
    const signal = this.listening.signal;
    for (const type of ['play', 'seeked', 'timeupdate', 'loadeddata']) video.addEventListener(type, () => { this.render(); this.schedule(); }, {signal});
    video.addEventListener('resize', () => { this.shown = null; this.render(); }, {signal});
    this.applyStyle();
  }

  /** Asks for the next frame. Not while there is nothing to draw (no track, or subtitles off): the page then sleeps between frames. */
  schedule() {
    if (this.frame || !this.list.size || this.libassDraws || this.listening.signal.aborted) return;
    this.frame = this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(this.tick) : requestAnimationFrame(this.tick);
    this.frameKind = this.video.requestVideoFrameCallback ? 'video' : 'animation';
  }

  unschedule() {
    if (!this.frame) return;
    if (this.frameKind === 'video') this.video.cancelVideoFrameCallback?.(this.frame); else cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Replaces all cues (switching track; a libass layer for the last track ends). */
  setCues(cues = []) {
    this.dropLibass();
    this.list = new CueList(); this.list.add(cues); this.shown = null; this.render();
    this.dropPictures(); // the last track's pictures, except any still on screen
    if (this.list.size) this.schedule(); else this.unschedule();
  }
  /** Adds cues found while playing. */
  addCues(cues) { if (this.list.add(cues)) { this.shown = null; this.render(); this.schedule(); } }
  clear() { this.setCues([]); }
  /** Cue end times changed in place (picture subtitles learn their end later). */
  refresh() { this.list.refresh(); this.shown = null; this.render(); }

  setStyle(style) { this.style = {...this.style, ...style}; this.applyStyle(); }
  setDelay(seconds) { this.delay = Math.round(seconds * 10) / 10; this.shown = null; this.render(); this.libass?.setDelay(this.delay); }

  /**
   * Hands the current ASS/SSA track to libass; call it after setCues() for that track. Returns the
   * layer at once: give it the track's events (addBlocks for a film's blocks, addEvents for Dialogue
   * lines) as they are read; those given before it has started wait for it. Keep giving this renderer
   * the track's cues too: they are drawn here until libass draws, and for good if it cannot start.
   * Once it draws, this renderer draws no text for the track. Of the viewer's subtitle style only the
   * delay reaches libass: size, colour, box, outline and offset would need JASSUB's style override,
   * which replaces every style of the script and so undoes its signs and typesetting.
   * @param {{header: string, fonts?: Array<{name?: string, data: Uint8Array}>}} script
   */
  useLibass(script) {
    this.dropLibass();
    const libass = this.libass = new LibassLayer(this.video, this.layer, {rect: () => this.pictureRect()});
    libass.setDelay(this.delay);
    libass.start(script).then(ok => {
      if (this.libass !== libass) return;
      if (!ok) { this.libass = null; return; }
      this.libassDraws = true; this.unschedule(); this.shown = null; this.render();
    });
    return libass;
  }

  /** Ends libass for this track; this renderer draws its cues again. */
  dropLibass() {
    if (!this.libass) return;
    this.libass.destroy();
    this.libass = null;
    this.libassDraws = false;
    this.shown = null; this.render(); this.schedule();
  }

  applyStyle() {
    // Sized from the picture's height, but never below a phone-readable size
    // (a portrait screen shows a short picture band).
    const h = Math.max(this.layer.clientHeight || 360, 340), s = this.style;
    const px = Math.max(12, h * 0.052 * s.size);
    const L = this.layer.style;
    L.setProperty('--sub-size', px.toFixed(1) + 'px');
    L.setProperty('--sub-color', s.color);
    L.setProperty('--sub-box', `rgba(0,0,0,${s.background})`);
    L.setProperty('--sub-weight', s.bold ? '700' : '500');
    L.setProperty('--sub-offset', s.offset + '%');
    const o = Math.max(1, px / 14).toFixed(1);
    L.setProperty('--sub-shadow', s.outline ? `0 0 ${o}px #000, ${o}px ${o}px 0 #000, -${o}px -${o}px 0 #000, ${o}px -${o}px 0 #000, -${o}px ${o}px 0 #000` : '0 1px 3px rgba(0,0,0,.6)');
  }

  render() {
    const t = this.video.currentTime - this.delay;
    const active = this.list.at(t);
    const key = active.map(c => c.start + ':' + c.end).join(',');
    if (key === this.shown) return;
    this.shown = key;
    for (const z of Object.values(this.zones)) z.replaceChildren();
    this.free.replaceChildren();
    this.pictures.replaceChildren();
    for (const cue of active) {
      if (cue.image) { this.drawPicture(cue.image); continue; }
      if (this.libassDraws) continue;
      const el = document.createElement('div');
      el.className = 'astra-sub ' + columnOf(cue.align || 2);
      for (const span of cue.spans) {
        const lines = span.text.split('\n');
        lines.forEach((line, i) => {
          if (i) el.append(document.createElement('br'));
          if (!line) return;
          const node = document.createElement('span');
          node.textContent = line;
          if (span.i) node.style.fontStyle = 'italic';
          if (span.b) node.style.fontWeight = '700';
          if (span.u) node.style.textDecoration = 'underline';
          if (span.color && /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(span.color)) node.style.color = span.color;
          el.append(node);
        });
      }
      if (cue.pos) {
        el.style.left = (cue.pos.x * 100).toFixed(2) + '%';
        el.style.top = (cue.pos.y * 100).toFixed(2) + '%';
        const col = (cue.align - 1) % 3, row = cue.align >= 7 ? 0 : cue.align >= 4 ? 50 : 100;
        el.style.transform = `translate(${-col * 50}%, -${row}%)`;
        this.free.append(el);
      } else this.zones[zoneOf(cue.align || 2)].append(el);
    }
    if (this.canvases.size) this.dropPictures(KEEP, KEEP_PIXELS);
  }

  /** The rectangle (in layer pixels) the video picture occupies, measured from the video element itself. */
  pictureRect() {
    const box = this.video.getBoundingClientRect(), layer = this.layer.getBoundingClientRect();
    const W = box.width, H = box.height, vw = this.video.videoWidth, vh = this.video.videoHeight;
    const ox = box.left - layer.left, oy = box.top - layer.top;
    if (!vw || !vh || !W || !H) return {x: ox, y: oy, w: W || layer.width, h: H || layer.height};
    const fit = getComputedStyle(this.video).objectFit;
    if (fit === 'fill') return {x: ox, y: oy, w: W, h: H};
    const scale = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
    const w = vw * scale, h = vh * scale;
    return {x: ox + (W - w) / 2, y: oy + (H - h) / 2, w, h};
  }

  drawPicture(image) {
    const rect = this.pictureRect();
    const sx = rect.w / (image.frameWidth || this.video.videoWidth || rect.w), sy = rect.h / (image.frameHeight || this.video.videoHeight || rect.h);
    for (const part of image.parts) {
      const canvas = this.pictureCanvas(part, image);
      if (!canvas) continue;
      Object.assign(canvas.style, {left: (rect.x + part.x * sx).toFixed(1) + 'px', top: (rect.y + part.y * sy).toFixed(1) + 'px', width: (part.width * sx).toFixed(1) + 'px', height: (part.height * sy).toFixed(1) + 'px'});
      this.pictures.append(canvas);
    }
  }

  /** A part's drawn canvas, from the few kept or drawn now; null when it cannot be drawn. */
  pictureCanvas(part, image) {
    let canvas = this.canvases.get(part);
    if (canvas) { this.canvases.delete(part); this.canvases.set(part, canvas); return canvas; }
    // A part's size is the file's claim. The decoders hold it to its frame
    // (a VobSub .idx without a size gives 720×576 only for placing it); here
    // nothing past the hard cap gets a canvas, made only once the pixels exist.
    const w = part.width, h = part.height;
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) return null;
    if (w > MAX_FRAME.width || h > MAX_FRAME.height) return null;
    try {
      const pixels = part.draw();
      const data = new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), w, h);
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.className = 'astra-sub-picture';
      canvas.getContext('2d').putImageData(data, 0, 0);
    } catch { if (canvas) canvas.width = canvas.height = 0; return null; }
    this.canvases.set(part, canvas);
    return canvas;
  }

  /** Lets go of drawn pictures, oldest first, down to `keep` canvases and `pixels` in all. Those on screen stay. */
  dropPictures(keep = 0, pixels = 0) {
    let held = 0;
    for (const canvas of this.canvases.values()) held += canvas.width * canvas.height;
    for (const [part, canvas] of this.canvases) {
      if (this.canvases.size <= keep && held <= pixels) break;
      if (canvas.parentNode === this.pictures) continue;
      held -= canvas.width * canvas.height;
      this.canvases.delete(part);
      canvas.width = canvas.height = 0; // frees the pixels now rather than at some later collection
    }
  }

  destroy() {
    this.dropLibass();
    this.listening.abort();
    this.resize.disconnect();
    this.unschedule();
    this.layer.replaceChildren();
    this.dropPictures();
  }
}
