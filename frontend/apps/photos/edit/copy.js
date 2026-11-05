// @ts-check
// Copy from the editor (PHOTOS.md, Copy and paste): More in the top bar opens a sheet with the panels as
// switches, every one on but Crop and geometry (a crop rarely fits another frame), and Copy. The copy is
// held for the shelf (copied.js), where a long press chooses the photos it goes to. For a RAW, the sheet
// also starts the wipe against the camera's JPEG (camera.js).
import { el, toast } from '/th/ui.js';
import { hold, named, PANEL_NAMES, pick } from '../copied.js';
import { icon } from '../shelf.js';

/** @typedef {import('../copied.js').Panel} Panel */

/** More, in the editor's top bar. @param {() => import('./fields.js').Recipe} recipe
 * @param {() => (() => void) | null | undefined} [wipe] starts the camera wipe, when there is a camera JPEG */
export function copyButton(recipe, wipe) {
  const b = el('button', { type: 'button', class: 'vback emore', 'aria-label': 'More' }, [icon('dots-three')]);
  b.addEventListener('click', () => copySheet(/** @type {HTMLElement} */ (b.closest('.editor')), recipe(), wipe?.()));
  return b;
}

/** @param {HTMLElement} host @param {import('./fields.js').Recipe} recipe @param {(() => void) | null} [wipe] */
export function copySheet(host, recipe, wipe) {
  if (host.querySelector('.cpsheet')) return;
  /** @type {Set<Panel>} */
  const on = new Set(PANEL_NAMES.map(([p]) => p).filter((p) => p !== 'crop'));
  const dim = el('div', { class: 'xdim' });
  const sheet = el('div', { class: 'xsheet cpsheet', role: 'dialog', 'aria-label': 'Copy edit' });
  const close = () => { dim.remove(); sheet.remove(); };
  dim.addEventListener('click', close);
  const go = el('button', { type: 'button', class: 'eauto xgo' }, [icon('copy'), el('span', { text: 'Copy' })]);
  const rows = PANEL_NAMES.map(([p, label]) => {
    const n = Object.keys(pick(recipe, [p])).length;
    const sw = el('button', { type: 'button', role: 'switch', class: 'crow', 'data-panel': p, 'aria-checked': String(on.has(p)) }, [
      el('span', { class: 'ccopy' }, [el('b', { text: label }), el('span', { text: n ? `${n} change${n === 1 ? '' : 's'}` : 'as shot' })]),
      el('span', { class: 'cknob', 'aria-hidden': 'true' }),
    ]);
    sw.addEventListener('click', () => {
      if (on.has(p)) on.delete(p); else on.add(p);
      sw.setAttribute('aria-checked', String(on.has(p)));
      /** @type {HTMLButtonElement} */ (go).disabled = !on.size;
    });
    return sw;
  });
  go.addEventListener('click', () => {
    const panels = PANEL_NAMES.map(([p]) => p).filter((p) => on.has(p));
    hold({ panels, recipe: pick(recipe, panels), at: Date.now() });
    close();
    toast(`Copied ${named(panels)}. On the shelf, hold a photo to choose where it goes.`);
  });
  const cam = wipe ? el('button', { type: 'button', class: 'eauto ecamera' }, [icon('columns'), el('span', { text: "Compare with the camera's JPEG" })]) : null;
  cam?.addEventListener('click', () => { close(); wipe?.(); });
  sheet.append(
    ...(cam ? [cam] : []),
    el('h2', { text: 'Copy edit' }),
    el('p', { class: 'eline', text: 'The panels to copy. A panel left as shot sets the photos it goes to back to as shot.' }),
    el('div', { class: 'crows' }, rows),
    go,
  );
  host.append(dim, sheet);
  return sheet;
}
