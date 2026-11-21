// @ts-check
// Searching Settings (as Astra's Settings do): the field at the top of Settings finds through the one
// index (finder.js) that the menu's search uses too: settings, pages, Settings' own controls and the
// actions. A setting kept on this phone is found as its own control, usable where it is; anything else
// opens its page with the row brought into view and marked. Loaded the first time the field is focused.
import { el } from '/th/ui.js';
import { build, phoneValue, setPhone } from './catalog.js';
import { row } from './components.js';
import { find } from './finder.js';
import { mark } from './home.js';

/** @typedef {import('../../../shared/contract/settings.ts').SettingValue} Value */

export { find };

/** Wires the field: typing shows what matches in place of Settings' own rows; empty, they come back.
 * @param {HTMLInputElement} input @param {HTMLElement} body */
export function attach(input, body) {
  const results = el('div', { class: 'sresults', role: 'region', 'aria-label': 'Matching settings', hidden: '' });
  input.closest('.ssearch')?.after(results);
  const own = () => [...body.children].filter((c) => c !== results && !c.classList.contains('ssearch'));
  const show = () => {
    const q = input.value.trim();
    for (const c of own()) /** @type {HTMLElement} */ (c).hidden = Boolean(q);
    results.hidden = !q;
    if (!q) return results.replaceChildren();
    const rows = find(q).map((e) => {
      const s = e.spec;
      if (s && s.scope === 'phone' && s.kind !== 'order' && s.kind !== 'links') return build(s, /** @type {Value} */ (phoneValue(s.key)), (next) => setPhone(s, next));
      const r = row({ title: e.title, detail: e.detail || undefined, open: true, onClick: () => {
        if (e.page !== 'settings') return void import('./settings.js').then((m) => m.openPage(e.page, { over: true, focus: e.focus }));
        // One of Settings' own controls: the field empties and the control is marked where it is.
        input.value = '';
        show();
        mark(body.querySelector(`#set-${e.focus}`));
      } });
      r.dataset.find = e.focus ?? e.page;
      return r;
    });
    results.replaceChildren(rows.length ? el('div', { class: 'group' }, rows) : el('p', { class: 'slead', text: 'No settings match that.' }));
  };
  input.addEventListener('input', show);
  show();
}
