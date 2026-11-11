// @ts-check
// The Due sheet (BRIEFING.md §2), opened from the Briefing's Due tile: the owner's reminders due
// today and tomorrow, soonest first, each with its time and its words (the tile itself shows only
// the counts and the next time). Escape, the dim or Close shut it. Text is set with textContent.
import { clock as hhmm } from '../pref.js';
import { el } from '../ui.js';

/** @typedef {import('../../../shared/contract/briefing.ts').DueTile} DueTile */



/** @param {DueTile} t */
export function openDue(t) {
  const before = /** @type {HTMLElement | null} */ (document.activeElement);
  const dim = el('div', { class: 'cdim' });
  const sheet = el('div', { class: 'csheet dsheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Due today and tomorrow' });
  sheet.append(el('h2', { text: 'Due' }));
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  /** @param {string} title @param {DueTile['items']} items */
  const group = (title, items) => {
    if (!items.length) return;
    sheet.append(el('p', { class: 'dday', text: title }));
    const list = el('ol', { class: 'dlist', 'aria-label': title });
    for (const r of items) list.append(el('li', {}, [el('span', { class: 'dat', text: hhmm(r.at) }), el('span', { text: r.text })]));
    sheet.append(list);
  };
  group('Today', t.items.filter((r) => r.at < tomorrow.getTime()));
  group('Tomorrow', t.items.filter((r) => r.at >= tomorrow.getTime()));
  const close = el('button', { type: 'button', class: 'btn soft', text: 'Close' });
  sheet.append(close);
  document.body.append(dim, sheet);
  requestAnimationFrame(() => {
    dim.classList.add('on');
    sheet.classList.add('on');
  });
  close.focus({ preventScroll: true });
  const done = () => {
    document.removeEventListener('keydown', onKey, true);
    dim.remove();
    sheet.remove();
    before?.focus?.({ preventScroll: true });
  };
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') done();
  };
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', done);
  dim.addEventListener('click', done);
}
