// @ts-check
// How noisy THIS photo's sensor data is, read from the data itself: the variance of a recorded value x (0..1 of
// the sensor's range, black taken off) is a·x + b. The network (neural.js) is told each site's noise and smooths
// by it, so the numbers have to be a raw site's own. darktable's profiles (noise.js) are not: they are measured
// after its demosaic and through a wavelet's finest band, and come out about 17 times too low in variance for a
// site (the X-E5's full well and read noise say so too), which left the network taking out a quarter of the noise.
// The fit is Foi and others' (2008) idea as vkdt's nprof and Starfish's own estimator use it: in small blocks,
// green sites one whole pattern apart differ only by noise where the picture is flat; a block's mean and half
// the mean square of those differences are one point; the flattest blocks at each brightness give the line.

const STEP = 6, BLOCK = 12, PAIRS = 40;   // the X-Trans pattern's size; a block is two patterns square: 40 pairs of greens one pattern apart along the rows
const LOW = 0.25, LOW_IS = 0.838;   // the quarter of a brightness's blocks with least difference is taken as flat: a chi-square of 39's lower quartile over its mean
const BINS = 28;

/** Whether a sensor position is green, as demosaic.js and neural.js lay the pattern out. @param {number} x @param {number} y @param {number[]} phase */
const green = (x, y, phase) => ((((x + phase[0] + 6000) % 3) + ((y + phase[1] + 6000) % 3)) & 1) === 0;

/** Fits a and b to a mosaic. `ok` is false where the photo gives too little to go by (the table then stands).
 * @param {Uint16Array} mosaic @param {number} W @param {number} H @param {number} black @param {number} white
 * @param {number[]} phase @param {number} [skip] every how many blocks one is read (2: a quarter of the photo)
 * @returns {{ a: number, b: number, ok: boolean, blocks: number }} */
export function fitNoise(mosaic, W, H, black, white, phase, skip = 2) {
  const range = white - black, top = white - 0.02 * range, pts = /** @type {number[][]} */ (Array.from({ length: BINS }, () => []));
  // which of a block's positions are green with a green one pattern to the right (the same for every block)
  const at = /** @type {number[]} */ ([]);
  for (let y = 0; y < BLOCK; y++) for (let x = 0; x < STEP; x++) if (green(x, y, phase)) at.push(y * W + x);
  let blocks = 0;
  for (let by = BLOCK; by + BLOCK < H - BLOCK; by += BLOCK * skip) for (let bx = BLOCK; bx + BLOCK < W - BLOCK; bx += BLOCK * skip) {
    const o = by * W + bx; let sum = 0, sq = 0, ds = 0, n = 0, clipped = false;
    for (const k of at) { const p = mosaic[o + k], q = mosaic[o + k + STEP]; if (p >= top || q >= top) { clipped = true; break; } const d = p - q; sum += p + q; sq += d * d; ds += d; n++; }
    if (clipped || n < PAIRS / 2) continue;
    // about the block's own mean difference: a smooth slope across the block (a sky's gradient) is not noise
    sq = ((sq - (ds * ds) / n) * n) / (n - 1);
    const x = (sum / (2 * n) - black) / range;
    if (!(x > 0.0005)) continue;
    // brightness in bins a sixth of a stop wide, from 0.0005 of the range up
    const bin = Math.min(BINS - 1, Math.floor(Math.log2(x / 0.0005) * 2.6));
    pts[bin].push(x, sq / (2 * n) / (range * range)); blocks++;
  }
  // each bin's flattest quarter: its mean brightness and the variance that quarter's edge stands for
  const line = /** @type {number[][]} */ ([]);
  for (const p of pts) {
    const n = p.length / 2; if (n < 40) continue;
    const vs = Array.from({ length: n }, (_, i) => p[2 * i + 1]).sort((u, v) => u - v), cut = vs[Math.floor(n * LOW)];
    let xs = 0, m = 0; for (let i = 0; i < n; i++) if (p[2 * i + 1] <= cut) { xs += p[2 * i]; m++; }
    line.push([xs / m, cut / LOW_IS, n]);
  }
  if (line.length < 4) return { a: 0, b: 0, ok: false, blocks };
  // a straight line through them, each weighted by its blocks and by how sure a variance of that size is (its own square)
  const fit = (/** @type {number[][]} */ l) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, v, n] of l) { const w = n / (v * v); sw += w; sx += w * x; sy += w * v; sxx += w * x * x; sxy += w * x * v; }
    const den = sw * sxx - sx * sx, a = den > 0 ? (sw * sxy - sx * sy) / den : 0;
    return [a, (sy - a * sx) / sw];
  };
  let [a, b] = fit(line);
  // a brightness whose every block has texture stands above the line: such bins are left out and the line laid again
  const kept = line.filter(([x, v]) => v < 1.6 * Math.max(a * x + b, 1e-12));
  if (kept.length >= 4) [a, b] = fit(kept);
  const ok = a > 0 && Number.isFinite(a) && Number.isFinite(b);
  return { a: ok ? a : 0, b: ok ? Math.max(b, 0) : 0, ok, blocks };
}

/** What the sensor itself gives for the X-Trans V (X-E5, X-T5, X-H2: a full well near 22,900 electrons at ISO 125, the
 * second gain from ISO 500; photonstophotos' measurements), for a photo too busy or too dark to fit: a per ISO, and b
 * from the read noise. @param {number} iso @returns {{ a: number, b: number }} */
export function sensorNoise(iso) {
  const a = iso / (125 * 22900), read = iso < 500 ? 2.5 : 1.25;   // electrons of read noise, as recorded
  return { a, b: (read * a) ** 2 };
}

const KEEP = 0.75, QUIET = 8;   // chosen by eye on the owner's photos at 100 % (STATUS.md, 2026-11-13): a wall keeps its texture, dark brick stays clean
/** What the Noise dial asks of the network (neural.js `run`), `start` being where the dial starts for the photo's ISO
 * (session.js `noiseStart`). The network is always told at least the photo's whole noise, so colour speckle and the
 * shadows' noise go; what the dial moves is the fine grain: at its start most of it is put back as brightness only
 * (`keep`, less of it in the shadows: `quiet`), below the start more of it and at 0 all of it, above the start less,
 * and from 25 past the start none, the network told of more noise than there is the further it goes.
 * @param {number} dial 0 to 100 @param {number} start @returns {{ smooth: number, keep: number, quiet: number }} */
export function dialled(dial, start) {
  const up = Math.max(0, dial - start), down = start > 0 ? Math.max(0, start - dial) / start : 0;
  return { smooth: 1 + up / 60, keep: down > 0 ? KEEP + (1 - KEEP) * down : KEEP * Math.max(0, 1 - up / 25), quiet: QUIET * (1 - down) };
}
