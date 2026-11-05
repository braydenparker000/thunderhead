// @ts-check
// The shelf's filter chips (PHOTOS.md, the shelf): All, Favourites, ★3+, ★4+, ★5, RAW, JPEG, Edited
// and Unedited. The choice is kept on this phone (localStorage) and goes to the Worker
// (GET /v1/photos?filter=), so the pages stay right; a day opened and the editor's culling follow it.
import { el } from '/th/ui.js';

const KEY = 'th.photos.filter';
export const FILTERS = /** @type {const} */ ([
  ['all', 'All', 'All photos'], ['favorites', 'Favourites', 'Favourites'], ['stars3', '★3+', 'Three stars or more'],
  ['stars4', '★4+', 'Four stars or more'], ['stars5', '★5', 'Five stars'], ['raw', 'RAW', 'RAW'],
  ['jpeg', 'JPEG', 'JPEG and HEIC'], ['edited', 'Edited', 'Edited'], ['unedited', 'Unedited', 'Unedited'],
]);

/** The chip this phone last chose. @returns {string} */
export function currentFilter() {
  try {
    const v = localStorage.getItem(KEY);
    return FILTERS.some(([k]) => k === v) ? /** @type {string} */ (v) : 'all';
  } catch {
    return 'all';
  }
}

/** The chip row; a tap keeps the choice and calls `pick`. @param {(f: string) => void} pick */
export function filterChips(pick) {
  const row = el('div', { class: 'fchips', role: 'toolbar', 'aria-label': 'Show' });
  const draw = (/** @type {string} */ on) => {
    for (const b of row.children) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.filter === on));
  };
  for (const [k, label, said] of FILTERS) {
    const b = el('button', { type: 'button', class: 'fchip', 'data-filter': k, 'aria-label': said, text: label });
    b.addEventListener('click', () => {
      try { localStorage.setItem(KEY, k); } catch {}
      draw(k);
      pick(k);
    });
    row.append(b);
  }
  draw(currentFilter());
  return row;
}

/** What the empty shelf says under a chip. @param {string} f */
export const emptyUnder = (f) => `Nothing here under ${FILTERS.find(([k]) => k === f)?.[2] ?? 'this filter'}. Tap All to see every photo.`;
