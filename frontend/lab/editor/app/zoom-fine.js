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
import { level, share, wait, waitIn, went } from '../../engine/gentle.js';
import { doing } from '../../engine/work.js';
import { SLICE_MS } from '../../engine/net-pace.js';

/** @typedef {NonNullable<ReturnType<typeof photo.whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
const CAP = 944;   // fits inside one Starfish v0.2.0 window (CORE = 978) with STRIP_TILES=10 + 0-byte sharpener scratch reuse (~118 MB total)
/** The GPU memory a full-size view w x h asks: Starfish shares its scratch planes with deconv (~24 B/px + 82 MB pool, capped at CAP); classic ~50 B/px. @param {number} w @param {number} h */
export const viewMem = (w, h, net = false) => {
  const cw = net ? Math.min(w, CAP) : w, ch = net ? Math.min(h, CAP) : h;
  return (Math.sqrt(cw * ch * 1.6) + 32) ** 2 * (net ? 24 : 50) + (net ? 82e6 : 0);
};

/** Starfish for the zoom: `closer` its canvas, `place` lays it over the sensor rectangle it holds, `pace` and `parts`
 * the zoom's own (a part at a time, left when a finger comes down), `again` the zoom's way to try once more,
 * `drop` lets the zoom's full-size view go (memory wanted), `busy` counts what is being made.
 * @param {{ closer: HTMLCanvasElement, place: (c: HTMLCanvasElement, X: number, Y: number, w: number, h: number) => void,
 *   pace: (mine: number, took: number[]) => { stop: () => boolean, note: (ms: number) => void },
 *   parts: (took: number[]) => Record<string, number>, again: (mine: number) => void, drop: () => void, busy: (n: number) => void }} z */
export function starfish(z) {
  let fine = /** @type {View | null} */ (null), fineOf = /** @type {Big | null} */ (null), fineCap = [0, 0];
  let lostSaid = false, memSaid = false, coolSaid = false;
  const letFine = () => { if (fine && fineOf === photo.whole()) fine.dispose(); fine = null; fineOf = null; fineCap = [0, 0]; };
  /** Makes Starfish's view of the sensor rectangle X, Y, w x h, while `mine()` (no newer job). @param {number} job @param {() => boolean} mine
   * @param {number} X @param {number} Y @param {number} w @param {number} h */
  async function finer(job, mine, X, Y, w, h) {
    const big = photo.whole();
    if (!big || photo.current()?.plain) return;   // a JPEG has no sensor data for the network
    // Never hang the "Loading Starfish" badge during a long GPU-reset cooldown (gentle.js)
    if (level('starfish')) {
      const ms = waitIn('starfish');
      if (ms > 15_000) { if (!coolSaid) { coolSaid = true; tell('Starfish is resting after a GPU reset; showing standard detail'); } return; }
      if (ms > 0) { await wait('starfish'); if (!mine() || photo.whole() !== big) return; }
    }
    const cw = Math.min(CAP, Math.max(8, Math.round(w))), ch = Math.min(CAP, Math.max(8, Math.round(h)));
    const sd = doing('Loading Starfish');
    try {
      const t0 = performance.now(); let made = 0;
      if (!fine || fineOf !== big || fineCap[0] < cw || fineCap[1] < ch) {
        letFine(); if (!room(viewMem(cw, ch, true))) z.drop();
        if (!room(viewMem(cw, ch, true))) {
          note('fine', 0, { left: 1, memory: 1 });
          if (!memSaid) { memSaid = true; tell('Not enough GPU memory for Starfish at this zoom'); }
          return;
        }
        fine = await big.view(cw, ch, null, false, false, true); fineOf = big; fineCap = [cw, ch]; made = performance.now() - t0;
      }
      if (!fine.net || !mine()) { if (fine.lost && !lostSaid) { lostSaid = true; tell('Best quality cannot run on this phone just now: this is the standard view'); } return; }
      const began = performance.now(), took = /** @type {number[]} */ ([]), aim = SLICE_MS * share('starfish');
      const [rw, rh] = fine.room(), rx0 = Math.max(0, Math.round(X)), ry0 = Math.max(0, Math.round(Y));
      const allW = Math.max(8, Math.min(big.width - rx0, Math.round(w))), allH = Math.max(8, Math.min(big.height - ry0, Math.round(h)));
      const ctx = /** @type {CanvasRenderingContext2D} */ (z.closer.getContext('2d', photo.space));
      if (allW <= rw && allH <= rh) {
        let im = /** @type {ImageData | null} */ (null), at = fine.at();
        z.busy(1); try { await photo.alone(async () => { if (!mine() || !fine) return; await photo.settle(); at = await fine.region(rx0, ry0, allW, allH, null, { ...z.pace(job, took), aim }); im = at && (await fine.read()); fine.rest(); }); } finally { z.busy(-1); }
        if (!mine() || !im || !at) { if (took.length) note('fine', performance.now() - began, { left: 1, ...z.parts(took) }); z.again(job); return; }
        z.closer.width = im.width; z.closer.height = im.height; ctx.putImageData(im, 0, 0);
        z.place(z.closer, at.X, at.Y, at.cw, at.ch); went('starfish');
        note('fine', performance.now() - began, { px: at.cw * at.ch, ...(made ? { made } : {}), ...z.parts(took), ...(level('starfish') ? { level: level('starfish') } : {}) });
        return;
      }
      // High-DPI 100 % viewport wider/taller than one Starfish window: balanced grid, painted center-outward
      /** @type {{ x: number, y: number, tw: number, th: number, d: number }[]} */
      const grid = [], cx = rx0 + allW / 2, cy = ry0 + allH / 2;
      const nx = Math.ceil(allW / rw), ny = Math.ceil(allH / rh), stepX = Math.ceil(allW / nx), stepY = Math.ceil(allH / ny);
      for (let iy = 0; iy < ny; iy++) {
        const ty = ry0 + iy * stepY, th = Math.min(stepY, ry0 + allH - ty);
        for (let ix = 0; ix < nx; ix++) {
          const tx = rx0 + ix * stepX, tw = Math.min(stepX, rx0 + allW - tx);
          grid.push({ x: tx, y: ty, tw, th, d: Math.hypot(tx + tw / 2 - cx, ty + th / 2 - cy) });
        }
      }
      grid.sort((a, b) => a.d - b.d);
      z.closer.width = allW; z.closer.height = allH; ctx.clearRect(0, 0, allW, allH);
      let ok = true;
      for (const g of grid) {
        let im = /** @type {ImageData | null} */ (null), at = fine.at();
        z.busy(1); try { await photo.alone(async () => { if (!mine() || !fine) return; await photo.settle(); at = await fine.region(g.x, g.y, g.tw, g.th, null, { ...z.pace(job, took), aim }); im = at && (await fine.read()); fine.rest(); }); } finally { z.busy(-1); }
        if (!mine() || !im || !at) { ok = false; break; }
        ctx.putImageData(im, at.X - rx0, at.Y - ry0);
        z.place(z.closer, rx0, ry0, allW, allH);
      }
      if (!ok) { if (took.length) note('fine', performance.now() - began, { left: 1, ...z.parts(took) }); z.again(job); return; }
      went('starfish');
      note('fine', performance.now() - began, { px: allW * allH, ...(made ? { made } : {}), ...z.parts(took), ...(level('starfish') ? { level: level('starfish') } : {}) });
    } finally { sd(); }
  }
  return { finer, letFine };
}
