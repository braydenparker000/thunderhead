// @ts-check
// The Info sheet (PHOTOS.md § Info): everything the file knows, in sections (Camera, Film, Image, the
// histogram, Edit, Drive), a row each, the label left and the value right in tabular numbers, 48 px.
// Copy at the bottom copies it as plain text. From the editor (its histogram is the live render's) and
// the shelf's tile menu (the preview's). Nothing here goes to the mind: no sense, no pixel, no value.
import { el, toast } from '/th/ui.js';
import { pendingMark } from './background.js';
import * as data from './data.js';
import { drawHistogram, histogram } from './edit/histogram.js';
import { listVersions } from './edit/versions.js';
import { cameraRows, imageRows } from './exif.js';
import { filmRows } from './fuji.js';
import { backfill } from './info.js';
import { icon } from './shelf.js';

/** @typedef {[string, string][]} Rows */

/** The preview's pixels, read small, for the histogram away from the editor. @param {string} id */
async function previewPixels(id) {
  const blob = (await data.previewOf(id).catch(() => null)) ?? (await data.thumbOf(id));
  if (!blob) return null;
  const b = await createImageBitmap(blob, { resizeWidth: 256, resizeQuality: 'low' });
  const c = /** @type {HTMLCanvasElement} */ (el('canvas', { width: String(b.width), height: String(b.height) }));
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  g.drawImage(b, 0, 0);
  b.close();
  return new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer);
}

/** The sections, as rows, for a photo and its info. @param {data.PhotoItem} p
 * @param {import('./info.js').PhotoInfo} info @param {{ versions: number | null, folder: string | null }} more
 * @returns {[string, Rows][]} */
export function sections(p, info, more) {
  const film = filmRows(info);
  return [
    ['Camera', cameraRows(info, p)],
    ['Film', film.length ? film : p.film ? [['Film simulation', p.film]] : []],
    ['Image', imageRows(info, p)],
    ['Edit', [['Status', p.edited ? 'Edited' : 'As shot'], ...(more.versions !== null ? /** @type {Rows} */ ([['Versions', String(more.versions)]]) : [])]],
    ['Drive', [['Original', p.drive_id ? 'In Drive' : pendingMark(p)], ...(more.folder ? /** @type {Rows} */ ([['Folder', more.folder]]) : [])]],
  ];
}

/** The text Copy copies. @param {[string, Rows][]} s */
export const asText = (s) => s.filter(([, rows]) => rows.length).map(([t, rows]) => [t, ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n')).join('\n\n');

/** Opens the sheet over `host`. @param {HTMLElement} host @param {data.PhotoItem} p
 * @param {{ pixels?: () => Uint8Array | null }} [o] the live render's pixels, in the editor */
export async function infoSheet(host, p, o = {}) {
  if (host.querySelector('.isheet')) return;
  const dark = Boolean(host.closest('.editor'));
  const dim = el('div', { class: dark ? 'xdim' : 'pdim' });
  const body = el('div', { class: 'ibody', 'aria-busy': 'true' });
  const copy = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'pact icopy', disabled: '' }, [icon('copy'), el('span', { text: 'Copy' })]));
  const sheet = el('div', { class: `${dark ? 'xsheet' : 'psheet'} isheet`, role: 'dialog', 'aria-label': 'Info' }, [el('h2', { text: 'Info' }), body, copy]);
  const esc = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') shut(); };
  const shut = () => { dim.remove(); sheet.remove(); document.removeEventListener('keydown', esc); };
  dim.addEventListener('click', shut);
  document.addEventListener('keydown', esc);
  host.append(dim, sheet);

  if (!data.infos.has(p.id)) await data.photo(p.id).catch(() => null);
  const info = (await backfill(p)) ?? data.infos.get(p.id) ?? {};
  const [versions, drive] = await Promise.all([
    listVersions(p.id).then((v) => v.length).catch(() => null),
    data.driveStatus().then((d) => d.folder_name).catch(() => null),
  ]);
  if (!sheet.isConnected) return;
  const all = sections(p, info, { versions, folder: drive });
  const hist = /** @type {HTMLCanvasElement} */ (el('canvas', { class: 'ihist', width: '512', height: '160', 'aria-label': 'Histogram, red, green and blue' }));
  const rows = (/** @type {Rows} */ r) => r.map(([k, v]) => el('div', { class: 'irow' }, [el('span', { text: k }), el('b', { text: v })]));
  body.replaceChildren(...all.flatMap(([title, r], n) => [
    ...(r.length ? [el('h3', { text: title }), ...rows(r)] : []),
    ...(n === 2 ? [el('h3', { text: 'Histogram' }), hist] : []),
  ]));
  body.removeAttribute('aria-busy');
  if (!Object.keys(info).length) body.prepend(el('p', { class: 'inote', text: navigator.onLine === false ? 'Offline: the rest comes from the file when you are back.' : 'The file says little more than this.' }));
  copy.disabled = false;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asText(all));
      toast('Copied the info.');
    } catch {
      toast('Copy did not work here.');
    }
  });
  // The editor's live render once it has one (before its first frame, none: the preview's).
  let px = null;
  try { px = o.pixels?.() ?? null; } catch {}
  px ??= await previewPixels(p.id).catch(() => null);
  if (px) drawHistogram(hist, histogram(px));
  else hist.replaceWith(el('p', { class: 'inote', text: 'No preview on this phone yet.' }));
}
