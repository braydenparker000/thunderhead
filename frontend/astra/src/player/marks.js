// Marks on the seek bar: skippable segments (intro, recap, outro) as tinted
// spans, chapter boundaries as thin gaps (none closer than 6 px), and the
// A–B repeat's two pins. Chapters come from the engine as `engine.chapters`
// ([{start, end, title}] in seconds) once it has read them; it says so with
// 'tracks' or 'ready'. Drawn again when any of these, the length or the bar's
// width change, never on timeupdate.

import {h} from '../ui/dom.js';
import {chapterTicks} from './rules.js';

export const chaptersOf = engine => Array.isArray(engine?.chapters) ? engine.chapters.filter(c => Number.isFinite(c?.start)) : [];

export class Marks {
  constructor(p) {
    this.p = p;
    this.pins = [h('i', {class: 'ap-pin a', hidden: true}), h('i', {class: 'ap-pin b', hidden: true})];
    p.timeline.append(...this.pins);
    this.drawn = '';
    const again = () => this.render();
    for (const type of ['tracks', 'ready']) p.engine.addEventListener(type, again);
    for (const type of ['durationchange', 'loadedmetadata']) p.video.addEventListener(type, again);
    new ResizeObserver(again).observe(p.timeline);
  }

  render() {
    const p = this.p, d = p.video.duration, width = p.track.clientWidth;
    const known = Number.isFinite(d) && d > 0;
    const segments = known ? p.markers.segments : [], chapters = chaptersOf(p.engine);
    const ticks = known ? chapterTicks(chapters, d, width) : [];
    const r = p.extras?.repeat, a = r?.range ? r.range.start : r?.a ?? null, b = r?.range ? r.range.end : null;
    // Drawn only when something changed (the observer also fires for the same width).
    const key = JSON.stringify([d, width, segments.map(s => [s.type, s.start, s.end]), ticks, a, b]);
    if (key === this.drawn) return;
    this.drawn = key;
    const pct = t => (Math.max(0, Math.min(1, t / d)) * 100).toFixed(3) + '%';
    p.marks.replaceChildren(
      ...segments.map(s => h('i', {class: 'ap-segment ' + s.type, style: {left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`}})),
      ...ticks.map(f => h('i', {class: 'ap-tick', style: {left: (f * 100).toFixed(3) + '%'}})));
    [[this.pins[0], a], [this.pins[1], b]].forEach(([pin, t]) => {
      pin.hidden = !(known && t != null);
      if (!pin.hidden) pin.style.left = pct(t);
    });
  }
}
