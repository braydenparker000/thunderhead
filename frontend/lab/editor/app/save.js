// @ts-check
// Export from the editor (docs/design/EDITOR.md): the open photo, as edited, developed from the sensor's own
// pixels and saved to the phone's Downloads: one file for each preset that is on, all from one development.
import { OUTPUT, develop } from '../../engine/export.js';
import { block, carry, taken } from '../../engine/exif.js';
import * as files from '../../engine/files.js';
import * as photo from './session.js';
import * as store from './store.js';

/** @typedef {{ fmt: string, long: number, q: number, meta: 'All' | 'Copyright only' | 'None', gps: boolean, file: string, sharpen?: string, amt?: string }} Preset
 * `sharpen`: output sharpening for Screen or Print (anything else: none), `amt` how much (Low, Standard, High) */

/** The day the open photo was taken (2026-11-09), for file names; '' when its Exif doesn't say. */
export async function day() { const p = photo.current(); return p ? taken(await store.jpegHead(p.id)) : ''; }

/** @param {Blob} blob @param {string} name */
function download(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

const MARK = 'th.editor.export';
/** An export the page did not live to finish (it was closed, or the phone took the tab back): the photo's id and
 * name, once, if that photo is still here. A finished or refused export leaves no mark. */
export function cutOff() {
  try {
    const m = JSON.parse(localStorage.getItem(MARK) || 'null');
    localStorage.removeItem(MARK);
    return m && store.photos().some((p) => p.id === m.id) ? /** @type {{ id: string, name: string }} */ (m) : null;
  } catch { return null; }
}

/** Saves the open photo for each preset: developed once, each file taking its own size from it. `progress` hears how
 * far along it is (0 to 1). @param {Preset[]} presets @param {(done: number) => void} progress */
export async function save(presets, progress) {
  const p = photo.current(), big = photo.whole();
  if (!p || !big) throw new Error('The full-size photo is still loading. Try again in a moment.');
  const head = await store.jpegHead(p.id), saved = /** @type {{ file: string, width: number, height: number, bytes: number, blob: Blob }[]} */ ([]);
  try { localStorage.setItem(MARK, JSON.stringify({ id: p.id, name: p.name })); } catch { /* a private window */ }
  try { await photo.alone(async () => {   // the engine to itself: no frame of the dial's between the bands
    await photo.settle();
    const made = await develop(big, presets.map((x) => ({ long: x.long, sharpen: OUTPUT[x.sharpen || '']?.[x.amt || 'Standard'] || 0, open: (w, h) => {
      const kept = carry(head, x.meta, x.gps, w, h);
      return x.fmt === 'JPEG' ? files.jpeg(w, h, x.q, photo.jpegBand, kept && block(kept)) : x.fmt === 'PNG' ? files.png(w, h, kept && block(kept)) : files.tiff(w, h, kept);
    } })), (d) => { if (photo.whole() !== big) throw new Error('The photo was closed.'); progress(d); });
    for (const [k, r] of made.entries()) { download(r.blob, presets[k].file); saved.push({ file: presets[k].file, width: r.width, height: r.height, bytes: r.blob.size, blob: r.blob }); }
  }); } finally { try { localStorage.removeItem(MARK); } catch { /* nothing was kept */ } }   // it ended, well or not, with the page alive
  return saved;
}
