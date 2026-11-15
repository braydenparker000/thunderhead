// ASS/SSA drawn by libass (JASSUB: libass in WebAssembly, drawing on its own
// canvas from a worker), so signs, typesetting, karaoke and the film's own
// fonts look as authored. The engine hands this layer the script's header,
// its events as they are read, and the fonts attached to the film; nothing
// here knows Matroska. JASSUB is fetched on the first start only (about
// 2.4 MB, vendor/jassub/), and every failure is a `false` from start(), so
// the caller keeps Astra's own renderer.
//
// The drawing is ours to pace: a frame is asked of libass only while the
// layer is shown and an event is on screen (plus one empty frame to clear
// it), so subtitles that are off or silent cost nothing on a slow phone.
// Without cross-origin isolation (this site cannot send the headers) JASSUB
// renders on one thread, which is enough for a phone's picture size.

import {CueList} from './renderer.js';
import {parseAssHeader} from './ass.js';
import {parseTime} from './markup.js';

const BASE = new URL('../../vendor/jassub/', import.meta.url).href;
const START_TIMEOUT = 20_000; // a worker that never answers counts as a failure
const EVENTS_FORMAT = 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

let loading = null; // the JASSUB module, imported once per page
const loadJassub = () => loading ??= import(BASE + 'jassub.js').then(m => m.default).catch(e => { loading = null; throw e; });

