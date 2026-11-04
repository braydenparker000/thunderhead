// @ts-check
// The Export sheet (PHOTOS.md, Export): Size (full, 2,048 or 1,080 px on the long side), Format (JPEG,
// or HEIC where this browser writes it), Quality 10–100, and where it goes: the share sheet, Files (a
// download), or the "Thunderhead Exports" folder in your Drive. Each photo renders from its original
// in tiles (export-run.js), sRGB, its recipe inside as XMP; a batch of up to 20 shows its progress and
// can be cancelled. Settings › Photos holds the size and format it starts with.
import { el, toast } from '/th/ui.js';
import * as data from '../data.js';
import { exportsFolder, upload } from '../drive.js';
import { icon } from '../shelf.js';
import { heicWritable } from './export-run.js';
import { segments } from './slider.js';

export const BATCH = 20;
/** @typedef {{ size: string, format: 'jpeg' | 'heic', quality: number, onProgress: (f: number) => void, signal: AbortSignal }} Job */
/** @typedef {{ id: string, name: string, render: (j: Job) => Promise<Blob> }} Item */

const defaults = () => {
  /** @type {Record<string, string>} */
  let s = {};
  /** @type {Record<string, string>} */
  let mine = {};
  try { s = JSON.parse(localStorage.getItem('th.p.settings') || '{}'); mine = JSON.parse(localStorage.getItem('th.photos.export') || '{}'); } catch {}
  return { size: mine.size ?? s['photos.export_size'] ?? '2048', format: mine.format ?? s['photos.export_format'] ?? 'jpeg', quality: Number(mine.quality) || 90, to: mine.to ?? 'files' };
};
const fileName = (/** @type {string} */ name, /** @type {string} */ ext) => `${name.replace(/\.[^.]+$/, '') || 'photo'}-edit.${ext}`;

/** Opens the sheet for `items` (at most 20). @param {HTMLElement} host @param {Item[]} items */
export async function exportSheet(host, items) {
  const list = items.slice(0, BATCH);
  const o = defaults();
  const heic = await heicWritable();
  if (!heic) o.format = 'jpeg';
  const dim = el('div', { class: 'xdim' });
  const sheet = el('div', { class: 'xsheet', role: 'dialog', 'aria-label': 'Export' });
  const close = () => { dim.remove(); sheet.remove(); };
  dim.addEventListener('click', () => { if (!running) close(); });
  let running = false;
  /** @type {AbortController | null} */
  let stop = null;
  const draw = () => {
    if (o.format === 'heic' && o.size === 'full') o.size = '2048';
    const sizes = segments([{ id: 'full', label: 'Full' }, { id: '2048', label: '2,048 px' }, { id: '1080', label: '1,080 px' }], o.size, (v) => { o.size = v; draw(); });
    const formats = segments([{ id: 'jpeg', label: 'JPEG' }, ...(heic ? [{ id: 'heic', label: 'HEIC' }] : [])], o.format, (v) => { o.format = /** @type {'jpeg' | 'heic'} */ (v); draw(); });
    const q = el('input', { type: 'range', min: '10', max: '100', step: '5', value: String(o.quality), class: 'xq', 'aria-label': 'Quality' });
    const qv = el('span', { class: 'snum', text: String(o.quality) });
    q.addEventListener('input', () => { o.quality = Number(/** @type {HTMLInputElement} */ (q).value); qv.textContent = String(o.quality); });
    const to = segments([{ id: 'share', label: 'Share' }, { id: 'files', label: 'Files' }, { id: 'drive', label: 'Drive' }], o.to, (v) => { o.to = v; draw(); });
    const go = el('button', { type: 'button', class: 'eauto xgo' }, [icon('export'), el('span', { text: list.length > 1 ? `Export ${list.length} photos` : 'Export' })]);
    go.addEventListener('click', run);
    sheet.replaceChildren(
      el('h2', { text: list.length > 1 ? `Export ${list.length} photos` : 'Export' }),
      el('p', { class: 'xlabel', text: 'Size' }), sizes,
      el('p', { class: 'xlabel', text: heic ? 'Format' : 'Format (HEIC: this browser cannot write it)' }), formats,
      el('div', { class: 'xrow' }, [el('p', { class: 'xlabel', text: 'Quality' }), qv]), q,
      el('p', { class: 'xlabel', text: 'To' }), to,
      el('p', { class: 'eline', text: 'sRGB, with your edit inside the file as XMP.' }),
      go,
    );
  };
  async function run() {
    running = true;
    stop = new AbortController();
    try { localStorage.setItem('th.photos.export', JSON.stringify(o)); } catch {}
    const bar = el('div', { class: 'xbar' }, [el('span')]);
    const line = el('p', { class: 'eline', 'aria-live': 'polite' });
    const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
    cancel.addEventListener('click', () => stop?.abort());
    sheet.replaceChildren(el('h2', { text: 'Exporting' }), bar, line, cancel);
    sheet.dataset.state = 'running';
    /** @type {File[]} */
    const files = [];
    const t0 = performance.now();
    try {
      for (const [i, it] of list.entries()) {
        const at = (/** @type {number} */ f) => { /** @type {HTMLElement} */ (bar.firstChild).style.width = `${(((i + f) / list.length) * 100).toFixed(1)}%`; line.textContent = list.length > 1 ? `Photo ${i + 1} of ${list.length}: ${Math.round(f * 100)} %` : `${Math.round(f * 100)} %`; };
        at(0);
        const blob = await it.render({ size: o.size, format: /** @type {'jpeg' | 'heic'} */ (o.format), quality: o.quality, onProgress: at, signal: stop.signal });
        files.push(new File([blob], fileName(it.name, o.format === 'heic' ? 'heic' : 'jpg'), { type: blob.type }));
        import('/th/senses/send.js').then((m) => m.sense('photo.export', `photo:${it.id}`, { size: o.size, format: o.format, to: o.to })).catch(() => {});
      }
      host.dataset.exportMs = sheet.dataset.ms = String(Math.round(performance.now() - t0));
      sheet.dataset.bytes = String(files.reduce((n, f) => n + f.size, 0));
      await deliver(files, o.to);
      sheet.dataset.state = 'done';
      toast(o.to === 'drive' ? `In Drive, in ${'Thunderhead Exports'}.` : files.length > 1 ? `${files.length} photos exported.` : 'Exported.');
      close();
    } catch (e) {
      sheet.dataset.state = 'failed';
      const why = /** @type {Error} */ (e)?.name === 'AbortError' ? 'Cancelled.' : `That did not export (${/** @type {Error} */ (e)?.message ?? 'unknown'}).`;
      toast(why);
      running = false;
      draw();
    }
  }
  draw();
  host.append(dim, sheet);
  return sheet;
}

/** @param {File[]} files @param {string} to */
async function deliver(files, to) {
  if (to === 'share' && navigator.canShare?.({ files })) {
    await navigator.share({ files });
    return;
  }
  if (to === 'drive') {
    const t = await data.uploadToken();
    const folder = (await data.store.get('exports-folder').catch(() => null)) ?? (await exportsFolder(t.access_token, t.folder_id));
    data.store.set('exports-folder', folder).catch(() => {});
    for (const f of files) await upload({ file: f, name: f.name, token: async () => ({ access_token: (await data.uploadToken()).access_token, folder_id: folder }) });
    return;
  }
  for (const f of files) {
    const a = /** @type {HTMLAnchorElement} */ (el('a', { href: URL.createObjectURL(f), download: f.name }));
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
}
