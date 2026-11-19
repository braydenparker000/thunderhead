// The stream list's chips: the add-ons (one at a time) and the owner's own filters and order. Chips are kept
// and updated in place (never rebuilt), so a chosen one's fill springs in where it is (stream-motion.js), the
// row's scroll stays put, and a press in progress is never lost. Each answers a touch in the same frame (press)
// and with a select tick.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {sheet} from '../ui/components.js';
import {press, tick} from '../ui/motion.js';
import {CODEC_CHIPS, RES_CHIPS, SIZE_CHIPS, SORTS, anyFilter, sortOf} from '../addons/stream-facts.js';
import {springFill} from './stream-motion.js';

/**
 * Makes `row` show exactly `specs` ({key, label, on, cls, aria, run, iconName}), in order: a chip whose key is
 * already there is updated (its fill springs when `on` changes), new ones are made, gone ones removed.
 */
export function syncChips(row, specs) {
  const have = new Map([...row.children].map(el => [el.dataset.key, el]));
  specs.forEach((spec, i) => {
    let el = have.get(spec.key);
    if (!el) {
      el = press(h('button', {class: 'chip', type: 'button', 'data-key': spec.key, onclick: () => { tick('select'); el.run?.(); }},
        h('span', {class: 'chip-fill', 'aria-hidden': 'true'}), h('span', {class: 'chip-label'})));
      el.on = spec.on;
    }
    have.delete(spec.key);
    el.run = spec.run;
    el.className = 'chip' + (spec.cls ? ' ' + spec.cls : '');
    const label = el.querySelector('.chip-label');
    if (label.textContent !== spec.label || !!label.querySelector('.icon') !== !!spec.iconName) label.replaceChildren(spec.label, spec.iconName ? icon(spec.iconName, {size: 16}) : '');
    for (const [k, v] of Object.entries({role: null, 'aria-pressed': String(!!spec.on), 'aria-selected': null, 'aria-label': null, ...spec.aria})) {
      if (v == null) el.removeAttribute(k); else el.setAttribute(k, v);
    }
    if (el.on !== spec.on && el.isConnected) springFill(el.querySelector('.chip-fill'), !!spec.on);
    el.on = spec.on;
    if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
  });
  for (const el of have.values()) el.remove();
}

/** The add-on chips: Refresh, the Thunderhead's size limit when set, All, then each add-on listed (a failed one marked). */
export function addonChips(screen, listed) {
  const pick = id => () => { screen.chooseAddon(id); };
  const chip = (id, label, failed = false) => ({key: 'a:' + id, label, on: screen.filter === id, cls: failed ? 'failed' : '', run: pick(id),
    aria: {role: 'tab', 'aria-selected': String(screen.filter === id), 'aria-label': failed ? `${label}, didn't answer` : null}});
  const mb = screen.app.maxMb;
  return [
    {key: 'refresh', label: '', iconName: 'replay', on: false, cls: 'refresh' + (screen.loading ? ' spinning' : ''), aria: {'aria-label': 'Refresh streams', 'aria-pressed': null}, run: () => screen.load()},
    mb ? {key: 'limit', label: `Under ${mb} MB ✕`, on: true, aria: {'aria-label': `Under ${mb} MB, tap to show all sizes`}, run: () => { screen.app.maxMb = 0; screen.render(); }} : null,
    chip('all', 'All'), ...listed.map(g => chip(g.addon.url, g.addon.name, !!g.error)),
  ].filter(Boolean);
}

/** The owner's chips: the order (a sheet of the four), one size limit, any of the picture sizes and codecs, Clear. */
export function filterChips(screen) {
  const f = screen.f, sort = sortOf(f);
  const any = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const pick = (key, label, on, next) => ({key, label, on, run: () => screen.setFilters(next)});
  return [
    {key: 'sort', label: SORTS.find(s => s[0] === sort)[1], iconName: 'arrowDown', on: sort !== 'addon', cls: 'sort', aria: {'aria-haspopup': 'dialog', 'aria-label': `Order: ${SORTS.find(s => s[0] === sort)[1]}`},
      run: () => sheet('Order', SORTS.map(([v, label]) => ({label, selected: v === sort, run: () => screen.setFilters({...f, sort: v, small: v === 'smallest'})})), {subtitle: 'Astra never reorders by itself'})},
    ...SIZE_CHIPS.map(([mb, label]) => pick('s:' + mb, label, f.maxMb === mb, {...f, maxMb: f.maxMb === mb ? 0 : mb})),
    ...RES_CHIPS.map(([v, label]) => pick('r:' + v, label, f.res.includes(v), {...f, res: any(f.res, v)})),
    ...CODEC_CHIPS.map(([v, label]) => pick('c:' + v, label, f.codec.includes(v), {...f, codec: any(f.codec, v)})),
    anyFilter(f) ? {key: 'clear', label: 'Clear', on: false, cls: 'clear', aria: {'aria-pressed': null}, run: () => screen.setFilters({...f, maxMb: 0, res: [], codec: []})} : null,
  ].filter(Boolean);
}
