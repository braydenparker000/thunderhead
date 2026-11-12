// @ts-check
// The pure parts of the compare page (/lab/editor/compare/): which tiles of the photo a view covers, the order the
// renders are made in, the cache of finished tiles, the difference of two tiles, and the marks kept on this
// device. Nothing here touches the page or the GPU, so tests/lab-compare.test.mjs can load it in node.

/** A tile's side, in photo pixels: each method draws the photo in squares this size, once each. */
export const TILE = 512;
/** The names a mark may hold: a method's kind, never a photo's or a file's name. */
export const KINDS = ['classic', 'faster', 'network', 'camera', 'file'];
/** How many marks are kept. */
export const KEEP = 200;

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect a rectangle of the photo, in photo pixels */
/** @typedef {{ tx: number, ty: number, x: number, y: number, w: number, h: number }} Tile */
/** @typedef {{ method: string, tx: number, ty: number }} Job */

/** The tiles a view of the photo covers, row by row. The view may reach past the photo's edges (a zoomed-out
 * photo sits in the middle of the viewport): only the photo's own tiles count.
 * @param {Rect} view @param {number} W the photo's width @param {number} H its height @param {number} [side]
 * @returns {Tile[]} */
export function covered(view, W, H, side = TILE) {
  const x0 = Math.max(0, view.x), y0 = Math.max(0, view.y), x1 = Math.min(W, view.x + view.w), y1 = Math.min(H, view.y + view.h);
  if (!(x1 > x0 && y1 > y0)) return [];
  const out = [];
  for (let ty = Math.floor(y0 / side); ty * side < y1; ty++) for (let tx = Math.floor(x0 / side); tx * side < x1; tx++) {
    const x = tx * side, y = ty * side;
    out.push({ tx, ty, x, y, w: Math.min(side, W - x), h: Math.min(side, H - y) });
  }
  return out;
}

/** A finished tile's name in the cache. @param {string} method @param {number} tx @param {number} ty */
export const key = (method, tx, ty) => `${method}:${tx}:${ty}`;

/** Puts jobs in the order they are made: the method on screen first, then the one a tap flips to, then the rest
 * (in the order the methods are listed); within a method, row by row. @param {Job[]} jobs @param {string} shown
 * @param {string} other @param {string[]} [methods] the methods as listed @returns {Job[]} */
export function order(jobs, shown, other, methods = []) {
  const rank = (/** @type {Job} */ j) => (j.method === shown ? 0 : j.method === other ? 1 : 2 + Math.max(0, methods.indexOf(j.method)));
  return jobs.map((j, i) => ({ j, i })).sort((p, q) => rank(p.j) - rank(q.j) || p.j.ty - q.j.ty || p.j.tx - q.j.tx || p.i - q.i).map((p) => p.j);
}

/** The queued jobs still worth doing after the view moved: those whose tile is still in view. A job already
 * running is not in the queue, so it always finishes. @param {Job[]} jobs @param {Tile[]} tiles */
export function prune(jobs, tiles) {
  const seen = new Set(tiles.map((t) => `${t.tx}:${t.ty}`));
  return jobs.filter((j) => seen.has(`${j.tx}:${j.ty}`));
}

/** What is left to make for the view: every method's tiles in view that are neither made nor being made, in order.
 * @param {Tile[]} tiles @param {string[]} methods those that can be made @param {string} shown @param {string} other
 * @param {(k: string) => boolean} has whether a tile is made or being made @returns {Job[]} */
export function plan(tiles, methods, shown, other, has) {
  const jobs = [];
  for (const method of methods) for (const t of tiles) if (!has(key(method, t.tx, t.ty))) jobs.push({ method, tx: t.tx, ty: t.ty });
  return order(jobs, shown, other, methods);
}

/** A cache that forgets what was used longest ago once it holds more than `cap`, but never what `pinned` says is
 * still needed (a tile in view): with too many pinned it holds more for a while rather than drop what shows.
 * @template T */
export class Lru {
  /** @param {number} cap @param {(value: T, key: string) => void} [gone] told of each value it forgets */
  constructor(cap, gone = () => {}) { this.cap = cap; this.gone = gone; /** @type {Map<string, T>} */ this.map = new Map(); }
  /** @param {string} k */
  has(k) { return this.map.has(k); }
  /** The value, now the most recently used. @param {string} k */
  get(k) { const v = this.map.get(k); if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } return v; }
  /** @param {string} k @param {T} v @param {(k: string) => boolean} [pinned] */
  set(k, v, pinned = () => false) {
    const old = this.map.get(k);
    if (old !== undefined && old !== v) this.gone(old, k);
    this.map.delete(k); this.map.set(k, v);
    return this.trim(pinned);
  }
  /** Forgets the oldest until it fits; returns the keys forgotten, oldest first. @param {(k: string) => boolean} [pinned] */
  trim(pinned = () => false) {
    const out = [];
    for (const k of [...this.map.keys()]) {
      if (this.map.size <= this.cap) break;
      if (pinned(k)) continue;
      const v = /** @type {T} */ (this.map.get(k)); this.map.delete(k); this.gone(v, k); out.push(k);
    }
    return out;
  }
  /** Forgets everything. */
  clear() { for (const [k, v] of this.map) this.gone(v, k); this.map.clear(); }
  get size() { return this.map.size; }
  keys() { return [...this.map.keys()]; }
}

/** @typedef {{ data: Uint8ClampedArray, width: number, height: number }} Pixels four bytes a pixel, as ImageData */
/** How two tiles differ, each channel's difference times 8, opaque. Where they are not the same size, the part
 * both cover. @param {Pixels} a @param {Pixels} b @returns {Pixels} */
export function difference(a, b) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, p = (y * a.width + x) * 4, q = (y * b.width + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = Math.abs(a.data[p + c] - b.data[q + c]) * 8;
    out[i + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** Letters for a blind comparison, one per method, shuffled once (`rand` stands in for Math.random in a test).
 * @param {string[]} methods @param {() => number} [rand] @returns {Record<string, string>} */
export function letters(methods, rand = Math.random) {
  const pool = 'PQRSTUVWXYZ'.split('').slice(0, Math.max(1, methods.length));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return Object.fromEntries(methods.map((m, i) => [m, pool[i % pool.length]]));
}

const FIELDS = ['at', 'x', 'y', 'zoom', 'a', 'b', 'picked'];
/** A preference as kept: when, where the view's middle was (0..1 of the photo), how far it was zoomed, the two
 * methods, and the one picked. @typedef {{ at: number, x: number, y: number, zoom: number, a: string, b: string, picked: string }} Mark */
/** The marks worth keeping from what was stored: only well-formed ones with exactly the fields of a mark (so a
 * name could never ride along), the newest `KEEP`. @param {unknown} stored @returns {Mark[]} */
export function cleanMarks(stored) {
  if (!Array.isArray(stored)) return [];
  const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
  const kind = (/** @type {unknown} */ v) => typeof v === 'string' && KINDS.includes(v);
  const good = stored.filter((m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const keys = Object.keys(m);
    if (keys.length !== FIELDS.length || !FIELDS.every((f) => keys.includes(f))) return false;
    return num(m.at) && m.at > 0 && num(m.x) && m.x >= 0 && m.x <= 1 && num(m.y) && m.y >= 0 && m.y <= 1 && num(m.zoom) && m.zoom > 0
      && kind(m.a) && kind(m.b) && kind(m.picked) && (m.picked === m.a || m.picked === m.b);
  });
  return good.slice(-KEEP).map((m) => ({ at: m.at, x: m.x, y: m.y, zoom: m.zoom, a: m.a, b: m.b, picked: m.picked }));
}
