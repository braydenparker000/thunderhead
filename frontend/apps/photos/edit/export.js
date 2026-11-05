// @ts-check
// The Export sheet (PHOTOS.md, Export): Size (full, 2,048 or 1,080 px on the long side), Format (JPEG,
// or HEIC where this browser writes it), Quality 10–100, and where it goes: the share sheet, Files (a save
// dialog; Download where there is none, deliver.js), or the "Thunderhead Exports" folder in your Drive.
// Each file is named after the photo and its size (IMG_0001-2048.jpg). Each photo renders from its original
// in tiles (export-run.js), sRGB, its recipe inside as XMP; a batch of up to 20 shows its progress and
// can be cancelled. Settings › Photos holds the size and format it starts with.
import { el, toast } from '/th/ui.js';
import { icon } from '../shelf.js';
import { canPick, deliver, pickTarget } from './deliver.js';
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
const fileName = (/** @type {string} */ name, /** @type {string} */ size, /** @type {string} */ ext) => `${name.replace(/\.[^.]+$/, '') || 'photo'}-${size}.${ext}`;

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
    const to = segments([{ id: 'share', label: 'Share' }, { id: 'files', label: canPick() ? 'Files' : 'Download' }, { id: 'drive', label: 'Drive' }], o.to, (v) => { o.to = v; draw(); });
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
  /** Choices in the sheet once the photos are ready (a tap of its own, for what needs one). @type {(title: string, choices: { id: string, label: string }[]) => Promise<string>} */
  const ask = (title, choices) => new Promise((ok) => {
    sheet.replaceChildren(el('h2', { text: title }), ...choices.map((c) => { const b = el('button', { type: 'button', class: 'eauto xgo', 'data-choice': c.id, text: c.label }); b.addEventListener('click', () => ok(c.id)); return b; }));
    sheet.dataset.state = 'ask';
  });
  async function run() {
    const ext = o.format === 'heic' ? 'heic' : 'jpg', names = list.map((it) => fileName(it.name, o.size, ext));
    /** @type {null | { files?: any[], dir?: any }} */
    let target = null;
    // The save dialog opens now, while this tap still counts: after the render it would be refused.
    if (o.to === 'files') try { target = await pickTarget(names); } catch (e) { toast(/** @type {Error} */ (e)?.name === 'AbortError' ? 'Cancelled.' : 'That did not open the save dialog.'); return; }
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
        files.push(new File([blob], names[i], { type: blob.type }));
        import('/th/senses/send.js').then((m) => m.sense('photo.export', `photo:${it.id}`, { size: o.size, format: o.format, to: o.to })).catch(() => {});
      }
      host.dataset.exportMs = sheet.dataset.ms = String(Math.round(performance.now() - t0));
      sheet.dataset.bytes = String(files.reduce((n, f) => n + f.size, 0));
      const said = await deliver(files, o.to, target, ask);
      sheet.dataset.state = 'done';
      toast(said);
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

