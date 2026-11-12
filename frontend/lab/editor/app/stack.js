// @ts-check
// Stacking for noise, the editor's part (engine/stack.js has the arithmetic and says why): the RAFs given are
// decoded one after another and averaged as sensor data into a new photo, which the Library then holds beside
// them and the editor opens like any RAF. The frames themselves stay. A frame is left out, and counted, when it
// was shot otherwise than the first (another ISO, shutter time or aperture: it would not be the same exposure) or
// has moved against it (the tripod was touched). One frame is in memory at a time, with the running sum.
import { frame } from './decoder.js';
import { changed, stem } from './session.js';
import * as store from './store.js';
import { STILL, pack, shiftOf, stackMeta, summer } from '../../engine/stack.js';

/** @param {string[]} ids the frames, RAFs @param {(k: number, n: number) => void} step
 * @returns {Promise<{ id: string, name: string, used: number, moved: number, differ: number, bad: number }>} `id`: the stack's, '' when fewer than two frames could be used */
export async function stackOn(ids, step) {
  const frames = /** @type {store.Photo[]} */ (ids.map((id) => store.photos().find((p) => p.id === id)).filter((p) => p && !p.kind));
  let first = /** @type {store.Photo | null} */ (null), base = /** @type {Awaited<ReturnType<typeof frame>> | null} */ (null), sum = /** @type {ReturnType<typeof summer> | null} */ (null), moved = 0, differ = 0, bad = ids.length - frames.length;
  const how = (/** @type {store.Photo} */ p) => `${p.shot?.time || 0}/${p.shot?.f || 0}`;
  for (const [k, p] of frames.entries()) {
    step(k, frames.length);
    try {
      const f = await frame(await store.raw(p.id));
      if (!f.mosaic) { bad++; continue; }
      if (!first || !base || !sum) { first = p; base = { ...f, mosaic: null }; sum = summer(f.mosaic.length); sum.add(f.mosaic); }
      else if (f.mosaic.length !== base.proxy.length / 4 * 9 || f.meta.cfa !== base.meta.cfa || f.meta.iso !== base.meta.iso || how(p) !== how(first)) differ++;
      else if (Math.hypot(...shiftOf(base.proxy, f.proxy, f.width, f.height)) > STILL) moved++;
      else sum.add(f.mosaic);
      /** @type {any} */ (f.mosaic.buffer).transfer?.(0);   // its 80 MB given back before the next is decoded
    } catch { bad++; }
  }
  step(frames.length, frames.length);
  const used = sum?.count || 0;
  if (!first || !base || !sum || used < 2) return { id: '', name: '', used, moved, differ, bad };
  const meta = stackMeta(base.meta, used, { dr: base.dr, settings: base.settings }), name = `${stem(first.name)} ×${used}`;
  const made = await store.addMade(name, pack(sum.done(), meta), first.id, { taken: first.taken + 1, stamp: first.stamp, shot: first.shot });
  changed();
  return { id: made.id, name, used, moved, differ, bad };
}
