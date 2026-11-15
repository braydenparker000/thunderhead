// The picture in the seek bar's bubble (timeline.js): the key frame where a drag would land, from the engine
// (engine.previewAt, player-preview.js). Its box is put in the bubble as the drag begins, shaped like the film
// and empty until a picture arrives, so the bubble never jumps; a picture is asked for once the finger rests
// on a time for REST ms (not on every move), and dropped at release. Off with the Playback menu's "Seek
// previews" switch (the 'seekPreviews' pref), and wherever the engine has none (the data saver, a film the
// browser plays itself, a lost connection). The keyboard's steps show no bubble and ask for none.

import {h} from '../ui/dom.js';

export const REST = 120;

export class SeekPreview {
  constructor(p) {
    this.p = p;
    this.box = h('canvas', {class: 'ap-preview empty', width: 320, height: 180});
    this.on = false; this.timer = 0; this.controller = null; this.drawn = null;
    this.timing = []; // ms from the finger resting to the picture, the last few (the lab and the tests read it)
  }

  /** Whether this drag shows a picture: the pref, and an engine that may have one for this film now. */
  usable() {
    const e = this.p.engine;
    return this.p.prefs.seekPreviews !== false && typeof e?.previewAt === 'function' && !(e.previewsOff?.() ?? true);
  }

  /** A drag begins: the box is reserved, empty. */
  start() {
    this.on = this.usable();
    if (!this.on) return;
    this.box.style.aspectRatio = String(this.p.engine.previewAspect?.() || 16 / 9);
    this.box.classList.add('empty'); this.box.classList.remove('stale');
    this.drawn = null;
    this.box.getContext('2d')?.clearRect(0, 0, this.box.width, this.box.height);
  }

  /** The bubble's first child while it shows a picture. */
  nodes() { return this.on ? [this.box] : []; }

  /** The finger is on `time` now: a picture is asked for once it rests there. */
  moved(time) {
    if (!this.on) return;
    clearTimeout(this.timer);
    if (this.drawn != null) this.box.classList.add('stale'); // the picture shown may be another key frame's
    this.timer = setTimeout(() => this.ask(time), REST);
  }

  async ask(time) {
    this.controller?.abort();
    const c = this.controller = new AbortController(), began = performance.now();
    let picture = null;
    try { picture = await this.p.engine.previewAt(time, {signal: c.signal}); } catch {}
    if (c !== this.controller || c.signal.aborted || !this.on || !picture) return;
    // Copied onto the canvas: the engine's cache may close the bitmap later.
    try {
      if (this.box.width !== picture.width || this.box.height !== picture.height) Object.assign(this.box, {width: picture.width, height: picture.height});
      this.box.getContext('2d').drawImage(picture, 0, 0);
    } catch { return; }
    this.drawn = time;
    this.box.classList.remove('empty', 'stale');
    this.timing.push(Math.round(performance.now() - began + REST));
    if (this.timing.length > 20) this.timing.shift();
  }

  /** Release (or a cancelled drag): nothing more is asked for and the request under way ends. */
  stop() {
    clearTimeout(this.timer); this.timer = 0;
    this.controller?.abort(); this.controller = null;
    this.on = false;
  }
}
