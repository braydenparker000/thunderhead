// @ts-check
// Export from the editor (docs/design/EDITOR.md): the open photo, as edited, developed from the sensor's own
// pixels at the size asked for and saved to the phone's Downloads, once for each preset that is on.
import { develop } from '../../engine/export.js';
import { block, carry, taken } from '../../engine/exif.js';
import * as files from '../../engine/files.js';
import * as photo from './session.js';
import * as store from './store.js';

/** @typedef {{ fmt: string, long: number, q: number, meta: 'All' | 'Copyright only' | 'None', gps: boolean, file: string }} Preset */

/** The day the open photo was taken (2026-11-09), for file names; '' when its Exif doesn't say. */
export async function day() { const p = photo.current(); return p ? taken(await store.jpegHead(p.id)) : ''; }

/** @param {Blob} blob @param {string} name */
function download(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Saves the open photo for each preset, in turn. `progress` hears which one and how far along it is (0 to 1).
 * @param {Preset[]} presets @param {(k: number, done: number) => void} progress */
export async function save(presets, progress) {
  const p = photo.current(), big = photo.whole();
  if (!p || !big) throw new Error('The full-size photo is still loading. Try again in a moment.');
  const head = await store.jpegHead(p.id), saved = /** @type {{ file: string, width: number, height: number, bytes: number, blob: Blob }[]} */ ([]);
  await photo.alone(async () => {   // the engine to itself: no frame of the dial's between the bands
    await photo.settle();
    for (const [k, x] of presets.entries()) {
      const r = await develop(big, x.long, (w, h) => {
        const kept = carry(head, x.meta, x.gps, w, h);
        return x.fmt === 'JPEG' ? files.jpeg(w, h, x.q, photo.jpegBand, kept && block(kept)) : x.fmt === 'PNG' ? files.png(w, h, kept && block(kept)) : files.tiff(w, h, kept);
      }, (d) => { if (photo.whole() !== big) throw new Error('The photo was closed.'); progress(k, d); });
      download(r.blob, x.file);
      saved.push({ file: x.file, width: r.width, height: r.height, bytes: r.blob.size, blob: r.blob });
    }
  });
  return saved;
}
