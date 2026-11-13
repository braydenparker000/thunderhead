// @ts-check
// Export: the whole photo developed from the sensor's own pixels, a band at a time (full.js), brought to the
// size asked for by averaging in linear light, and handed to a file's writer (files.js) as it comes. The page does
// the GPU's part and reads each band back; the rest (reduce.js) is done on the export's own thread
// (export-thread.js), so the page keeps drawing while a 40 MP photo is written.
import { thread, work } from './export-thread.js';

export { OUTPUT, crisp } from './reduce.js';

const SPLIT = 4;   // an export's first pieces are timed a step at a time (full.js `region`), for the phone's own numbers
const NET_TILE = 960, NET_BAND = 512;   // a piece by the network: with its edge and the lens's reach, inside one of the network's windows
const BAND = 256, TILE = 1024, EDGE = 12;   // the picture's rows a step and how wide a piece of them is developed at once (less, strongly
// straightened); and how far past a piece it is developed, so sharpening sees the same neighbours either side of a join

/** A file to make: its size (`long` pixels on its long edge), output sharpening's strength (`OUTPUT`; 0 or none for
 * none), and either `file`, what it is to be given its size (files.js `Spec`: made on the export's thread), or
 * `open`, its writer given its size (made and written on the page).
 * @typedef {{ long: number, sharpen?: number, file?: (w: number, h: number) => import('./files.js').Spec, open?: (w: number, h: number) => import('./files.js').Writer }} Job */
/** An export's finished bands kept as they are made (the editor's app/export-kept.js), so one that stops carries on
 * from there: `get` a band if it was made before (its first row, its rows, how wide), `put` one just made.
 * @typedef {{ get: (y: number, n: number, w: number) => Promise<Uint16Array | null>, put: (y: number, n: number, w: number, band: Uint16Array) => Promise<void>, clear: () => Promise<void> }} Keep */
/** How an export runs: `signal` gives it up (it then rejects with the signal's reason, an AbortError), `encode` is
 * the JPEG encoder, `worker: false` keeps all its work on the page, `ops` times one of the network's windows a
 * pass at a time once the photo is made, each pass also the other way (`clock.ops` and `clock.alt`, in ms: neural.js `bench`), and `keep` holds the finished bands.
 * @typedef {{ signal?: AbortSignal, encode?: import('./files.js').Band, worker?: boolean, ops?: boolean, keep?: Keep | null }} How */
/** An export asked for by the network that the network cannot make here: nothing is made in its place. */
export class NoBest extends Error { constructor(/** @type {string} */ why) { super(`Best quality cannot run on this phone just now (${why}). Nothing was saved, and no lesser method was put in its place.`); this.name = 'NoBest'; } }

/** Develops the photo as it now looks on screen, once, for every file asked for: each at its own size (no larger
 * than the sensor's), into its own writer. The photo is developed at full size a band at a time and each file takes
 * the band down to its size, so two files cost one development, not two.
 * @param {NonNullable<Awaited<ReturnType<typeof import('./full.js').full>>>} big the photo's sensor pixels
 * @param {Job[]} jobs each file @param {(done: number) => void} [progress] 0 to 1
 * @param {Record<string, any> | null} [clock] filled with where the time went, in ms: `gpu` developing, `read` bringing pieces back, `write` reducing
 *   and encoding, `wait` the page waiting on the export's thread, `off`: 1 when that was on its own thread, `split`: the first pieces' steps by
 *   name over `splitPx` pixels, and `net`: 1 when the network made the colours
 *   and `held`: how many of the photo's rows were not made now but read from `how.keep`
 * @param {boolean} [best] the sensor's colours by the network (full.js `view`): where it cannot run the export is refused (`NoBest`), never made another way
 * @param {How} [how] */
