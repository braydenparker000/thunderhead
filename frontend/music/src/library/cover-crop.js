// Wide covers that are a square picture with filler sides (owner, 2026-11-26): much of the owner's music has
// 16:9 thumbnails whose real cover is the square in the middle, the sides plain colour, a blurred, stretched
// copy, or a mirror of it. Given a small copy of a cover's pixels (about 64 px high: cover-fit.js makes it),
// coverCrop decides whether it is such a cover and returns the square to show, or keeps a genuinely wide
// picture whole. Pure and deterministic: no DOM, no network.
//
// The rule:
// - wide enough: width / height at least WIDE_MIN (4:3 takes the same test as 16:9); a square or tall image
//   is never cropped;
// - the square's edges: the centred square, or, where a clear vertical edge (a jump between neighbouring
//   columns of at least EDGE_MIN and EDGE_RATIO times the image's median jump) lies within EDGE_TOL of the
//   width of where an edge is expected, that edge, placed to the sub-pixel from how much of the blended
//   column next to it is picture, so an off-centre picture is cut exactly (two edges must be a square
//   within 8 %, else the one nearer where it was expected places it);
// - both side strips (left and right of the square, a column kept off each edge) are filler, each one of:
//   plain (every channel's spread at most PLAIN_STD), a mirror of the centre's columns next to it (a mean
//   difference at most MIRROR_DIFF and at most half of the strip against the same columns unmirrored),
//   stretched (rows that hardly change sideways: at most SMEAR_RATIO of the centre's sideways change and a
//   quarter of the strip's own up-and-down change), or a blur (its detail at most BLUR_RATIO of the centre's,
//   where the strip meets the picture at a found edge or the detail steps up STEP_RATIO times); a blur or a
//   stretch needs a centre with real detail (DETAIL_MIN);
// - a centre that is itself plain (an empty frame) is not cropped.

export const WIDE_MIN = 1.3;
export const EDGE_TOL = 0.05;
export const PLAIN_STD = 6;
export const BLUR_RATIO = 0.4;
export const SMEAR_RATIO = 0.15;
export const MIRROR_DIFF = 10;
/** A found edge: a column jump at least this, and at least EDGE_RATIO times the image's median jump. */
export const EDGE_MIN = 10, EDGE_RATIO = 3;
/** The centre's detail (mean change between neighbours) below which a blur cannot be told from it. */
export const DETAIL_MIN = 3;

/** The size to analyse a w×h cover at: `h` px high (64), the width keeping its shape. */
export function smallSize(w, h, high = 64) {
  if (!(w > 0 && h > 0)) return null;
  const sh = Math.min(high, h);
  return {width: Math.max(1, Math.round((w * sh) / h)), height: sh};
}

/** Whether a w×h image is wide enough to be looked at. */
export const isWide = (w, h) => w > 0 && h > 0 && w / h >= WIDE_MIN;

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Luminance plane of RGBA pixels. */
function lumaOf({width: W, height: H, data}) {
  const y = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) y[p] = luma(data, p * 4);
  return y;
}

/** Spread of each channel over columns [a, b): the largest standard deviation of R, G and B. */
function spread({width: W, height: H, data}, a, b) {
  let n = 0;
  const s = [0, 0, 0], q = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = a; x < b; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) { s[c] += data[i + c]; q[c] += data[i + c] * data[i + c]; }
    n++;
  }
  if (!n) return 0;
  return Math.max(...[0, 1, 2].map(c => Math.sqrt(Math.max(0, q[c] / n - (s[c] / n) ** 2))));
}

/** Mean change between horizontal (dx) and vertical (dy) neighbours over columns [a, b). */
function detail(Y, W, H, a, b) {
  let dx = 0, nx = 0, dy = 0, ny = 0;
  for (let y = 0; y < H; y++) for (let x = a; x < b; x++) {
    const p = y * W + x;
    if (x + 1 < b) { dx += Math.abs(Y[p + 1] - Y[p]); nx++; }
    if (y + 1 < H) { dy += Math.abs(Y[p + W] - Y[p]); ny++; }
  }
  return {dx: nx ? dx / nx : 0, dy: ny ? dy / ny : 0, all: (nx ? dx / nx : 0) + (ny ? dy / ny : 0)};
}

/** cd[x]: the mean jump between column x-1 and column x (cd[0] = 0). */
function columnJumps(Y, W, H) {
  const cd = new Float32Array(W);
  for (let x = 1; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += Math.abs(Y[y * W + x] - Y[y * W + x - 1]);
    cd[x] = s / H;
  }
  return cd;
}

