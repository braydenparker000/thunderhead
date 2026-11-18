// "Find a line": searching the subtitle track that shows. The engine keeps
// every cue of the chosen track it has read (engine.cues): all of a file's,
// and of a track inside the film the lines of the parts downloaded so far
// (embedded-subtitles.js), which the count says. Typing filters them (case and
// accents ignored, 150 ms after the last key) and a tap goes to a second
// before the line. At most 200 rows are drawn at a time: the first FIRST at
// once, the rest after the next frame, so the search opens fast on a 1,500-line
// track. Subtitle text comes from strangers, so it goes in as text nodes only.

import {clock, h} from '../ui/dom.js';
import {findLines} from './rules.js';

export const FIND_LIMIT = 200, FIRST = 30;

export class Find {
  constructor(p) { this.p = p; this.nodes = null; this.timer = 0; this.drawn = 0; }

  cues() { const e = this.p.engine; return e.selectedSubtitle != null ? e.cues?.get(e.selectedSubtitle) || [] : []; }

  /** Whether the track shown is inside the film, whose lines arrive as it is read. */
  partial() { const e = this.p.engine; return e.textTracks?.find(t => t.id === e.selectedSubtitle)?.kind === 'embedded'; }

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
    const {rows, total} = findLines(this.cues(), n.input.value, FIND_LIMIT), sofar = this.partial() ? ' read so far' : '';
    const lines = (total === 1 ? '1 line' : `${total.toLocaleString()} lines`) + sofar;
    n.count.textContent = total > rows.length ? `${lines}: showing the first ${rows.length}, refine to see more` : n.input.value.trim() && !total ? `No line${sofar} has those words` : lines;
    const row = r => h('button', {class: 'ap-line', type: 'button', onclick: () => this.go(r.start)}, h('time', {}, clock(r.start)), h('span', {}, r.text));
    const drawn = ++this.drawn;
    n.list.replaceChildren(...rows.slice(0, FIRST).map(row));
    n.list.scrollTop = 0;
    const rest = () => { if (this.drawn === drawn && this.nodes === n) n.list.append(...rows.slice(FIRST).map(row)); };
    if (rows.length > FIRST) requestAnimationFrame(() => setTimeout(rest, 0)); // after the frame that shows the first
  }

  go(start) {
    const p = this.p;
    p.menus.dismiss();
    p.video.currentTime = Math.max(0, start - 1);
    p.updateTime();
  }

  close() { clearTimeout(this.timer); this.nodes = null; }
}
