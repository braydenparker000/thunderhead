// @ts-check
// Searching Settings (as Astra's Settings do): the field at the top of Settings finds any setting by
// a word of its name or of the line under it, and the pages by name. A setting kept on this phone
// is found as its own control, usable where it is; one the Worker keeps, or a page, opens there with
// the row brought into view. Loaded the first time the field is focused.
import { el } from '/th/ui.js';
import { build, phoneValue, setPhone } from './catalog.js';
import { SETTING_GROUPS, SETTINGS } from './catalog-data.js';
import { row } from './components.js';
import { PAGES } from './home.js';

/** @typedef {import('../../../shared/contract/settings.ts').SettingSpec} Spec */
/** @typedef {import('../../../shared/contract/settings.ts').SettingValue} Value */

/** Lower case, accents off. @param {string} s */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** @type {Record<string, string>} */
const TITLES = Object.fromEntries(PAGES.map(([page, name]) => [page, name]));

/** Every catalogue setting and page whose words hold each word of `query`, best first.
 * @param {string} query @returns {{ spec?: Spec, page?: string, name: string }[]} */
export function find(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (/** @type {string} */ text) => words.every((w) => text.includes(w));
  /** @type {{ spec?: Spec, page?: string, name: string, rank: number }[]} */
  const out = [];
  for (const [page, name] of PAGES) if (has(fold(name))) out.push({ page, name, rank: 0 });
  for (const s of /** @type {readonly Spec[]} */ (SETTINGS)) {
    const group = /** @type {Record<string, { title: string }>} */ (SETTING_GROUPS)[s.group]?.title ?? '';
    const name = fold(s.label);
    if (has(`${name} ${fold(s.detail ?? '')} ${fold(s.section ?? '')} ${fold(group)}`)) out.push({ spec: s, name: s.label, rank: has(name) ? 1 : 2 });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 30);
}

/** Opens a page over Settings and brings one of its rows into view. @param {string} page @param {string} [key] */
async function openAt(page, key) {
  const { openPage } = await import('./settings.js');
  await openPage(/** @type {any} */ (page), { over: true });
  if (!key) return;
  const at = /** @type {HTMLElement | null} */ ([...document.querySelectorAll('.spage')].at(-1)?.querySelector(`[data-key="${CSS.escape(key)}"]`) ?? null);
  if (!at) return;
  at.scrollIntoView({ block: 'center' });
  at.classList.add('flash');
  setTimeout(() => at.classList.remove('flash'), 1600);
}

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
    const found = find(q);
    const rows = found.map(({ spec, page, name }) => {
      if (page) return row({ title: name, open: true, onClick: () => void openAt(page) });
      const s = /** @type {Spec} */ (spec);
      const where = TITLES[s.group] ?? s.group;
      if (s.scope === 'phone' && s.kind !== 'order' && s.kind !== 'links') return build(s, /** @type {Value} */ (phoneValue(s.key)), (next) => setPhone(s, next));
      return row({ title: s.label, detail: `${where} · ${s.detail ?? ''}`, open: true, onClick: () => void openAt(s.group, s.key) });
    });
    results.replaceChildren(rows.length ? el('div', { class: 'group' }, rows) : el('p', { class: 'slead', text: 'No settings match that.' }));
  };
  input.addEventListener('input', show);
  show();
}