/** The edge nearest `at` (in column-boundary units) within ±tol, to the sub-pixel, or null. */
function findEdge(cd, at, tol, floor) {
  const W = cd.length;
  let best = -1, bv = 0;
  for (let x = Math.max(1, Math.round(at - tol)); x <= Math.min(W - 1, Math.round(at + tol)); x++) if (cd[x] > bv) { bv = cd[x]; best = x; }
  return best < 0 || bv < floor ? null : best;
}

/**
 * An edge found between columns e-1 and e placed to the sub-pixel: the columns either side of it are a blend
 * of filler and picture where the full image's edge fell inside one of them, and how far each is from the
 * filler next to it (towards the picture beside it) says how much of it is picture. dir -1: filler on the left.
 */
function refineEdge(Y, W, H, e, dir) {
  const F = dir < 0 ? e - 2 : e + 1, P = dir < 0 ? e + 1 : e - 2;
  if (F < 0 || F >= W || P < 0 || P >= W) return e;
  const share = c => {
    const f = [];
    for (let y = 0; y < H; y++) {
      const a = Y[y * W + F], b = Y[y * W + P];
      if (Math.abs(b - a) >= 16) f.push(Math.max(0, Math.min(1, (Y[y * W + c] - a) / (b - a))));
    }
    return f.length >= H / 4 ? median(f) : null;
  };
  // The filler's column next to the edge, partly picture; else the picture's, partly filler.
  const near = share(dir < 0 ? e - 1 : e), far = share(dir < 0 ? e : e - 1);
  if (near != null && near >= 0.08) return dir < 0 ? e - near : e + near;
  if (far != null && far <= 0.92) return dir < 0 ? e + 1 - far : e - 1 + far;
  return e;
}

const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

/**
 * Mean difference between strip columns and the centre's columns next to the edge: mirrored about it, and
 * (to tell a mirror from a smooth scene that just goes on) shifted across it unmirrored.
 */
function mirrorDiff(Y, W, H, edge, width, dir) {
  let s = 0, t = 0, n = 0;
  for (let i = 0; i < width; i++) {
    const out = dir < 0 ? edge - 1 - i : edge + i, inn = dir < 0 ? edge + i : edge - 1 - i;
    const shift = dir < 0 ? edge + width - 1 - i : edge - width + i;
    if (out < 0 || out >= W || inn < 0 || inn >= W || shift < 0 || shift >= W) break;
    for (let y = 0; y < H; y++) { s += Math.abs(Y[y * W + out] - Y[y * W + inn]); t += Math.abs(Y[y * W + out] - Y[y * W + shift]); n++; }
  }
  return n ? {mirror: s / n, shifted: t / n} : {mirror: Infinity, shifted: 0};
}

/** Vertical detail per column: the mean change between a column's pixels and the ones below them. */
function columnDetail(Y, W, H) {
  const out = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y + 1 < H; y++) s += Math.abs(Y[(y + 1) * W + x] - Y[y * W + x]);
    out[x] = H > 1 ? s / (H - 1) : 0;
  }
  return out;
}

/** Whether detail steps up from the strip to the picture at column boundary `at` (dir -1: strip on the left). */
function detailStep(cv, at, dir, span = 3) {
  let a = 0, b = 0, n = 0;
  for (let i = 1; i <= span; i++) {
    const s = dir < 0 ? at - 1 - i : at + i, c = dir < 0 ? at + i : at - 1 - i;
    if (s < 0 || s >= cv.length || c < 0 || c >= cv.length) break;
    a += cv[s]; b += cv[c]; n++;
  }
  return n > 0 && b / n >= DETAIL_MIN && b >= STEP_RATIO * a;
}

/** A detail step: the picture's side of an edge at least this many times the strip's. */
export const STEP_RATIO = 2.5;

/**
 * The square cover inside a wide one: {crop, square, aspect, why}. `square` is the picture's rectangle
 * ({x, y, w, h}, fractions of the image) for a wide image; `crop` is the same when its sides are filler,
 * else null; `why` names what decided (for the tests and the report). Null for an image that is not wide.
 * @param {{width: number, height: number, data: ArrayLike<number>}} img RGBA pixels, about 64 px high
 */
