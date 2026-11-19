// What a gesture on the picture shows (surface.js decides the gesture; this draws its answer):
// - a double tap: a ripple from the tapped side, a wave from the finger on each tap, and the
//   seconds adding up while the taps go on ("+20 s"); it fades once they stop;
// - a brightness or volume swipe: one gauge each, a pill that fills from the bottom, on its own side,
//   sliding in from that edge and back out after FEEDBACK_MS (brightness marks where 100 % is, as it
//   can go to 150 %; volume shows a muted icon at 0);
// - hold for speed: the speed in a chip at the top (controls.js flash styles, player.css .hold);
// - a swipe across to seek: the time and how far, in the middle, fading in and out.
// Everything here only moves transform and opacity, through feel.js.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {T, spring, level, go, appear, arrive, leave, gone} from './feel.js';
import {FEEDBACK_MS} from './controls.js';
import {STREAK_MS, stepLabel} from './gestures.js';

const ICONS = {brightness: 'brightness', volume: 'volume'};

export class Gauges {
  constructor(p) {
    this.p = p;
    this.timers = {};
    this.ripples = {};
    for (const side of ['left', 'right']) {
      const label = h('div', {class: 'ap-ripple-label'}, h('span', {class: 'ap-ripple-arrows', 'aria-hidden': 'true'}, side === 'left' ? '◂◂◂' : '▸▸▸'), h('b'));
      this.ripples[side] = h('div', {class: 'ap-ripple ' + side, hidden: true, 'aria-hidden': 'true'}, h('div', {class: 'ap-ripple-waves'}), label);
    }
    // Each gauge: its value above, the pill (filled from the bottom) with the icon in it.
    const gauge = kind => h('div', {class: 'ap-level ' + (kind === 'brightness' ? 'left' : 'right'), hidden: true, 'aria-hidden': 'true'},
      h('span', {class: 'ap-level-value'}), h('div', {class: 'ap-level-track'}, h('i'), kind === 'brightness' ? h('em', {class: 'ap-level-mark'}) : null, h('span', {class: 'ap-level-icon'}, icon(ICONS[kind], {size: 20}))));
    p.levelBars = {brightness: gauge('brightness'), volume: gauge('volume')};
    p.controls.before(this.ripples.left, this.ripples.right, p.levelBars.brightness, p.levelBars.volume);
  }

  /** A double-tap seek on `side`: `total` seconds so far in this run of taps, the finger at (x, y) on the screen. */
  seek(side, total, x, y) {
    const el = this.ripples[side], lv = level();
    if (gone(el)) { arrive(el, {name: 'ripple:in', ms: T.fast}); }
    const label = el.querySelector('b');
    label.textContent = stepLabel(total);
    if (lv === 'full') {
      const box = el.getBoundingClientRect(), wave = h('i', {class: 'ap-wave'});
      wave.style.left = `${Math.round(x - box.left)}px`; wave.style.top = `${Math.round(y - box.top)}px`;
      el.firstChild.append(wave);
      const a = go(wave, {transform: 'translate(-50%, -50%) scale(1)', opacity: 0}, {from: {transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.42}, duration: T.lively, easing: spring('smooth'), keep: true});
      a.finished.then(() => wave.remove(), () => wave.remove());
      go(label, {transform: 'none'}, {from: {transform: 'scale(1.12)'}, duration: T.normal, easing: spring('snappy')});
    }
    clearTimeout(this.timers[side]);
    this.timers[side] = setTimeout(() => leave(el, {name: 'ripple:out', ms: T.normal}), STREAK_MS);
  }

  /** A level swipe under way: `value` of `max` (brightness goes to 1.5). */
  level(kind, value, max) {
    const bar = this.p.levelBars[kind];
    clearTimeout(this.timers[kind]); // a second swipe soon after the first keeps its gauge
    if (gone(bar)) { arrive(bar, {ms: 0}); appear(bar, {name: 'gauge:in', offset: kind === 'brightness' ? 'translateX(-12px)' : 'translateX(12px)', ms: T.fast, curve: 'snappy'}); }
    bar.querySelector('.ap-level-value').textContent = Math.round(value * 100) + '%';
    bar.querySelector('i').style.transform = `scaleY(${(value / max).toFixed(3)})`;
    bar.classList.toggle('lit', value / max > 0.16); // the icon sits on the fill: it turns dark
    if (kind === 'volume') {
      const muted = value === 0, iconBox = bar.querySelector('.ap-level-icon');
      if (iconBox.dataset.muted !== String(muted)) { iconBox.dataset.muted = String(muted); iconBox.replaceChildren(icon(muted ? 'mute' : 'volume', {size: 20})); }
    }
  }

  /** The swipe ended: the gauge goes back to its edge a moment later. */
  levelDone(kind) {
    clearTimeout(this.timers[kind]);
    this.timers[kind] = setTimeout(() => leave(this.p.levelBars[kind], {name: 'gauge:out', ms: T.fast, offset: kind === 'brightness' ? 'translateX(-12px)' : 'translateX(12px)'}), FEEDBACK_MS);
  }

  /** The swipe-to-seek readout in the middle: on (fading in, a little grown) or off (fading). */
  preview(on) {
    const el = this.p.seekPreview;
    if (on && gone(el)) { arrive(el, {ms: 0}); appear(el, {name: 'seek-preview:in', offset: 'scale(0.94)', ms: T.fast, curve: 'snappy'}); }
    else if (!on) leave(el, {name: 'seek-preview:out', ms: T.fade});
  }

  /** The player closed: nothing left showing or waiting. */
  close() {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    for (const el of [...Object.values(this.ripples), ...Object.values(this.p.levelBars), this.p.seekPreview]) {
      el.hidden = true; delete el.dataset.leaving; el.inert = false;
    }
  }
}
