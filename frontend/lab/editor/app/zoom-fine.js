// @ts-check
// Starfish's view at 100 % and over (app/zoom.js): the rectangle of the photo that shows, made by the network
// (engine/neural.js) and laid over the full-size view on its own canvas (`closer`). Made with the engine to itself and
// only once the photo rests, never in a dial's frame: the full-size view shows meanwhile. Its view of the photo is
// kept between rests, and let go where it and the full-size view would not both fit under the phone's GPU budget
// (engine/gpu-memory.js). On a phone whose graphics chip reset while Starfish was being made (engine/gentle.js), it
// waits out the while after a reset, then hands the GPU smaller pieces: it is never left off (the owner, 2026-11-17).
import * as photo from './session.js';
import { note } from './timings.js';
import { tell } from './told.js';
import { room } from '../../engine/gpu-memory.js';
import { level, share, wait, went } from '../../engine/gentle.js';
import { SLICE_MS } from '../../engine/net-pace.js';

/** @typedef {NonNullable<ReturnType<typeof photo.whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
/** The GPU memory a full-size view w x h asks (measured: about 34 bytes a pixel of its square, 56 with Starfish's). @param {number} w @param {number} h */
export const viewMem = (w, h, net = false) => (Math.sqrt(w * h * 1.6) + 32) ** 2 * (net ? 56 : 34);

/** Starfish for the zoom: `closer` its canvas, `place` lays it over the sensor rectangle it holds, `pace` and `parts`
 * the zoom's own (a part at a time, left when a finger comes down), `again` the zoom's way to try once more,
 * `drop` lets the zoom's full-size view go (memory wanted), `busy` counts what is being made.
 * @param {{ closer: HTMLCanvasElement, place: (c: HTMLCanvasElement, X: number, Y: number, w: number, h: number) => void,
 *   pace: (mine: number, took: number[]) => { stop: () => boolean, note: (ms: number) => void },
 *   parts: (took: number[]) => Record<string, number>, again: (mine: number) => void, drop: () => void, busy: (n: number) => void }} z */
export function starfish(z) {
  let fine = /** @type {View | null} */ (null), fineOf = /** @type {Big | null} */ (null), fineCap = [0, 0], lostSaid = false;   // the network's view of the photo, and how much it holds
  const letFine = () => { if (fine && fineOf === photo.whole()) fine.dispose(); fine = null; fineOf = null; fineCap = [0, 0]; };
  /** Makes Starfish's view of the sensor rectangle X, Y, w x h, while `mine()` (no newer job). @param {number} job @param {() => boolean} mine
   * @param {number} X @param {number} Y @param {number} w @param {number} h */
  async function finer(job, mine, X, Y, w, h) {
    const big = photo.whole();
    if (!big || photo.current()?.plain) return;   // a JPEG has no sensor data for the network
    if (level('starfish')) { await wait('starfish'); if (!mine() || photo.whole() !== big) return; }   // (gentle.js: it was being made when the chip reset)
    const t0 = performance.now(); let made = 0;   // how long the network's view took to make, when it had to be (the timings say: the first one of a photo compiles it unless that was done behind the photo, full.js)
    if (!fine || fineOf !== big || fineCap[0] < w || fineCap[1] < h) {
      letFine(); if (!room(viewMem(w, h, true))) z.drop();
      if (!room(viewMem(w, h, true))) { note('fine', 0, { left: 1, memory: 1 }); return; }
      fine = await big.view(w, h, null, false, false, true); fineOf = big; fineCap = [w, h]; made = performance.now() - t0;
    }
    if (!fine.net || !mine()) { if (fine.lost && !lostSaid) { lostSaid = true; tell('Best quality cannot run on this phone just now: this is the standard view'); } return; }   // a GPU that will not have the network: the full-size view is all there is, and it is said, once
    const began = performance.now(), took = /** @type {number[]} */ ([]), aim = SLICE_MS * share('starfish');   // each piece about a frame long; gentler, shorter
    let im = /** @type {ImageData | null} */ (null), at = fine.at();
    z.busy(1); try { await photo.alone(async () => { if (!mine() || !fine) return; await photo.settle(); at = await fine.region(X, Y, w, h, null, { ...z.pace(job, took), aim }); im = at && (await fine.read()); fine.rest(); }); } finally { z.busy(-1); }
    if (!mine() || !im || !at) { if (took.length) note('fine', performance.now() - began, { left: 1, ...z.parts(took) }); z.again(job); return; }
    z.closer.width = im.width; z.closer.height = im.height; /** @type {CanvasRenderingContext2D} */ (z.closer.getContext('2d', photo.space)).putImageData(im, 0, 0);
    z.place(z.closer, at.X, at.Y, at.cw, at.ch); went('starfish');
    note('fine', performance.now() - began, { px: at.cw * at.ch, ...(made ? { made } : {}), ...z.parts(took), ...(level('starfish') ? { level: level('starfish') } : {}) });
  }
  return { finer, letFine };
}
