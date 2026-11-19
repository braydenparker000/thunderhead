// Settings' row helpers (Nuvio's grouped rows), and a page's rows drawn from the registry.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {rows} from './registry.js';

export const navRow = (iconName, title, detail, run) => h('button', {class: 'set-row link', type: 'button', onclick: run},
  h('span', {class: 'set-icon'}, icon(iconName, {size: 20})), h('span', {class: 'set-text'}, h('b', {}, title), detail ? h('small', {}, detail) : null), icon('chevronRight', {size: 20}));
// `iconName` gives the row the same icon tile as the rows beside it, so their text lines up.
export const switchRow = (title, detail, on, change, iconName = '') => {
  const input = h('input', {type: 'checkbox', role: 'switch', checked: !!on, onchange: e => change(e.target.checked)});
  return h('label', {class: 'set-row'}, iconName ? h('span', {class: 'set-icon'}, icon(iconName, {size: 20})) : null,
    h('span', {class: 'set-text'}, h('b', {}, title), detail ? h('small', {}, detail) : null), h('span', {class: 'switch'}, input, h('i')));
};
export const choiceRow = (title, options, value, change, detail = '') => h('div', {class: 'set-row column'}, h('span', {class: 'set-text'}, h('b', {}, title), detail ? h('small', {}, detail) : null),
  h('div', {class: 'filter-chips'}, ...options.map(([v, label]) => h('button', {class: 'chip', type: 'button', 'aria-pressed': String(v === value), onclick: () => change(v)}, label))));
export const group = (label, ...list) => h('section', {class: 'set-group'}, h('h2', {class: 'section-label'}, label), h('div', {class: 'set-card'}, ...list.filter(Boolean)));

/** The steps between a row's min and max, as choices ("1.5 s"). */
const steps = ({min = 0, max = 1, step = 1, unit = ''}) => {
  const out = [];
  for (let v = min; v <= max + 1e-9 && out.length < 40; v = Math.round((v + step) * 1e6) / 1e6) out.push([v, `${v}${unit ? ' ' + unit : ''}`]);
  return out;
};

/** One registry row as a settings row; a change saves it, applies it and redraws the page. */
export function registryRow(app, r, page) {
  const change = v => { app.saveSetting(r.id, v); page?.render(); };
  const value = app.setting(r.id);
  switch (r.kind) {
    case 'switch': return switchRow(r.title, r.detail, value, change);
    case 'choice': return choiceRow(r.title, r.options, value, change, r.detail);
    case 'steps': return choiceRow(r.title, steps(r.options || {}), value, change, r.detail);
    case 'colour': return h('label', {class: 'set-row'}, h('span', {class: 'set-text'}, h('b', {}, r.title), r.detail ? h('small', {}, r.detail) : null),
      h('input', {type: 'color', value, 'aria-label': r.title, onchange: e => change(e.target.value)}));
    default: return h('button', {class: 'set-row', type: 'button', onclick: () => { r.apply?.(undefined, app); page?.render(); }},
      h('span', {class: 'set-text'}, h('b', {}, r.title), r.detail ? h('small', {}, r.detail) : null));
  }
}

/** Every row of a registry area, in one group under `label`. */
export const areaGroup = (app, area, label, page) => group(label, ...rows(area).map(r => registryRow(app, r, page)));
