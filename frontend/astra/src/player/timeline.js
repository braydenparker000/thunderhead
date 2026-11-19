// The seek bar: the played and buffered lengths, the thumb, the time bubble
// (with the picture where the drag would land, seek-preview.js, and the chapter's name) while dragging, and what a screen reader hears. Dragging shares p.scrub
// ({active, time}) with the swipe on the picture. A stream with no length (a
// live one) shows a full bar marked Live and cannot be dragged.
//
// Fine seeking (rules.js fineStep): on a film long enough that a pixel of the
// bar is more than two seconds, a finger slid up away from the bar slows the
// drag to an eighth, then a sixty-fourth, from where it is; the bubble rises
// above the finger and says so, and until it has been used three times the
// bubble says "Slide up for fine seeking". Once slowed, the drag stays
// relative to the finger until it is released, so a finger drifting back to
// the bar never throws away the place it found.
//
// The feel (FEEL.md): a touch grows the thumb and thickens the track (transforms, player.css); the
// bubble follows the finger on the snappy spring (feel.js follower) and stays inside the screen; with
// the "Settle on marks" setting the drag settles on a chapter or skip mark within SNAP_PX of the finger,
// and each one it settles on is felt (tick('snap'), Full haptics only).

import {clock, h} from '../ui/dom.js';
import {put} from './view.js';
import {chapterAt, fineStep, fineWorth} from './rules.js';
import {chaptersOf} from './marks.js';
import {savePrefs} from './prefs.js';
import {SeekPreview} from './seek-preview.js';
import {follower, tick} from './feel.js';

export const FINE_HINTS = 3;
export const SNAP_PX = 6;
const EDGE = 8; // the bubble keeps this far from the screen's edges

/** The clock beside the bar: elapsed and the length, or elapsed and what is left ('−'); 'Live' for a stream with no end. */
export function timeText(t, d, remaining = false) {
  if (d === Infinity) return 'Live';
  if (!(Number.isFinite(d) && d > 0)) return clock(t);
  return `${clock(t)} / ${remaining ? '−' + clock(Math.max(0, d - t)) : clock(d)}`;
}

/** The mark (a time in `marks`) within `px` of time `t` on a bar `width` px wide for a film of `d` s, or null. */
export function nearMark(marks, t, d, width, px = SNAP_PX) {
  if (!(d > 0) || !(width > 0)) return null;
  let best = null, gap = px;
  for (const m of marks) { const g = Math.abs(m - t) / d * width; if (g <= gap) { gap = g; best = m; } }
  return best;
}

export class Timeline {
  constructor(p) {
    this.p = p;
    this.pointer = null;
    this.fine = null; // {worth, anchor: {rate, x, time} | null, label, used, above} while a drag is under way
    this.preview = new SeekPreview(p);
    this.snapped = null; // the mark the drag rests on
    this.lift = 0;
    this.follow = follower(x => { p.bubble.style.transform = `translate(${x.toFixed(1)}px, ${-this.lift}px)`; });
    this.bind();
  }

  bind() {
    const p = this.p, tl = p.timeline;
    const length = () => { const d = p.video.duration; return Number.isFinite(d) && d > 0 ? d : 0; };
    const at = e => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))) * length(); };
    // Where the finger points: under it on the bar; slowed and relative once slid up (fine seeking).
    const place = e => {
      const f = this.fine, r = tl.getBoundingClientRect(), d = length();
      f.above = r.top + r.height / 2 - e.clientY;
      const step = f.worth ? fineStep(f.above) : {rate: 1, label: ''};
      f.label = step.label;
      if (step.rate === 1 && !f.anchor) return this.settle(at(e), d, r.width);
      if (f.anchor?.rate !== step.rate) f.anchor = {rate: step.rate, x: e.clientX, time: p.scrub.time};
      if (step.rate < 1) f.used = true;
      return Math.max(0, Math.min(d, f.anchor.time + (e.clientX - f.anchor.x) / (r.width || 1) * d * step.rate));
    };
    const bubble = () => {
      const f = p.scrub.time / (length() || 1), fine = this.fine;
      // The chapter's name under the time, when the film has chapters; then fine seeking's state or its hint.
      const chapter = chapterAt(chaptersOf(p.engine), p.scrub.time);
      const note = fine?.label || (fine?.worth && (p.prefs.fineSeeks || 0) < FINE_HINTS ? 'Slide up for fine seeking' : '');
      p.bubble.replaceChildren(...this.preview.nodes(), clock(p.scrub.time), chapter?.title ? h('small', {}, chapter.title) : '', note ? h('small', {class: 'ap-fine'}, note) : '');
      p.bubble.hidden = false;
      const lifted = fine?.above > 16; // above the finger, not under it; the buttons in the middle make way
      this.lift = lifted ? Math.round(fine.above + 20) : 0;
      p.timeline.classList.toggle('lifted', lifted);
      // Its centre over the time, kept inside the screen (a chapter's name widens it); moved by a transform, on the spring.
      const r = tl.getBoundingClientRect(), w = p.bubble.offsetWidth, screen = p.root.clientWidth || innerWidth;
      const x = Math.max(EDGE - r.left, Math.min(screen - r.left - EDGE - w, f * r.width - w / 2));
      this.follow.set(x, {jump: first});
      first = false;
    };
    let first = true;
    tl.addEventListener('pointerdown', e => {
      if (p.ctl.locked || !length() || this.pointer != null) return;
      this.pointer = e.pointerId;
      try { tl.setPointerCapture(e.pointerId); } catch {}
      tl.classList.add('active');
      this.fine = {worth: fineWorth(length(), tl.getBoundingClientRect().width), anchor: null, label: '', used: false, above: 0};
      first = true; this.snapped = null;
      p.scrub.active = true; p.scrub.time = this.settle(at(e), length(), tl.getBoundingClientRect().width); this.preview.start(); this.preview.moved(p.scrub.time); p.updateTime(); bubble(); p.showControls(false);
    });
    tl.addEventListener('pointermove', e => { if (this.pointer === e.pointerId) { p.scrub.time = place(e); this.preview.moved(p.scrub.time); p.updateTime(); bubble(); } });
    const end = e => {
      if (this.pointer !== e.pointerId) return;
      try {
        if (e.type === 'pointerup' && p.scrub.time != null && length()) {
          p.video.currentTime = p.scrub.time;
          if (this.fine?.used) { p.prefs.fineSeeks = (p.prefs.fineSeeks || 0) + 1; savePrefs(p.prefs); }
        }
      } finally { this.stop(); }
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
    this.fine = null;
    this.preview.stop();
    p.timeline.classList.remove('active', 'lifted');
    p.bubble.hidden = true;
    this.follow.stop(); this.lift = 0; this.snapped = null;
    p.scrub.time = null; p.scrub.active = false;
  }

  /** Chapter starts and skip marks: where a drag may settle. */
  marks() {
    const out = chaptersOf(this.p.engine).map(c => c.start).filter(t => t > 0);
    for (const s of this.p.markers.segments) out.push(s.start, s.end);
    return out;
  }

  /** A time under the finger, settled on a mark close to it (the setting), felt as it lands on a new one. */
  settle(t, d, width) {
    if (this.p.prefs.seekSnap === false) return t;
    const m = nearMark(this.marks(), t, d, width);
    if (m != null && m !== this.snapped) tick('snap');
    this.snapped = m;
    return m ?? t;
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
