// "Find a line": searching the subtitle track that shows. The engine keeps
// every cue of the chosen track (engine.cues); typing filters them (case and
// accents ignored, 150 ms after the last key) and a tap goes to a second
// before the line. At most 200 rows are drawn at a time. Subtitle text comes
// from strangers, so it goes in as text nodes only.

import {clock, h} from '../ui/dom.js';
import {findLines} from './rules.js';

export const FIND_LIMIT = 200;

export class Find {
  constructor(p) { this.p = p; this.nodes = null; this.timer = 0; }

  cues() { const e = this.p.engine; return e.selectedSubtitle != null ? e.cues?.get(e.selectedSubtitle) || [] : []; }

  open() {
    this.nodes = null;
    this.p.menus.openModal('find');
    this.nodes?.input.focus({preventScroll: true});
  }

  /** The modal's content, built once per opening so the field keeps what was typed. */
  body() {
    if (this.nodes) return this.nodes.all;
    const input = h('input', {class: 'ap-find-input', type: 'search', placeholder: 'Words from a line', 'aria-label': 'Find a line', autocomplete: 'off', enterkeyhint: 'search'});
    const count = h('p', {class: 'ap-find-count', role: 'status'});
    const list = h('div', {class: 'ap-find-list'});
    input.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.draw(), 150); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.p.menus.dismiss(); } else if (e.key === 'Enter') { e.preventDefault(); list.querySelector('button')?.focus(); } });
    this.nodes = {input, count, list, all: [h('h3', {}, 'Find a line'), input, count, list]};
    this.draw();
    return this.nodes.all;
  }

  draw() {
    const n = this.nodes;
    if (!n) return;
    const {rows, total} = findLines(this.cues(), n.input.value, FIND_LIMIT);
    const lines = total === 1 ? '1 line' : `${total.toLocaleString()} lines`;
    n.count.textContent = total > rows.length ? `${lines}: showing the first ${rows.length}, refine to see more` : n.input.value.trim() && !total ? 'No line has those words' : lines;
    n.list.replaceChildren(...rows.map(r => h('button', {class: 'ap-line', type: 'button', onclick: () => this.go(r.start)}, h('time', {}, clock(r.start)), h('span', {}, r.text))));
    n.list.scrollTop = 0;
  }

  go(start) {
    const p = this.p;
    p.menus.dismiss();
    p.video.currentTime = Math.max(0, start - 1);
    p.updateTime();
  }

  close() { clearTimeout(this.timer); this.nodes = null; }
}