export function coverCrop(img) {
  const {width: W, height: H} = img ?? {};
  if (!(W > 0 && H > 0) || !img.data || img.data.length < W * H * 4 || !isWide(W, H)) return null;
  const Y = lumaOf(img), cd = columnJumps(Y, W, H);
  const tol = Math.max(2, EDGE_TOL * W), floor = Math.max(EDGE_MIN, EDGE_RATIO * median(cd.subarray(1)));
  const x0 = (W - H) / 2;
  const le = findEdge(cd, x0, tol, floor), re = findEdge(cd, x0 + H, tol, floor);
  let left = le == null ? null : refineEdge(Y, W, H, le, -1), right = re == null ? null : refineEdge(Y, W, H, re, 1);
  // Two edges must make a square (within 8 %); one edge places the square by itself.
  if (left != null && right != null && Math.abs(right - left - H) > 0.08 * H) {
    if (Math.abs(left - x0) <= Math.abs(right - x0 - H)) right = null; else left = null;
  }
  const L = left ?? (right != null ? right - H : x0), R = right ?? L + H;
  const square = {x: Math.max(0, L) / W, y: 0, w: (Math.min(W, R) - Math.max(0, L)) / W, h: 1};
  const out = why => ({crop: why === 'wide' ? null : square, square, aspect: W / H, why});
  // The strips, a column off each edge (the blended one).
  const la = 0, lb = Math.floor(L) - 1, ra = Math.ceil(R) + 1, rb = W, ca = Math.ceil(L) + 1, cb = Math.floor(R) - 1;
  if (lb - la < 2 || rb - ra < 2 || cb - ca < 4) return out('wide');
  if (spread(img, ca, cb) <= PLAIN_STD) return out('wide');
  const centre = detail(Y, W, H, ca, cb), cv = columnDetail(Y, W, H);
  const filler = (a, b, edge, at, dir) => {
    if (spread(img, a, b) <= PLAIN_STD) return 'plain';
    const m = mirrorDiff(Y, W, H, at, b - a, dir);
    // (A smooth scene that just goes on matches its mirror as well as itself: not a mirror.)
    if (m.mirror <= MIRROR_DIFF && m.shifted >= MIRROR_DIFF && m.mirror <= 0.5 * m.shifted) return 'mirror';
    if (centre.all < DETAIL_MIN) return null;
    const d = detail(Y, W, H, a, b);
    // The picture's edge columns smeared sideways: rows that do not change across the strip.
    // (A blur softens both ways alike; a smear only sideways.)
    if (d.dx <= SMEAR_RATIO * centre.dx && d.dx <= 0.25 * d.dy) return 'stretched';
    // A blur shows where it meets the picture: a column jump, or detail stepping up.
    if ((edge != null || detailStep(cv, at, dir)) && d.all <= BLUR_RATIO * centre.all) return 'blur';
    return null;
  };
  const l = filler(la, lb, left, Math.round(L), -1), r = filler(ra, rb, right, Math.round(R), 1);
  return l && r ? out(l === r ? l : l + '+' + r) : out('wide');
}

/** A cut within this much of square (the small copy places an edge to about half a pixel) is made square. */
export const SNAP = 0.03;

/**
 * A crop rectangle (fractions) in whole pixels of a w×h image, {sx, sy, sw, sh}, or null for none: rounded
 * inward so no filler is kept, and, within SNAP of square, made exactly square about its centre.
 */
export function cropPixels(rect, w, h) {
  if (!rect || !(w > 0 && h > 0)) return null;
  let sx = Math.min(w - 1, Math.max(0, Math.ceil(rect.x * w - 1e-6)));
  const sy = Math.min(h - 1, Math.max(0, Math.ceil(rect.y * h - 1e-6)));
  const ex = Math.max(sx + 1, Math.min(w, Math.floor((rect.x + rect.w) * w + 1e-6))), ey = Math.max(sy + 1, Math.min(h, Math.floor((rect.y + rect.h) * h + 1e-6)));
  let sw = ex - sx;
  const sh = ey - sy;
  if (sw !== sh && Math.abs(sw - sh) <= SNAP * sh && sh <= w) {
    sx = Math.min(w - sh, Math.max(0, Math.round((rect.x + rect.w / 2) * w - sh / 2)));
    sw = sh;
  }
  return {sx, sy, sw, sh};
}

/** A rectangle as kept (four fractions, four decimals) and back. */
export const packRect = r => (r ? [r.x, r.y, r.w, r.h].map(v => Math.round(v * 1e4) / 1e4) : null);
export function unpackRect(a) {
  if (!Array.isArray(a) || a.length !== 4 || !a.every(v => typeof v === 'number' && v >= 0 && v <= 1)) return null;
  const [x, y, w, h] = a;
  return w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001 ? {x, y, w, h} : null;
}