export class LibassLayer {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} layer  positioned over the video, same box
   * @param {{rect?: () => {x: number, y: number, w: number, h: number}}} [options]  where the picture is, in layer pixels
   */
  constructor(video, layer, {rect} = {}) {
    this.video = video;
    this.layer = layer;
    this.rect = rect || (() => containRect(video, layer));
    this.times = new CueList(); // when each event shows, so frames are asked only while one does
    this.seen = new Set(); // Dialogue lines already given (a seek may read them again)
    this.delay = 0;
    this.visible = true;
    this.drawn = false; // whether the canvas may hold a picture
    this.frame = 0;
    this.jassub = null;
    this.ready = false;
    this.dead = false;
    this.format = null;
  }

  /**
   * Starts libass with the script's header ([Script Info], styles and the
   * [Events] Format line; a whole .ass file works too) and the film's fonts.
   * Resolves true once libass draws, false when it cannot (never rejects).
   * @param {{header: string, fonts?: Array<{name?: string, data: Uint8Array}>}} script
   */
  async start({header, fonts = []}) {
    if (this.dead || this.jassub) return false;
    let text = String(header ?? '').replace(/^﻿/, '');
    // libass needs the events' Format line to read later blocks; old Matroska muxers left it out.
    if (!/^\s*\[events\]/im.test(text)) text += '\n[Events]\n' + EVENTS_FORMAT + '\n';
    else if (!/^\[events\][^[]*^\s*format\s*:/im.test(text)) text = text.replace(/^(\s*\[events\]\s*)$/im, '$1\n' + EVENTS_FORMAT);
    this.format = parseAssHeader(text).eventFormat;
    for (const line of text.split(/\r?\n/)) if (/^Dialogue\s*:/i.test(line)) this.note(line);
    const canvas = document.createElement('canvas');
    canvas.className = 'astra-sub-libass';
    Object.assign(canvas.style, {position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: '0', height: '0'});
    this.canvas = canvas;
    try {
      const JASSUB = await loadJassub();
      if (this.dead) return false;
      this.place();
      this.layer.append(canvas);
      const jassub = this.jassub = new JASSUB({
        canvas, subContent: text,
        // The fallback font (Liberation Sans) is loaded before the first frame with the film's own:
        // fetched later on demand, the first frame of a paused picture would be drawn without text.
        fonts: [BASE + 'default.woff2', ...fonts.map(f => f?.data).filter(d => d instanceof Uint8Array && d.byteLength)],
        availableFonts: {}, defaultFont: 'liberation sans',
        queryFonts: false, // never the phone's own fonts (a permission) nor Google's (another origin)
        maxRenderHeight: 1080,
        workerUrl: BASE + 'worker/worker.js',
        wasmUrl: BASE + 'wasm/jassub-worker.wasm', wasmWorkerUrl: BASE + 'wasm/jassub-worker.js',
        modernWasmUrl: BASE + 'wasm/jassub-worker-modern.wasm', modernWasmWorkerUrl: BASE + 'wasm/jassub-worker-modern.js',
      });
      let timer;
      const broken = new Promise((_, reject) => {
        jassub._worker.addEventListener('error', () => reject(new Error('worker')), {once: true});
        timer = setTimeout(() => reject(new Error('timeout')), START_TIMEOUT);
      });
      await Promise.race([jassub.ready, broken]).finally(() => clearTimeout(timer));
      if (this.dead) return false;
      this.ready = true;
    } catch {
      this.destroy();
      return false;
    }
    this.listen();
    this.colorSpace();
    this.draw(this.video.currentTime, true);
    this.schedule();
    return true;
  }

  /**
   * Adds whole Dialogue lines ("Dialogue: 0,0:00:01.00,…") as they are read;
   * a line given twice is added once. Blocks from a Matroska track go
   * through addBlocks() instead.
   * @param {string[]} lines
   */
  addEvents(lines) {
    const fresh = [];
    for (const line of lines || []) if (typeof line === 'string' && /^Dialogue\s*:/i.test(line) && this.note(line)) fresh.push(line);
    if (fresh.length) this.feed(r => r.processData(fresh.join('\n')));
  }

  /**
   * Adds Matroska S_TEXT/ASS blocks: {text, start, duration} with the block's
   * own text ("ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text")
   * and its time in seconds. libass drops a ReadOrder it already holds, so a
   * block read again after a seek is harmless.
   * @param {Array<{text: string, start: number, duration: number}>} blocks
   */
  addBlocks(blocks) {
    const fresh = (blocks || []).filter(b => typeof b?.text === 'string' && Number.isFinite(b.start) && Number.isFinite(b.duration));
    if (!fresh.length) return;
    this.times.add(fresh.map(b => ({start: b.start, end: b.start + b.duration, key: 'b' + b.text.slice(0, b.text.indexOf(','))})));
    this.feed(r => Promise.all(fresh.map(b => r.processChunk(b.text, Math.round(b.start * 1000), Math.round(b.duration * 1000)))));
  }

  /** Seconds; positive shows subtitles later (as Astra's own renderer). */
  setDelay(seconds) {
    this.delay = Number.isFinite(seconds) ? Math.round(seconds * 10) / 10 : 0;
    this.redraw();
  }

  setVisible(visible) {
    this.visible = !!visible;
    if (this.canvas) this.canvas.style.display = this.visible ? '' : 'none';
    if (this.visible) this.redraw(); else this.unschedule();
  }

  /** Ends the worker and frees the canvas. Safe to call more than once. */
  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.unschedule();
    this.listening?.abort();
    this.resize?.disconnect();
    const jassub = this.jassub;
    this.jassub = null;
    if (jassub) {
      // destroy() alone waits for a start that may never finish: the worker is ended at once too.
      jassub.destroy().catch(() => {});
      try { jassub._worker.terminate(); } catch {}
    }
    this.canvas?.remove();
    this.canvas = null;
  }

  // Inside.

  /** Records when a Dialogue line shows; false when it was given before. */
  note(line) {
    if (this.seen.has(line)) return false;
    this.seen.add(line);
    const fields = line.slice(line.indexOf(':') + 1).split(',');
    const format = this.format || ['layer', 'start', 'end'];
    const start = parseTime(fields[format.indexOf('start')] ?? ''), end = parseTime(fields[format.indexOf('end')] ?? '');
    if (start != null && end != null && end > start) this.times.add([{start, end, key: line}]);
    return true;
  }

  /** Sends to the worker once started (or drops it once destroyed), then shows what changed. */
  feed(send) {
    if (this.dead || !this.jassub) return;
    Promise.resolve(this.jassub.ready).then(() => {
      if (this.dead || !this.ready) return;
      return Promise.resolve(send(this.jassub.renderer)).then(() => this.redraw());
    }).catch(() => {});
  }

  listen() {
    this.listening = new AbortController();
    const signal = this.listening.signal, video = this.video;
    video.addEventListener('play', () => this.schedule(), {signal});
    for (const type of ['seeked', 'pause', 'loadeddata']) video.addEventListener(type, () => this.redraw(), {signal});
    video.addEventListener('loadeddata', () => this.colorSpace(), {signal});
    video.addEventListener('resize', () => { this.place(); this.redraw(); }, {signal});
    this.resize = new ResizeObserver(() => this.place());
    this.resize.observe(this.layer);
  }

  /** Puts the canvas over the picture; JASSUB sees the canvas resize and sizes its drawing to match. */
  place() {
    if (!this.canvas) return;
    const r = this.rect();
    Object.assign(this.canvas.style, {left: r.x.toFixed(1) + 'px', top: r.y.toFixed(1) + 'px', width: Math.max(0, r.w).toFixed(1) + 'px', height: Math.max(0, r.h).toFixed(1) + 'px'});
  }

  /** Draws the current frame now (paused, seeked, a change of delay or events), then follows the picture. */
  redraw() {
    if (!this.ready || this.dead) return;
    this.draw(this.video.currentTime, true);
    this.schedule();
  }

  /** Asks libass for the frame at media time `time`, unless nothing is on screen and nothing was. */
  draw(time, repaint) {
    const jassub = this.jassub, video = this.video;
    if (!this.ready || !this.visible || !jassub || !video.videoWidth) return;
    const on = this.times.at(time - this.delay).length > 0;
    if (!on && !this.drawn) return;
    this.drawn = on;
    jassub.timeOffset = -this.delay;
    jassub.manualRender({mediaTime: time, width: video.videoWidth, height: video.videoHeight, expectedDisplayTime: performance.now()}, repaint).catch(() => {});
  }

  /** Follows the picture frame by frame while it plays and the layer is shown. */
  schedule() {
    if (this.frame || this.dead || !this.ready || !this.visible || this.video.paused || !this.times.size) return;
    this.frame = this.video.requestVideoFrameCallback((now, meta) => {
      this.frame = 0;
      this.draw(meta.mediaTime, false);
      this.schedule();
    });
  }

  unschedule() {
    if (this.frame) this.video.cancelVideoFrameCallback(this.frame);
    this.frame = 0;
  }

  /** Tells libass the picture's colour matrix, so a script's YCbCr Matrix converts colours as authored. */
  colorSpace() {
    if (typeof VideoFrame === 'undefined' || !this.video.videoWidth) return;
    try {
      const frame = new VideoFrame(this.video), {matrix, fullRange} = frame.colorSpace;
      frame.close();
      this.feed(r => r._setColorSpace(matrix, fullRange));
    } catch {} // a picture from another origin without CORS cannot be read: colours stay as written
  }
}

/** Where the picture sits in the layer when it is fitted whole (object-fit: contain). */
function containRect(video, layer) {
  const W = layer.clientWidth, H = layer.clientHeight, vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !W || !H) return {x: 0, y: 0, w: W, h: H};
  const s = Math.min(W / vw, H / vh);
  return {x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s};
}
