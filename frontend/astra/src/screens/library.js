// Library: saved titles, one row per type, or a sortable grid. Changing the layout, the sort or the type
// moves each poster on screen to its new place (a FLIP with transforms, at most 12 at once); layout and
// sort are remembered. The page title shrinks into the bar as the page scrolls (browse.css).

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, emptyCard, sheet} from '../ui/components.js';
import {wholePictures, keepPictures} from '../ui/poster.js';
import {posterContext, rowHeader, rowScroll} from './home.js';
import {press, level, tick, T, timed} from '../ui/motion.js';
import {go, handle, spring, EASE} from '../ui/motion-core.js';

const SORTS = {
  recent: {label: 'Recently added', fn: (a, b) => b.added - a.added},
  oldest: {label: 'Oldest added', fn: (a, b) => a.added - b.added},
  title: {label: 'Title A–Z', fn: (a, b) => a.name.localeCompare(b.name)},
  titleDesc: {label: 'Title Z–A', fn: (a, b) => b.name.localeCompare(a.name)},
  released: {label: 'Recently released', fn: (a, b) => String(b.releaseInfo || '').localeCompare(String(a.releaseInfo || ''))},
};
const MOVING = 12; // FEEL.md rule 9: no more than about 12 elements move at once

const visible = r => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

/**
 * Where each poster on screen is now (by its title), before a redraw. After it, `flip(before)` sends every
 * poster that was on screen and still is from its old place and size to its new one. Pure apart from the DOM.
 */
export function placesOf(root) {
  const out = new Map();
  for (const card of root.querySelectorAll('.poster-card[data-item]')) {
    const r = card.getBoundingClientRect();
    if (visible(r)) out.set(card.dataset.item, r);
  }
  return out;
}

export function flip(root, before, {name = 'flip:library'} = {}) {
  const lv = level();
  if (lv === 'off' || !before.size) return null;
  const anims = [], moved = [];
  for (const card of root.querySelectorAll('.poster-card[data-item]')) {
    if (anims.length >= MOVING) break;
    const was = before.get(card.dataset.item), r = card.getBoundingClientRect();
    if (!visible(r)) continue;
    if (lv === 'reduced' || !was) { anims.push(go(card, {opacity: 1}, {from: {opacity: 0}, duration: T.fade, easing: EASE})); continue; }
    const dx = was.left - r.left, dy = was.top - r.top, sx = was.width / r.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
    card.style.transformOrigin = '0 0';
    moved.push(card);
    anims.push(go(card, {transform: 'none'}, {from: {transform: `translate(${dx}px, ${dy}px) scale(${sx})`}, duration: T.normal, easing: spring('smooth')}));
  }
  return timed(name, () => handle(anims, () => { for (const c of moved) c.style.transformOrigin = ''; }));
}

export class LibraryScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.ctx = posterContext(app);
    this.layout = app.store.get('libraryLayout', 'rows');
    this.sort = app.store.get('librarySort', 'recent');
    if (!Object.hasOwn(SORTS, this.sort)) this.sort = 'recent'; // a sort this version does not have
    this.typeFilter = 'all';
    this.body = h('div', {class: 'library-body'});
    this.toggle = press(h('button', {class: 'icon-btn layout-toggle', type: 'button', onclick: () => { tick('select'); this.layout = this.layout === 'rows' ? 'grid' : 'rows'; app.store.set('libraryLayout', this.layout); this.render(true); }}));
    // The bar keeps the layout button within reach; the large title under it shrinks into it on scroll.
    view.append(h('div', {class: 'library'}, h('div', {class: 'page-bar'}, h('b', {class: 'bar-title', 'aria-hidden': 'true'}, 'Library'), this.toggle),
      h('h1', {class: 'page-title'}, 'Library'), this.body));
    app.library.onChange(() => this.render());
    app.watched.onChange(() => { this.dirty = true; });
    this.render();
  }

  onShow() { if (this.dirty) { this.dirty = false; this.render(); } }
  reselect() { this.view.scrollTo({top: 0}); }

  /** Draws the page; with `moved`, the posters on screen travel from where they were (a layout, sort or type change). */
  render(moved = false) {
    const before = moved ? placesOf(this.body) : null;
    const pictures = wholePictures(this.body);
    this.draw();
    keepPictures(pictures, this.body); // a redrawn card keeps the picture it showed (ui/poster.js)
    if (before) flip(this.body, before);
  }

  draw() {
    // The icon shows the layout a tap switches to: a grid, or stacked rows.
    this.toggle.replaceChildren(icon(this.layout === 'rows' ? 'grid' : 'agenda', {size: 22}));
    this.toggle.setAttribute('aria-label', this.layout === 'rows' ? 'Show as grid' : 'Show as rows');
    const items = this.app.library.list();
    this.toggle.hidden = !items.length;
    if (!items.length) {
      this.body.replaceChildren(emptyCard('Nothing saved yet', 'Tap + on a title, or hold a poster, to keep it here.', {label: 'Browse Home', run: () => this.app.selectTab('home', true)}, {icon: 'library'}));
      return;
    }
    if (this.layout === 'rows') {
      const types = [...new Set(items.map(i => i.type))];
      this.body.replaceChildren(...types.map(t => {
        const list = items.filter(i => i.type === t);
        return h('section', {class: 'row'}, rowHeader(`${t === 'series' ? 'Series' : t === 'movie' ? 'Movies' : t} (${list.length})`, () => { this.layout = 'grid'; this.typeFilter = t; this.app.store.set('libraryLayout', 'grid'); this.render(true); }),
          rowScroll(...list.map(m => posterCard(m, this.ctx))));
      }));
      return;
    }
    const types = ['all', ...new Set(items.map(i => i.type))];
    if (!types.includes(this.typeFilter)) this.typeFilter = 'all';
    const shown = items.filter(i => this.typeFilter === 'all' || i.type === this.typeFilter).sort(SORTS[this.sort].fn);
    const label = t => t === 'all' ? 'All' : t === 'series' ? 'Series' : t === 'movie' ? 'Movies' : t;
    this.body.replaceChildren(
      h('div', {class: 'filter-chips'},
        ...types.map(t => press(h('button', {class: 'chip', type: 'button', 'aria-pressed': String(this.typeFilter === t), onclick: () => { if (this.typeFilter === t) return; tick('select'); this.typeFilter = t; this.render(true); }}, label(t)))),
        press(h('button', {class: 'chip dropdown', type: 'button', onclick: () => sheet('Sort', Object.entries(SORTS).map(([k, v]) => ({label: v.label, selected: k === this.sort, run: () => { this.sort = k; this.app.store.set('librarySort', k); this.render(true); }})))}, SORTS[this.sort].label, icon('chevronRight', {size: 16})))),
      h('div', {class: 'grid'}, ...shown.map(m => posterCard(m, this.ctx))));
  }
}
