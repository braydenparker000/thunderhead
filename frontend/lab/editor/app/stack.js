// @ts-check
// Stacking for noise, the editor's part (engine/stack.js has the arithmetic and says why): the RAFs given are
// decoded one after another and averaged as sensor data into a new photo, which the Library then holds beside
// them and the editor opens like any RAF. The frames themselves stay. Frames shot alike are averaged (less
// noise); frames at different shutter times are a bracket, added up by their exposures (clean shadows and the
// short frame's highlights: one photo with the range of all). A frame is left out, and counted, when it was shot
// otherwise than the first in what a stack cannot make up for (another ISO or aperture, another DR setting in a
// bracket) or has moved against it (the tripod was touched). One frame is in memory at a time, with the running sum.
import { frame } from './decoder.js';
import { changed, stem } from './session.js';
import * as store from './store.js';
import { STILL, pack, shiftOf, stackMeta, summer } from '../../engine/stack.js';

/** A sensel this far up the sensor's range has clipped, or is near enough that it no longer answers in step. */
const CLIP = 0.9;
/** @param {string[]} ids the frames, RAFs @param {(k: number, n: number) => void} step
 * @returns {Promise<{ id: string, name: string, used: number, bracket: boolean, moved: number, differ: number, bad: number }>} `id`: the stack's, '' when fewer than two frames could be used */
export async function stackOn(ids, step) {
  // shortest exposure first: a bracket is added up from the frame that clipped least (engine/stack.js `summer`)
  const frames = /** @type {store.Photo[]} */ (ids.map((id) => store.photos().find((p) => p.id === id)).filter((p) => p && !p.kind)).sort((a, b) => (a.shot?.time || 0) - (b.shot?.time || 0) || a.taken - b.taken);
  let first = /** @type {store.Photo | null} */ (null), base = /** @type {Awaited<ReturnType<typeof frame>> | null} */ (null), sum = /** @type {ReturnType<typeof summer> | null} */ (null), moved = 0, differ = 0, bad = ids.length - frames.length;
  const times = /** @type {number[]} */ ([]);
  for (const [k, p] of frames.entries()) {
    step(k, frames.length);
    try {
      const f = await frame(await store.raw(p.id)), t = first?.shot?.time && p.shot?.time ? p.shot.time / first.shot.time : 1;   // its exposure against the first's
      if (!f.mosaic) { bad++; continue; }
      if (!first || !base || !sum) { first = p; base = { ...f, mosaic: null }; sum = summer(f.mosaic.length, f.meta.black, f.meta.black + CLIP * (f.meta.white - f.meta.black)); sum.add(f.mosaic); times.push(1); }
      else if (f.mosaic.length !== base.proxy.length / 4 * 9 || f.meta.cfa !== base.meta.cfa || f.meta.iso !== base.meta.iso || (p.shot?.f || 0) !== (first.shot?.f || 0) || (t !== 1 && f.dr !== base.dr)) differ++;
      else if (Math.hypot(...shiftOf(base.proxy, f.proxy, f.width, f.height, 1 / t)) > STILL) moved++;
      else { sum.add(f.mosaic, t); times.push(t); }
      /** @type {any} */ (f.mosaic.buffer).transfer?.(0);   // its 80 MB given back before the next is decoded
    } catch { bad++; }
  }
  step(frames.length, frames.length);
  const used = sum?.count || 0, bracket = times.some((t) => t > 1.2);
  if (!first || !base || !sum || used < 2) return { id: '', name: '', used, bracket, moved, differ, bad };
  const meta = stackMeta(base.meta, used, { dr: base.dr, settings: base.settings, light: sum.light, lift: bracket ? times[Math.floor((times.length - 1) / 2)] : 1 });
  const name = `${stem(first.name)} ${bracket ? 'HDR' : ''}×${used}`.replace('  ', ' ');
  const made = await store.addMade(name, pack(sum.done(), meta), first.id, { taken: first.taken + 1, stamp: first.stamp, shot: first.shot });
  changed();
  return { id: made.id, name, used, bracket, moved, differ, bad };
}
