// What the stream-info menu shows beyond the file's facts: how much this film
// has downloaded (when the engine counts it: engine.dataUsed(), in bytes),
// refreshed while the menu is open; the chapters, each a row that goes
// there; and "Save this frame" (frames.js).

import {clock, h} from '../ui/dom.js';
import {chaptersOf} from './marks.js';

/** "412 MB so far", "1.24 GB so far". */
export function dataText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  return (bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : Math.round(bytes / 1e6) + ' MB') + ' so far';
}

export class InfoExtras {
  constructor(p) { this.p = p; this.timer = 0; }

  used() { const e = this.p.engine; if (typeof e.dataUsed !== 'function') return null; try { return dataText(e.dataUsed()) || null; } catch { return null; } }

  /** Rows for the facts list: [label, value]. */
  rows() {
    const used = this.used();
    clearInterval(this.timer); this.timer = 0;
    if (used == null) return [];
    this.timer = setInterval(() => this.refresh(), 2000);
    return [['Data used', h('span', {class: 'ap-data-used'}, used)]];
  }

  refresh() {
    const p = this.p, el = p.modal.querySelector('.ap-data-used');
    if (p.menus.modalName !== 'info' || !el || !p.isOpen) { clearInterval(this.timer); this.timer = 0; return; }
    const text = this.used();
    if (text != null && el.textContent !== text) el.textContent = text;
  }

  /** Under the facts: the chapters and the still. */
  after() {
    const p = this.p, chapters = chaptersOf(p.engine);
    const go = c => { p.menus.dismiss(); p.video.currentTime = c.start; p.updateTime(); };
    return [
      chapters.length ? h('div', {class: 'ap-chapters'}, h('span', {class: 'ap-label'}, 'Chapters'),
        ...chapters.map((c, i) => h('button', {class: 'ap-row', type: 'button', onclick: () => go(c)},
          h('span', {class: 'ap-row-text'}, h('b', {}, c.title || `Chapter ${i + 1}`)), h('small', {}, clock(c.start))))) : null,
      p.firstFrame ? h('button', {class: 'ap-chip', type: 'button', onclick: () => { p.menus.dismiss(); p.extras.frames.save(); }}, 'Save this frame') : null,
    ];
  }

  close() { clearInterval(this.timer); this.timer = 0; }
}
