// What a title's timeline carries besides the film: segments that can be
// skipped (intro, recap, outro) and the next-episode card near the end.
// Both are offers: nothing skips or plays without a tap. One action at a
// time near the end: while the next-episode card shows, the outro's Skip
// button does not (the card's Play is the way on; skipping the credits would
// only land where the card already is).
//
// Both rise from the bar's edge with the spring when they appear, and ride up
// above the bar with the controls (player.css, by a transform). The card's
// play button carries a ring that fills over the "Next episode card" setting
// (5, 10 or 15 s; off): like Skip's line, it is how long the offer stays
// without the controls before it tucks away until they show again. It never
// plays anything by itself: only a tap on Play does.

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {put} from './view.js';
import {appear, ghost, go, level, stop} from './feel.js';

const SKIP_LABELS = {intro: 'Skip Intro', recap: 'Skip Recap', outro: 'Skip Outro', credits: 'Skip to post-credits'};
const NEXT_STEPS = [0, 5, 10, 15];
/** The next card's time on screen without the controls, in seconds (the setting; 0 is "stays"). */
export const nextCountdown = prefs => NEXT_STEPS.includes(prefs?.nextCountdown) ? prefs.nextCountdown : 10;
// Called on every timeupdate: the page is only written when something changes. Appearing, it rises from the bar's edge.
const show = (el, on) => {
  if (el.hidden !== on) return false;
  if (!on) ghost(el, {name: 'edge:out', offset: 'translateY(8px)'});
  el.hidden = !on;
  if (on) appear(el, {name: 'edge:in', offset: 'translateY(16px) scale(0.96)'});
  return true;
};

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
    show(p.skipBtn, false);
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
      h('button', {class: 'ap-next-play', type: 'button', 'aria-label': `Play ${n.label}${n.title ? ', ' + n.title : ''}`, onclick: () => this.playNext(), disabled: n.hasAired === false},
        this.ring = ring(), icon('play', {size: 18})),
      h('button', {class: 'ap-next-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => this.dismissNext()}, icon('close', {size: 16})));
    let startX = null;
    card.onpointerdown = e => { startX = e.clientX; };
    card.onpointerup = e => { if (startX != null && e.clientX - startX >= 60) this.dismissNext('translateX(48px)'); startX = null; };
    this.nextShownAt = null;
  }

  /** The card put away by its close button or a swipe right (a copy leaves the way it was sent). */
  dismissNext(offset = 'translateY(8px)') {
    const card = this.p.nextCard;
    this.nextDismissed = true;
    if (!card.hidden) { ghost(card, {name: 'next:dismiss', offset}); card.hidden = true; }
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

  /**
   * The card shows while it is due; with a countdown, it tucks away once it has been up that long
   * without the controls, and comes back with them (as Skip does).
   */
  updateNext(t, d) {
    const p = this.p, due = this.nextDue(t, d), secs = nextCountdown(p.prefs);
    if (!due) { this.nextShownAt = null; show(p.nextCard, false); return; }
    if (this.nextShownAt == null) { this.nextShownAt = performance.now(); this.runRing(secs); }
    const tucked = secs > 0 && performance.now() - this.nextShownAt > secs * 1000 && !p.ctl.visible;
    show(p.nextCard, !tucked);
  }

  /** The ring fills over `secs` (two halves, each turned by a transform); none when off. */
  runRing(secs) {
    const r = this.ring;
    if (!r) return;
    r.hidden = !secs;
    const [right, left] = r.querySelectorAll('.ap-ring-rotor');
    for (const el of [right, left]) stop(el);
    if (!secs) return;
    if (level() === 'off') { for (const el of [right, left]) go(el, {transform: 'rotate(180deg)'}, {from: {transform: 'rotate(180deg)'}, duration: 0, keep: true}); return; }
    const half = secs * 500;
    go(right, {transform: 'rotate(180deg)'}, {from: {transform: 'rotate(0deg)'}, duration: half, easing: 'linear', keep: true});
    go(left, {transform: 'rotate(180deg)'}, {from: {transform: 'rotate(0deg)'}, duration: half, delay: half, easing: 'linear', keep: true});
  }

  playNext() {
    const p = this.p, n = p.options.next;
    if (n?.hasAired === false) { p.flash(`${n.label} is not out yet`); return; }
    p.emit('next', {time: p.video.currentTime});
  }

  close() { this.p.skipBtn.hidden = true; this.p.nextCard.hidden = true; this.skipSegmentShown = null; this.nextShownAt = null; }
}

/** The countdown ring: a right and a left half, each a half circle turned into view (only transforms move). */
function ring() {
  const half = side => h('span', {class: 'ap-ring-half ' + side}, h('span', {class: 'ap-ring-rotor'}, h('span', {class: 'ap-ring-arc'})));
  return h('span', {class: 'ap-ring', 'aria-hidden': 'true'}, h('span', {class: 'ap-ring-track'}), half('r'), half('l'));
}
