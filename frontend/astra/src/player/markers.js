// What a title's timeline carries besides the film: segments that can be
// skipped (intro, recap, outro) and the next-episode card near the end.
// Both are offers: nothing skips or plays without a tap. One action at a
// time near the end: while the next-episode card shows, the outro's Skip
// button does not (the card's Play is the way on; skipping the credits would
// only land where the card already is).

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {put} from './view.js';

const SKIP_LABELS = {intro: 'Skip Intro', recap: 'Skip Recap', outro: 'Skip Outro', credits: 'Skip to post-credits'};
// Called on every timeupdate: the page is only written when something changes.
const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };

export class Markers {
  constructor(p) {
    this.p = p;
    this.segments = [];
    this.skipped = new Set();
    this.nextDismissed = false;
  }

  /** A new title: its segments, nothing skipped or dismissed yet. */
  reset(segments = []) {
    this.segments = segments.filter(s => s.end > s.start);
    this.nextDismissed = false;
    this.skipped = new Set();
  }

  /**
   * Skip times that arrived after the film started (found by sound, looked
   * up): a segment the playhead is already in is offered at once; a kind
   * already skipped stays skipped, whatever its new times.
   */
  setSegments(segments) { this.segments = segments.filter(s => s.end > s.start); this.skipSegmentShown = null; }

  activeSegment(t) { return this.segments.find(s => t >= s.start && t < s.end - 0.5 && !this.skipped.has(s.type)); }

  updateSkip(t) {
    const p = this.p;
    let seg = this.activeSegment(t);
    if (seg && (seg.type === 'outro' || seg.type === 'credits') && this.nextDue(t, p.video.duration)) seg = null; // the card is the one action
    if (!seg || p.ctl.locked) { show(p.skipBtn, false); this.skipSegmentShown = null; return; }
    if (this.skipSegmentShown !== seg) {
      this.skipSegmentShown = seg;
      this.skipShownAt = performance.now();
      this.skipHiddenByTimer = false;
      p.skipBtn.querySelector('span').textContent = SKIP_LABELS[seg.type] || 'Skip';
    }
    // Without the controls, the button stays for 10 s, then waits for the controls.
    const age = performance.now() - this.skipShownAt;
    if (!p.ctl.visible && age > 10000) this.skipHiddenByTimer = true;
    show(p.skipBtn, !(this.skipHiddenByTimer && !p.ctl.visible));
    const fill = `scaleX(${p.ctl.visible ? 0 : Math.min(1, age / 10000).toFixed(2)})`;
    put(p.skipFill, 'transform', fill);
  }

  skipSegment() {
    const p = this.p;
    const seg = this.activeSegment(p.video.currentTime);
    if (!seg) return;
    this.skipped.add(seg.type);
    p.video.currentTime = Math.min(seg.end, (p.video.duration || seg.end) - 0.5);
    p.skipBtn.hidden = true;
    p.emitProgress(true); // the saved place is where the skip landed, not where it started
  }

  renderNext() {
    const p = this.p, n = p.options.next;
    if (!n) { p.nextCard.hidden = true; return; }
    const card = p.nextCard;
    card.replaceChildren(
      n.thumbnail ? h('img', {src: n.thumbnail, alt: '', referrerpolicy: 'no-referrer'}) : h('div', {class: 'ap-next-thumb'}),
      h('div', {class: 'ap-next-text'}, h('small', {}, 'Next Episode'), h('b', {}, n.label + (n.title ? ' • ' + n.title : '')),
        n.status || n.hasAired === false ? h('span', {}, n.status || 'Not out yet') : null),
      h('button', {class: 'ap-next-play', type: 'button', 'aria-label': `Play ${n.label}${n.title ? ', ' + n.title : ''}`, onclick: () => this.playNext(), disabled: n.hasAired === false}, icon('play', {size: 16}), 'Play'),
      h('button', {class: 'ap-next-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => { this.nextDismissed = true; card.hidden = true; }}, icon('close', {size: 16})));
    let startX = null;
    card.onpointerdown = e => { startX = e.clientX; };
    card.onpointerup = e => { if (startX != null && e.clientX - startX >= 60) { this.nextDismissed = true; card.hidden = true; } startX = null; };
  }

  /** Whether the next-episode card is offered at t: from the outro (when it runs to the end) or the last 1 %. */
  nextDue(t, d) {
    const p = this.p;
    // A sleep timer set for the end of the episode: nothing else is offered.
    if (!p.options?.next || this.nextDismissed || p.extras?.sleep.episodeEnd || !(d > 120) || !Number.isFinite(d)) return false;
    const outro = this.segments.find(s => (s.type === 'outro' || s.type === 'credits') && d - s.end < 30);
    const at = outro ? outro.start : d * 0.99;
    const credits = this.segments.some(s => s.type === 'postcredits' && t >= s.start);
    return !(t < at || credits);
  }

  updateNext(t, d) { show(this.p.nextCard, this.nextDue(t, d)); }

  playNext() {
    const p = this.p, n = p.options.next;
    if (n?.hasAired === false) { p.flash(`${n.label} is not out yet`); return; }
    p.emit('next', {time: p.video.currentTime});
  }

  close() { show(this.p.skipBtn, false); show(this.p.nextCard, false); this.skipSegmentShown = null; }
}
