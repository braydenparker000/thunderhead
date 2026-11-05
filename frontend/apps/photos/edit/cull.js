// @ts-check
// Culling in the editor (PHOTOS.md, culling): at fit zoom a sideways swipe on the photo goes to the
// next or the previous photo in the shelf's order under its filter chip (to the left is older, as the
// shelf reads down), with a short slide; a swipe up opens the star row (five stars and the heart), a
// swipe down closes it, and the star in the top bar does either. While the photo is unrated the row
// offers the rating the camera wrote in the RAF, if it wrote one. A stack's JPEG, the camera's own
// rendering, is one tap away in the row, side by side with this edit. On a laptop: 0–5 set the stars,
// f the heart, ← and → go.
import { el, toast } from '/th/ui.js';
import * as data from '../data.js';
import { go } from '../nav.js';
import { mark, marksRow } from '../rate.js';
import { icon } from '../shelf.js';
import { currentFilter } from '../shelf-filter.js';
import { compareView } from './versions.js';

const SWIPE_PX = 60;
const ms = (/** @type {Element} */ e, /** @type {string} */ token) => parseFloat(getComputedStyle(e).getPropertyValue(token)) || 0;

/** @param {HTMLElement} root the editor @param {data.PhotoItem} p
 * @param {{ current: () => Promise<HTMLCanvasElement> }} o this edit, small, for the comparison */
export function culling(root, p, o) {
  const near = data.around(p.id, currentFilter()).catch(() => ({ newer: null, older: null }));
  let q = p;
  const set = async (/** @type {import('../rate.js').Marks} */ body) => {
    const r = await mark(q, body);
    if (r) { q = r; marks.draw(r); root.dataset.rating = String(r.rating); }
  };
  const marks = marksRow(p, set);
  data.store.get(`camrating:${p.id}`).then((n) => marks.camera(Number(n) || 0), () => {});
  const row = el('div', { class: 'erate', role: 'group', 'aria-label': 'Stars', hidden: '' }, [marks.row, marks.hint]);
  if (p.pair_id) {
    const jpeg = el('button', { type: 'button', class: 'pact ejpeg' }, [icon('columns'), el('span', { text: 'The camera’s JPEG beside this edit' })]);
    jpeg.addEventListener('click', async () => {
      try {
        const [mine, blob] = await Promise.all([o.current(), data.previewOf(/** @type {string} */ (p.pair_id))]);
        const bm = await createImageBitmap(blob);
        const c = /** @type {HTMLCanvasElement} */ (el('canvas', { width: String(bm.width), height: String(bm.height) }));
        c.getContext('2d')?.drawImage(bm, 0, 0);
        bm.close();
        compareView(root, [{ canvas: mine, label: 'This edit' }, { canvas: c, label: 'The camera’s JPEG' }]);
        root.dataset.compare = 'jpeg';
      } catch {
        toast('The JPEG’s preview is not on this phone yet.');
      }
    });
    row.append(jpeg);
  }
  const star = el('button', { type: 'button', class: 'vback erstar', 'aria-label': 'Stars and heart', 'aria-expanded': 'false' }, [icon('star')]);
  const open = (/** @type {boolean} */ on) => {
    row.hidden = !on;
    root.dataset.rate = String(on);
    star.setAttribute('aria-expanded', String(on));
  };
  star.addEventListener('click', () => open(row.hidden));
  root.querySelector('.etop .eexport')?.before(star);
  root.querySelector('.ebottom')?.before(row);

  let leaving = false;
  /** Older (1) or newer (-1), with the photo sliding out the way the finger went. @param {1 | -1} dir */
  const step = async (dir) => {
    if (leaving) return;
    const next = (await near)[dir === 1 ? 'older' : 'newer'];
    if (!next) { toast(dir === 1 ? 'No older photo under this filter.' : 'No newer photo under this filter.'); return; }
    leaving = true;
    root.dataset.slide = dir === 1 ? 'older' : 'newer';
    const canvas = root.querySelector('.ecanvas');
    const t = ms(root, '--d-quick');
    if (canvas && t > 0)
      await canvas.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dir === 1 ? -24 : 24}%)`, opacity: 0 }], { duration: t, easing: getComputedStyle(root).getPropertyValue('--ease-out').trim() || 'ease-out', fill: 'forwards' }).finished.catch(() => {});
    go(`?edit=${next}`, { replace: true });
  };
  const key = (/** @type {KeyboardEvent} */ e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !(e.target instanceof Element) || e.target.closest('input, textarea, select, [contenteditable], [role="slider"]')) return;
    if (/^[0-5]$/.test(e.key)) set({ rating: Number(e.key) });
    else if (e.key === 'f' || e.key === 'F') set({ favorite: !q.favorite });
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') step(e.key === 'ArrowRight' ? 1 : -1);
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', key);
  root.addEventListener('photos:leave', () => document.removeEventListener('keydown', key));
  return {
    /** A finished one-finger drag at fit zoom: handled when it was a swipe. @param {number} dx @param {number} dy */
    swipe(dx, dy) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > SWIPE_PX && ax > 1.5 * ay) step(dx < 0 ? 1 : -1);
      else if (ay > SWIPE_PX && ay > 1.5 * ax) open(dy < 0);
      else return false;
      return true;
    },
  };
}
