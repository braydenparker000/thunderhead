// @ts-check
// Export from the shelf (PHOTOS.md, Export; select.js): each chosen photo rendered as the editor's
// Export renders it (export-run.js, nothing new in the renderer), without opening the editor: its
// recipe (this phone's unsent one, else the Worker's), its original (a tile of it when the export is
// finer than the working copy), else its preview. One renderer for the whole batch, the photos one
// after another, so a batch of 20 holds one photo in memory at a time.
import { el } from '/th/ui.js';
import { neutralFor, srgbTo2020, tempTintOf } from './color.js';
import { renderExport } from './export-run.js';
import { withValue } from './fields.js';
import { frameSize, geometry } from './geometry.js';
import { greyWorld } from './histogram.js';
import { lateralCA } from './optics.js';
import { makeRenderer } from './renderer.js';
import { loadRecipe } from './save.js';
import { originalSource, previewSource } from './source.js';
import { pack, toneLut } from './uniforms.js';
import { xmpOf, xmpSegment } from './xmp.js';

/** The working copy's longest side, about a phone screen's (the editor's is the screen's). */
const WORKING = 1024;
const D65 = [0.3127, 0.329];

/** @param {import('../data.js').PhotoItem[]} photos @returns {import('./export.js').Item[]} */
export function batchItems(photos) {
  /** @type {Promise<import('./renderer.js').Renderer> | null} */
  let made = null;
  const renderer = () => (made ??= makeRenderer(/** @type {HTMLCanvasElement} */ (el('canvas', { width: '64', height: '64' }))).then((m) => m.r));
  return photos.map((p) => ({
    id: p.id,
    name: p.name,
    render: async (j) => {
      const r = await renderer();
      const recipe = await loadRecipe(p.id);
      const original = navigator.onLine === false ? null : await originalSource(p).catch(() => null);
      const src = original?.source ?? (await previewSource(p.id));
      if (!src) throw new Error('the photo is not on this phone');
      try {
        const asShot = original?.asShot ?? D65;
        const img = {
          raw: original?.raw ?? false, rawPhoto: p.format === 'raf' || p.format === 'dng', asShot, shot: tempTintOf(asShot), auto: /** @type {any} */ (null),
          width: original?.width ?? p.width ?? src.width, height: original?.height ?? p.height ?? src.height, srcW: src.width,
          ca: recipe.AutoLateralCA ? lateralCA(src) : undefined,
        };
        const s = Math.min(1, WORKING / Math.max(img.width, img.height), r.maxSize / Math.max(img.width, img.height));
        const pw = Math.max(1, Math.round(img.width * s)), ph = Math.max(1, Math.round(img.height * s));
        r.source(src, pw, ph);
        if (src.kind === 'bitmap') src.bitmap.close();
        if (recipe.WhiteBalance === 'Auto') img.auto = neutralFor(asShot, srgbTo2020(greyWorld(await small(r, img, [1 / pw, 1 / ph], asShotOf(recipe)))));
        return await renderExport({ r, img, recipe, p0: [1 / pw, 1 / ph], working: img.srcW / img.width, tile: original?.tile ?? null, segments: [xmpSegment(xmpOf(recipe))], ...j });
      } finally {
        original?.close();
      }
    },
  }));
}

/** The recipe with the camera's white balance, which Auto starts from. @param {import('./fields.js').Recipe} rec */
const asShotOf = (rec) => withValue(withValue(withValue(rec, 'WhiteBalance', undefined), 'Temperature', undefined), 'Tint', undefined);

/** A 256-px render of the whole frame, read back (the editor's readSmall).
 * @param {import('./renderer.js').Renderer} r @param {any} img @param {number[]} p0 @param {import('./fields.js').Recipe} rec */
async function small(r, img, p0, rec) {
  const [fw, fh] = frameSize(geometry(rec, img.width, img.height));
  const w = 256, h = Math.max(1, Math.round((w * fh) / fw)), sc = Math.min(w / fw, h / fh);
  const view = { scale: [1 / (sc * fw), 1 / (sc * fh)], offset: [0.5 - w / (2 * sc * fw), 0.5 - h / (2 * sc * fh)], size: [w, h], flip: 0, p0, tile: null };
  return r.read(pack(rec, img, view), toneLut(rec, img.raw), w, h);
}
