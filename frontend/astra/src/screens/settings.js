// Settings, drawn from the settings registry (settings/registry.js): a search over every row, then
// one page per area. Rows other areas define (settings/browse.js, streams.js, player.js) appear on
// their area's page by themselves; an area with no rows yet is not listed.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {confirm, toast} from '../ui/components.js';
import {press} from '../ui/motion.js';
import {navRow, group, registryRow} from '../settings/rows.js';
import {areas, rows, find, resetArea} from '../settings/registry.js';
import {addonsPage, dataPage, aboutPage, homeRows, languages} from './settings-pages.js';
import {PREVIEWS} from './settings-preview.js';

/** What some areas draw under their rows (or instead of them). */
const EXTRAS = {addons: addonsPage, data: dataPage, about: aboutPage, home: homeRows, playback: languages};
/** The main list's groups: every other area goes under General. */
const SECTIONS = [['Sources', ['addons']], ['Data', ['data']], ['About', ['about']]];

class Page {
  constructor(app, title, render) {
    this.app = app;
    this.body = h('div', {class: 'set-page-body'});
    const back = press(h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')));
    this.el = h('div', {class: 'screen settings-page'}, h('header', {class: 'sub-head'}, back, h('h1', {}, title)), this.body);
    this.renderFn = render;
    this.render();
  }
  render() { this.body.replaceChildren(...[this.renderFn(this)].flat().filter(Boolean)); }
  destroy() { this.off?.(); } // a page that listens (Add-ons, Your data) stops when closed
}

/** An area's rows, in groups by their `group` (or one group under the area's title). */
function rowGroups(app, area, page) {
  const byGroup = new Map();
  for (const r of rows(area.id)) { const g = r.group || area.title; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(registryRow(app, r, page)); }
  return [...byGroup].map(([label, list]) => group(label, ...list));
}

export class SettingsScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.query = '';
    this.input = h('input', {class: 'search-input settings-search', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off', enterkeyhint: 'search',
      oninput: e => { this.query = e.target.value; this.render(); }});
    this.list = h('div', {class: 'settings-list'});
    this.body = h('div', {class: 'settings'}, h('h1', {class: 'page-title'}, 'Settings'), h('div', {class: 'search-box settings-search-box'}, this.input), this.list);
    view.append(this.body);
    this.render();
  }
  onShow() { this.render(); }
  reselect() { this.view.scrollTo({top: 0}); }

  open(title, render) { this.app.push(new Page(this.app, title, render)); }
  openArea(area) { this.open(area.title, page => this.areaPage(area, page)); }

  /** An area's page: its preview, its rows, what it draws besides, and "Reset this page". */
  areaPage(area, page) {
    const app = this.app, list = rows(area.id).filter(r => r.kind !== 'action');
    const reset = () => confirm(`Reset ${area.title}?`, {message: 'Every setting on this page goes back to how Astra comes. Nothing else changes.', action: 'Reset',
      run: () => { resetArea(app, area.id); page.render(); toast(`${area.title} reset`); }});
    // A page that is more than rows (Your data) shows its own part first; rows lead elsewhere.
    const parts = [rowGroups(app, area, page), [EXTRAS[area.id]?.(app, page)].flat()];
    if (area.custom) parts.reverse();
    return [PREVIEWS[area.id]?.(app), ...parts.flat(),
      list.length ? press(h('button', {class: 'set-reset', type: 'button', onclick: reset}, 'Reset this page')) : null];
  }

  detail(area) {
    if (area.id !== 'addons') return area.detail;
    const list = this.app.addons.list;
    return `${list.filter(a => a.enabled !== false).length} active of ${list.length}`;
  }

  render() {
    const q = this.query.trim();
    this.list.replaceChildren(...(q ? this.results(q) : this.sections()));
  }

  sections() {
    const all = areas(), placed = new Set(SECTIONS.flatMap(([, ids]) => ids));
    const row = a => press(navRow(a.icon, a.title, this.detail(a), () => this.openArea(a)));
    return [group('General', ...all.filter(a => !placed.has(a.id)).map(row)),
      ...SECTIONS.map(([label, ids]) => { const list = all.filter(a => ids.includes(a.id)); return list.length ? group(label, ...list.map(row)) : null; })].filter(Boolean);
  }

  /** Every row whose title or detail matches, working in place, under its area; and the pages whose name matches. */
  results(q) {
    const page = {render: () => this.render()};
    const words = q.toLowerCase().split(/\s+/);
    const pages = areas().filter(a => words.every(w => `${a.title} ${a.detail}`.toLowerCase().includes(w)));
    const found = find(q).filter(r => r.kind !== 'action');
    const byArea = new Map();
    for (const r of found) { if (!byArea.has(r.area)) byArea.set(r.area, []); byArea.get(r.area).push(registryRow(this.app, r, page)); }
    const title = id => areas().find(a => a.id === id)?.title || id;
    const out = [...(pages.length ? [group('Pages', ...pages.map(a => press(navRow(a.icon, a.title, this.detail(a), () => this.openArea(a)))))] : []),
      ...[...byArea].map(([id, list]) => group(title(id), ...list))];
    return out.length ? out : [h('p', {class: 'set-note settings-none'}, `No setting matches “${q}”.`)];
  }
}