export async function develop(big, jobs, progress, clock = null, best = false, how = {}) {
  const sw = big.width, sh = big.height, signal = how.signal;
  signal?.throwIfAborted();
  const off = how.worker !== false && jobs.every((j) => j.file) ? thread() : Promise.resolve(null);   // started while the GPU makes ready
  // The network works a window of the sensor at a time (neural.js: 990 pixels of each 1056 are its own), so its pieces
  // are cut to sit in one window each, and taller: less of its work then goes on the context round a piece.
  const [wide, rows] = best ? [NET_TILE, NET_BAND] : [TILE, BAND];
  const v = await big.view(Math.min(sw, wide) + 2 * EDGE, rows + 2 * EDGE, null, false, true, best).catch(async (err) => { (await off)?.terminate(); throw err; });
  if (v.lost) { const why = v.lost; v.dispose(); (await off)?.terminate(); throw new NoBest(why); }
  if (clock) clock.net = v.net ? 1 : 0;
  let s = /** @type {import('./export-thread.js').Sink | null} */ (null);
  try {
    const outs = jobs.map((j) => {
      const f = Math.min(1, j.long / Math.max(sw, sh)), ow = Math.max(1, Math.round(sw * f)), oh = Math.max(1, Math.round(sh * f));
      const file = j.file ? j.file(ow, oh) : /** @type {NonNullable<Job['open']>} */ (j.open)(ow, oh);
      return { ow, oh, sharpen: j.sharpen || 0, file };
    });
    s = work(await off, sw, sh, outs, how.encode || null, signal);
    if (clock) clock.off = s.off ? 1 : 0;
    const [tw, th] = v.room().map((r) => Math.max(8, r - 2 * EDGE));
    let pieces = 0;
    for (let y = 0; y < sh; y += th) {
      const n = Math.min(th, sh - y), was = (await how.keep?.get(y, n, sw)) || null, band = was || new Uint16Array(sw * n * 4);
      if (was && clock) clock.held = (clock.held || 0) + n;
      for (let x = 0; x < sw && !was; x += tw) {   // a tile at a time: a straightened band draws on far more of the sensor than a tile of it does
        signal?.throwIfAborted();
        const w = Math.min(tw, sw - x), t0 = performance.now(), split = clock && pieces < SPLIT ? (clock.split ??= {}) : null;
        const at = await v.region(x - EDGE, y - EDGE, w + 2 * EDGE, n + 2 * EDGE, split), t1 = performance.now(), half = await v.halves();   // at the picture's edge it is drawn from further in
        if (clock) { clock.gpu = (clock.gpu || 0) + t1 - t0; clock.read = (clock.read || 0) + performance.now() - t1; if (split) clock.splitPx = (clock.splitPx || 0) + at.cw * at.ch; } pieces++;
        for (let r = 0; r < n; r++) { const from = ((y - at.Y + r) * at.cw + x - at.X) * 4; band.set(half.subarray(from, from + w * 4), (r * sw + x) * 4); }
      }
      if (!was) await how.keep?.put(y, n, sw, band);
      const t2 = performance.now();
      await s.push(band, n);   // on its own thread, the band is given away: the next is a new one
      if (clock) clock.wait = (clock.wait || 0) + performance.now() - t2;
      signal?.throwIfAborted();
      progress?.((y + n) / sh);
    }
    const t3 = performance.now(), ops = clock && how.ops && v.ops ? v.ops().catch(() => null) : null, blobs = await s.done();   // the network's passes timed apart, while the files are finished
    if (clock) { clock.wait = (clock.wait || 0) + performance.now() - t3; clock.write = s.ms(); const t = ops && (await ops); if (t) { clock.ops = t.ms; clock.alt = t.alt; } }
    signal?.throwIfAborted();
    return outs.map((o, k) => ({ blob: blobs[k], width: o.ow, height: o.oh }));
  } catch (err) {
    // given up or failed: the thread is stopped with whatever it held, and nothing is written
    if (s) s.drop(); else off.then((w) => w?.terminate());
    throw err;
  } finally { v.dispose(); }
}
