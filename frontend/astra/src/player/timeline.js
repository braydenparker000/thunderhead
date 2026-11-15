// The seek bar: the played and buffered lengths, the thumb, the time bubble
// while dragging, and what a screen reader hears. Dragging shares p.scrub
// ({active, time}) with the swipe on the picture. A stream with no length (a
// live one) shows a full bar marked Live and cannot be dragged.

import {clock} from '../ui/dom.js';
import {put} from './view.js';

export class Timeline {
  constructor(p) {
    this.p = p;
    this.pointer = null;
    this.bind();
  }

  bind() {
    const p = this.p, tl = p.timeline;
    const length = () => { const d = p.video.duration; return Number.isFinite(d) && d > 0 ? d : 0; };
    const at = e => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))) * length(); };
    const bubble = () => {
      const f = p.scrub.time / (length() || 1);
      p.bubble.textContent = clock(p.scrub.time);
      p.bubble.style.left = `clamp(28px, ${(f * 100).toFixed(2)}%, calc(100% - 28px))`;
      p.bubble.hidden = false;
    };
    tl.addEventListener('pointerdown', e => {
      if (p.ctl.locked || !length() || this.pointer != null) return;
      this.pointer = e.pointerId;
      try { tl.setPointerCapture(e.pointerId); } catch {}
      tl.classList.add('active');
      p.scrub.active = true; p.scrub.time = at(e); p.updateTime(); bubble(); p.showControls(false);
    });
    tl.addEventListener('pointermove', e => { if (this.pointer === e.pointerId) { p.scrub.time = at(e); p.updateTime(); bubble(); } });
    const end = e => {
      if (this.pointer !== e.pointerId) return;
      try { if (e.type === 'pointerup' && p.scrub.time != null && length()) p.video.currentTime = p.scrub.time; }
      finally { this.stop(); }
      p.updateTime(); p.scheduleHide();
    };
    tl.addEventListener('pointerup', end);
    tl.addEventListener('pointercancel', end);
    tl.addEventListener('lostpointercapture', end);
    tl.addEventListener('keydown', e => {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && length()) { e.preventDefault(); e.stopPropagation(); p.seekBy(e.key === 'ArrowLeft' ? -5 : 5); p.showControls(); }
    });
  }

  /** Ends a drag without seeking. */
  stop() {
    const p = this.p;
    this.pointer = null;
    p.timeline.classList.remove('active');
    p.bubble.hidden = true;
    p.scrub.time = null; p.scrub.active = false;
  }

  /** Draws position `t` of duration `d` (Infinity for live): the bars, the thumb, the lock screen's line and the slider's values. */
  update(t, d) {
    const p = this.p, live = d === Infinity;
    p.timeline.classList.toggle('live', live);
    if (live) {
      put(p.played, 'transform', 'scaleX(1)'); put(p.buffered, 'transform', 'scaleX(1)'); put(p.thumb, 'transform', 'translateX(100%)'); put(p.lockFill, 'transform', 'scaleX(1)');
      put(p.timeline, 'aria-valuetext', 'Live');
      return;
    }
    if (!(d > 0)) return;
    const f = Math.min(1, t / d);
    put(p.played, 'transform', `scaleX(${f.toFixed(4)})`);
    put(p.thumb, 'transform', `translateX(${(f * 100).toFixed(2)}%)`); // a transform: moving it costs no layout
    put(p.lockFill, 'transform', `scaleX(${f.toFixed(4)})`);
    const b = p.video.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= p.video.currentTime + 0.5) end = Math.max(end, b.end(i));
    put(p.buffered, 'transform', `scaleX(${Math.min(1, end / d).toFixed(4)})`);
    put(p.timeline, 'aria-valuemax', String(Math.round(d)));
    put(p.timeline, 'aria-valuenow', String(Math.round(t)));
    put(p.timeline, 'aria-valuetext', `${clock(t)} of ${clock(d)}`);
  }

  close() { if (this.pointer != null || this.p.scrub.active) this.stop(); }
}
