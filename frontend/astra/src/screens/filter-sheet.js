// A sheet of filters (Search › Discover): groups of chips, each tap applied at once. It rises, follows a
// finger and is dismissed by a drag, a tap outside or Back, all through ui/motion.js sheet().

import {h} from '../ui/dom.js';
import {press, sheet, tick} from '../ui/motion.js';
import {pushLayer} from '../app/back-stack.js';

/**
 * Opens the sheet. `groups()` gives what to show now: [{label, options: [{label, value}], value, pick(value)}];
 * it is asked again after every pick (a new type has other catalogs). Returns close().
 */
export function filterSheet(title, groups) {
  const content = h('div', {class: 'filter-groups'});
  const draw = () => content.replaceChildren(...groups().map(g => h('section', {class: 'filter-group'}, h('h4', {class: 'filter-label'}, g.label),
    h('div', {class: 'filter-options'}, ...g.options.map(o => press(h('button', {class: 'chip', type: 'button', 'aria-pressed': String(o.value === g.value),
      onclick: () => { if (o.value === g.value) return; tick('select'); g.pick(o.value); draw(); }}, o.label)))))));
  draw();
  const grab = h('div', {class: 'sheet-grab'}, h('div', {class: 'sheet-handle'}), h('h3', {}, title));
  const body = h('div', {class: 'filter-sheet-body', role: 'dialog', 'aria-label': title}, grab, content);
  const scrim = h('div', {class: 'filter-scrim'});
  const layer = h('div', {class: 'filter-sheet', onclick: e => { if (e.target === layer || e.target === scrim) close(); }}, scrim, body);
  document.body.append(layer);
  let gone = false;
  const remove = () => { motion.destroy(); layer.remove(); };
  const motion = sheet(body, {scrim, grab, name: 'sheet:filters', onDismiss: () => { gone = true; pop(); remove(); }});
  const pop = pushLayer('sheet', () => close(true));
  function close(fromBack = false) {
    if (gone) return false;
    gone = true;
    if (!fromBack) pop();
    layer.style.pointerEvents = 'none';
    motion.close().finished.then(remove);
    return true;
  }
  return close;
}
