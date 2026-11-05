// @ts-check
// Stars and the heart (PHOTOS.md, the shelf; culling): one row of five stars and a heart, the same in
// the shelf's long-press menu, the full view's sheet and the editor's star row. Setting one is
// PATCH /v1/photos/:id (a stack's go on both its photos) and the sense photo.rate (the numbers and the
// heart, never a name). The tile's marks: the RAW+JPEG badge, the heart and the stars.
import { el, toast } from '/th/ui.js';
import * as data from './data.js';
import { go } from './nav.js';

/** @typedef {data.PhotoItem} PhotoItem */
/** @typedef {{ rating?: number, favorite?: boolean, flag?: string | null }} Marks */
const icon = (/** @type {string} */ n) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<use href="/ui/icons.svg#${n}"/>`;
  return s;
};
const stars = (/** @type {number} */ n) => `${n} star${n === 1 ? '' : 's'}`;

/** Saves marks and tells the senses; null (with a toast) when it did not save. @param {PhotoItem} p @param {Marks} body */
export async function mark(p, body) {
  try {
    const q = await data.patch(p.id, body);
    import('/th/senses/send.js').then((m) => m.sense('photo.rate', `photo:${q.id}`, { rating: q.rating, favorite: q.favorite, flag: q.flag ?? 'none' })).catch(() => {});
    return q;
  } catch {
    toast(navigator.onLine === false ? 'Offline: stars need the connection.' : 'That did not save. Try again.');
    return null;
  }
}

/** Five stars and a heart, drawn from `p`; a tap asks `set` for the new marks (the same star again
 * takes the stars off). `camera(n)`: the rating the camera wrote, shown while the photo is unrated.
 * @param {PhotoItem} p @param {(body: Marks) => void} set */
export function marksRow(p, set) {
  let q = p, cam = 0;
  const row = el('div', { class: 'stars', role: 'group', 'aria-label': 'Stars and heart' });
  const hint = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'camrate', hidden: '' }));
  hint.addEventListener('click', () => set({ rating: cam }));
  const draw = (/** @type {PhotoItem} */ next) => {
    q = next;
    const btns = [1, 2, 3, 4, 5].map((n) => {
      const on = n <= q.rating;
      const b = el('button', { type: 'button', class: `star${on ? ' on' : ''}`, 'aria-label': stars(n), 'aria-pressed': String(n === q.rating) }, [icon(on ? 'star-fill' : 'star')]);
      b.addEventListener('click', () => set({ rating: n === q.rating ? 0 : n }));
      return b;
    });
    const heart = el('button', { type: 'button', class: `heart${q.favorite ? ' on' : ''}`, 'aria-label': 'Favourite', 'aria-pressed': String(q.favorite) }, [icon(q.favorite ? 'heart-fill' : 'heart')]);
    heart.addEventListener('click', () => set({ favorite: !q.favorite }));
    row.replaceChildren(...btns, heart);
    hint.hidden = !(cam > 0 && q.rating === 0);
    hint.textContent = `The camera gave it ${stars(cam)}: tap to keep`;
  };
  draw(p);
  return { row, hint, draw, camera: (/** @type {number} */ n) => { cam = n >= 1 && n <= 5 ? n : 0; draw(q); } };
}

/** A tile's marks: the stack's badge, the heart, the stars. @param {PhotoItem} p */
export const tileMarks = (p) =>
  el('span', { class: 'tmarks' }, [
    ...(p.pair_id ? [el('span', { class: 'tbadge', text: 'RAW+JPEG' })] : []),
    ...(p.favorite ? [el('span', { class: 'tfav', 'aria-label': 'Favourite' }, [icon('heart-fill')])] : []),
    ...(p.rating ? [el('span', { class: 'tstars', 'aria-label': stars(p.rating), text: `★${p.rating}` })] : []),
  ]);

/** The shelf's long-press menu: the stars and the heart, Choose (to paste or export), Info
 * (info-sheet.js), and for a stack, Open the JPEG. @param {HTMLElement} host @param {PhotoItem} p
 * @param {{ choose: () => void, changed: (q: PhotoItem) => void }} o */
export function tileMenu(host, p, o) {
  if (host.querySelector('.tmenu')) return;
  const dim = el('div', { class: 'pdim tdim' });
  const shut = () => { dim.remove(); sheet.remove(); };
  dim.addEventListener('click', shut);
  const marks = marksRow(p, async (body) => {
    const q = await mark(p, body);
    if (!q) return;
    Object.assign(p, q);
    marks.draw(q);
    o.changed(q);
  });
  const choose = el('button', { type: 'button', class: 'pact' }, [icon('check'), el('span', { text: 'Choose' })]);
  choose.addEventListener('click', () => { shut(); o.choose(); });
  const about = el('button', { type: 'button', class: 'pact' }, [icon('info'), el('span', { text: 'Info' })]);
  about.addEventListener('click', () => { shut(); import('./info-sheet.js').then((m) => m.infoSheet(host, p)); });
  const acts = [choose, about];
  if (p.pair_id) {
    const jpeg = el('button', { type: 'button', class: 'pact' }, [icon('image'), el('span', { text: 'Open the JPEG' })]);
    jpeg.addEventListener('click', () => { shut(); go(`?photo=${p.pair_id}`); });
    acts.push(jpeg);
  }
  const sheet = el('div', { class: 'psheet tmenu', role: 'dialog', 'aria-label': 'This photo' }, [marks.row, el('div', { class: 'prow' }, acts)]);
  host.append(dim, sheet);
  /** @type {HTMLElement | null} */ (sheet.querySelector('button'))?.focus();
}
