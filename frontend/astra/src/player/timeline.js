// The seek bar: the played and buffered lengths, the thumb, the time bubble
// while dragging, and what a screen reader hears. Dragging shares p.scrub
// ({active, time}) with the swipe on the picture.

import {clock} from '../ui/dom.js';

export class Timeline {
  constructor(p) {
    this.p = p;
    this.pointer = null;
    this.bind();
  }

  bind() {
    const p = this.p, tl = p.timeline;
    const at = e => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (p.video.duration || 0); };
    const bubble = () => {
      const f = p.scrub.time / (p.video.duration || 1);
      p.bubble.textContent = clock(p.scrub.time);
      p.bubble.style.left = `clamp(28px, ${(f * 100).toFixed(2)}%, calc(100% - 28px))`;
      p.bubble.hidden = false;
    };
    tl.addEventListener('pointerdown', e => {
      if (p.ctl.locked || !(p.video.duration > 0)) return;
      this.pointer = e.pointerId; tl.setPointerCapture(e.pointerId); tl.classList.add('active');
      p.scrub.active = true; p.scrub.time = at(e); p.updateTime(); bubble(); p.showControls(false);
    });
    tl.addEventListener('pointermove', e => { if (this.pointer === e.pointerId) { p.scrub.time = at(e); p.updateTime(); bubble(); } });
    const end = e => {
      if (this.pointer !== e.pointerId) return;
      this.pointer = null; tl.classList.remove('active'); p.bubble.hidden = true;
      if (e.type === 'pointerup' && p.scrub.time != null) p.video.currentTime = p.scrub.time;
      p.scrub.time = null; p.scrub.active = false; p.updateTime(); p.scheduleHide();
    };
    tl.addEventListener('pointerup', end);
    tl.addEventListener('pointercancel', end);
    tl.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); p.seekBy(e.key === 'ArrowLeft' ? -5 : 5); p.showControls(); }
    });
  }

  /** Draws position `t` of duration `d`: the bars, the thumb, the lock screen's line and the slider's values. */
  update(t, d) {
    const p = this.p;
    p.played.style.transform = `scaleX(${Math.min(1, t / d)})`;
    p.thumb.style.left = `${(Math.min(1, t / d) * 100).toFixed(2)}%`;
    p.lockFill.style.transform = `scaleX(${Math.min(1, t / d)})`;
    const b = p.video.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= p.video.currentTime + 0.5) end = Math.max(end, b.end(i));
    p.buffered.style.transform = `scaleX(${Math.min(1, end / d)})`;
    p.timeline.setAttribute('aria-valuemax', Math.round(d));
    p.timeline.setAttribute('aria-valuenow', Math.round(t));
    p.timeline.setAttribute('aria-valuetext', `${clock(t)} of ${clock(d)}`);
  }

  close() {}
}
