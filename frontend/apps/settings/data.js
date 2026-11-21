// @ts-check
// Settings › Account and data › Data use (MENU-AND-SETTINGS.md §6.10; docs/engineering/DATA-METER.md):
// what this browser reported downloading for this site, today and this month, each split by Wi-Fi,
// mobile data and unknown; then a row per part, largest first, whose split opens on a tap; what is
// not counted, and since when it counts; Reset, asked first. The numbers are this phone's own
// (th/data/store.js) and go nowhere.
import { el } from '/th/ui.js';
import { dMMM } from '/th/format.js';
import { read, reset } from '/th/data/store.js';
import { KEY, totals, words } from '/th/data/tally.js';
import { confirmSheet, group, row } from './components.js';
import { infoRow } from './catalog.js';

/** @typedef {import('/th/data/tally.js').Split} Split */

/** What the meter cannot see, in plain words. */
const NOT_COUNTED = /** @type {const} */ ([
  ['What this phone sends', 'Photos, files and messages going up.'],
  ['Films played straight from their host', 'When Astra hands a film’s address to the browser’s own player.'],
  ['The live connection', 'Replies arriving as they are written.'],
  ['Apps keeping their own files', 'Music, Podcasts and Astra saving a new version of themselves.'],
]);

const split = (/** @type {Split} */ s) => `Wi-Fi ${words(s[0])} · Mobile data ${words(s[1])} · Unknown ${words(s[2])}`;
const all = (/** @type {Split} */ s) => s[0] + s[1] + s[2];

/** Writes what this page and the apps framed in it have counted, so the numbers are up to now. */
function flushAll() {
  const wins = [window, ...[...document.querySelectorAll('iframe')].map((f) => f.contentWindow)];
  for (const w of wins) {
    try {
      /** @type {any} */ (w)?.thData?.flush();
    } catch {}
  }
}

/** @param {HTMLElement} body */
export function page(body) {
  const view = el('div', { id: 'data-use' });
  /** The parts whose split is open, kept when the numbers are drawn again. @type {Set<string>} */
  const opened = new Set();
  let drawing = false;
  const render = () => {
    if (drawing) return;
    drawing = true;
    try {
      draw();
    } finally {
      drawing = false;
    }
  };
  const draw = () => {
    flushAll();
    const t = read();
    const { today, month } = totals(t, Date.now());
    const parts = month.rows.map((r) => {
      const button = row({ title: r.name, icon: r.icon, value: words(all(r.split)) });
      button.dataset.part = r.id;
      button.setAttribute('aria-expanded', 'false');
      const copy = /** @type {HTMLElement} */ (button.querySelector('.row-copy'));
      const lines = [split(r.split), ...(r.pieces ?? []).map((p) => `${p.name} ${words(all(p.split))}: ${split(p.split)}`)];
      const show = (/** @type {boolean} */ open) => {
        button.setAttribute('aria-expanded', String(open));
        copy.querySelectorAll('.row-detail').forEach((d) => d.remove());
        if (open) copy.append(...lines.map((text) => el('span', { class: 'row-detail', text })));
      };
      button.addEventListener('click', () => {
        const open = !opened.has(r.id);
        if (open) opened.add(r.id);
        else opened.delete(r.id);
        show(open);
      });
      show(opened.has(r.id));
      return button;
    });
    const unsized = t.unsized
      ? infoRow('Answers that gave no size', `${t.unsized === 1 ? '1 answer' : `${t.unsized} answers`}, mostly Thunderhead’s own and pictures from other sites.`)
      : null;
    const again = row({ title: 'Reset', icon: 'arrow-counter-clockwise', danger: true });
    again.id = 'data-reset';
    again.addEventListener('click', async () => {
      if (!(await confirmSheet({ title: 'Reset data use?', body: 'The counts start again from now.', action: 'Reset' }))) return;
      flushAll();
      reset();
      render();
    });
    view.replaceChildren(
      el('p', { class: 'slead', text: 'What this browser reported downloading for this site, kept on this phone. Your phone’s own data screen also counts other apps and sites.' }),
      group('Total', [
        Object.assign(infoRow('Today', split(today.all), words(all(today.all))), { id: 'data-today' }),
        Object.assign(infoRow('This month', split(month.all), words(all(month.all))), { id: 'data-month' }),
      ]),
      group('This month by part', parts),
      group('Not counted', [...NOT_COUNTED.map(([title, detail]) => infoRow(title, detail)), ...(unsized ? [unsized] : [])]),
      el('p', { class: 'shelp', id: 'data-since', text: `Counting since ${dMMM(t.since)}.` }),
      el('div', { class: 'group' }, [again]),
    );
  };
  render();
  // This page wrote its counts (th:data), or another page of the site did: a framed app, another tab.
  const changed = (/** @type {Event} */ e) => { if (!(e instanceof StorageEvent) || e.key === KEY) render(); };
  addEventListener('storage', changed);
  addEventListener('th:data', changed);
  body.append(view);
  return () => { removeEventListener('storage', changed); removeEventListener('th:data', changed); };
}
