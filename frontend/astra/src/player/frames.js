// Frame by frame and stills. While paused, the two buttons beside play step
// one frame back or forward (the file's frame rate when the engine knows it,
// else 24). "Save this frame" (stream info) draws the frame at the video's
// own size, without subtitles, and downloads it as a PNG named after the
// title and the time: never the stream's or the add-on's name.

import {clock, h} from '../ui/dom.js';
import {frameStep, stillName} from './rules.js';

export const NOT_READABLE = "This film's host does not allow saving a frame";

export class Frames {
  constructor(p) { this.p = p; }

  step(direction) {
    const p = this.p, v = p.video;
    if (!v.paused || !p.firstFrame) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    v.currentTime = Math.min(d, frameStep(v.currentTime, direction, p.engine.info?.video?.[0]?.frameRate));
    p.updateTime();
    p.showControls(false);
  }

  /** The current frame as a PNG; a film the page may not read (another host, played directly) says so. */
  async save() {
    const p = this.p, v = p.video;
    if (!v.videoWidth || !p.firstFrame) { p.notice('There is no picture to save yet'); return; }
    const canvas = h('canvas', {width: v.videoWidth, height: v.videoHeight});
    let blob = null, error = null;
    try {
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve, reject) => { try { canvas.toBlob(resolve, 'image/png'); } catch (e) { reject(e); } });
    } catch (e) { error = e; }
    if (!blob) { p.notice(error?.name === 'SecurityError' ? NOT_READABLE : 'This frame could not be saved'); return; }
    const m = p.meta || {}, code = (m.episodeLine || '').split('•')[0].trim();
    const a = h('a', {href: URL.createObjectURL(blob), download: stillName([m.title, code].filter(Boolean).join(' '), v.currentTime, clock)});
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    p.notice('Frame saved');
  }
}
