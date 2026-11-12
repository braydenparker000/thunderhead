// @ts-check
// The compare page's tiles: each method draws each tile of the photo in view once, and the tile is kept, so
// changing method only changes which finished layer shows, and zooming draws nothing. The engine makes one tile
// at a time, the method on screen first (tiles.js `plan`); a tile that left the view before its turn is not made.
// A picture laid over the photo (the camera's JPEG, a file) is cut into the same tiles.
import * as photo from '../app/session.js';
import { S, changed, method, other } from './state.js';
import { Lru, TILE, covered, difference, key, plan } from './tiles.js';
import * as view from './view.js';

/** @typedef {{ bm: ImageBitmap, el: HTMLCanvasElement }} Done a finished tile: its pixels, and the canvas showing them */
const CAP = 64;
const cache = /** @type {Lru<Done>} */ (new Lru(CAP, (d) => { d.bm.close(); d.el.remove(); }));
const diffs = /** @type {Lru<HTMLCanvasElement>} */ (new Lru(CAP, (el) => el.remove()));
const making = /** @type {Set<string>} */ (new Set()), failed = /** @type {Set<string>} */ (new Set());
let queue = /** @type {import('./tiles.js').Job[]} */ ([]), busy = false, pair = '';

/** The tiles of the photo in view now. */
export const tiles = () => covered(view.rect(), S.W, S.H);
/** Whether a cached tile is in view (it is then kept even past the cache's size). @param {string} k */
function pinned(k) { const [, tx, ty] = k.split(':').map(Number); return tiles().some((t) => t.tx === tx && t.ty === ty); }
/** How many of the tiles in view a method has finished. @param {string} id */
export function progress(id) { const t = tiles(); return { done: t.filter((x) => cache.has(key(id, x.tx, x.ty))).length, of: t.length }; }
/** Whether every tile in view is finished for a method. @param {string} id */
export function ready(id) { const p = progress(id); return p.of > 0 && p.done === p.of; }

/** Makes what the view now needs: called after the view moves, a method is added or the order changes. A
 * render already running finishes; queued ones whose tile left the view are dropped. */
export function pump() {
  replan();
  show();
  if (!busy) run().catch((e) => console.warn('compare tiles', e));
}
function replan() {
  const can = S.methods.filter((m) => !m.off).map((m) => m.id);
  queue = plan(tiles(), can, S.shown, other(), (k) => cache.has(k) || making.has(k) || failed.has(k));
}
async function run() {
  busy = true;
  try {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const m = method(j.method), k = key(j.method, j.tx, j.ty);
      if (!m) continue;
      making.add(k); S.busy = m.id; changed();
      try { await make(m, j.tx, j.ty); } catch (e) { failed.add(k); console.warn('compare tile', k, e); } finally { making.delete(k); }
      replan();   // the view may have moved meanwhile
      show();
    }
  } finally { busy = false; S.busy = ''; changed(); }
}

/** One tile of one method, made and laid in its layer at its place in the photo.
 * @param {import('./state.js').Method} m @param {number} tx @param {number} ty */
async function make(m, tx, ty) {
  const x = tx * TILE, y = ty * TILE, w = Math.min(TILE, S.W - x), h = Math.min(TILE, S.H - y);
  let bm = /** @type {ImageBitmap | null} */ (null), at = { X: x, Y: y, cw: w, ch: h };
  if (m.view) {
    const v = m.view;
    let im = /** @type {ImageData | null} */ (null);
    // the engine to itself, with the photo's own settings put back first (a render of the editing copy may have changed them)
    await photo.alone(async () => { await photo.settle(); at = await v.region(x, y, w, h); im = await v.read(); v.rest(); });
    if (!im) return;
    S.renders++;
    bm = await createImageBitmap(im);
  } else if (m.src) {   // a picture stretched over the whole photo, so it lines up roughly: this tile's part of it
    const kx = m.src.width / S.W, ky = m.src.height / S.H;
    bm = await createImageBitmap(m.src, x * kx, y * ky, w * kx, h * ky, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  if (!bm) return;
  const el = document.createElement('canvas');
  el.width = bm.width; el.height = bm.height; el.className = 'tile';
  /** @type {CanvasRenderingContext2D} */ (el.getContext('2d')).drawImage(bm, 0, 0);
  Object.assign(el.style, { left: `${at.X}px`, top: `${at.Y}px`, width: `${at.cw}px`, height: `${at.ch}px` });
  view.layer(m.id).layer.append(el);
  cache.set(key(m.id, tx, ty), { bm, el }, pinned);
}

/** The pixels of a finished tile. @param {Done} d */
function pixels(d) {
  const c = new OffscreenCanvas(d.bm.width, d.bm.height), g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(d.bm, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}
/** The difference's tiles for the two methods compared, where both are finished in view (on the CPU: |A − B| × 8). */
function differ() {
  const lay = view.layer('diff').layer, now = `${S.a}|${S.b}`;
  if (now !== pair) { pair = now; diffs.clear(); }
  for (const t of tiles()) {
    const k = key('diff', t.tx, t.ty), a = cache.get(key(S.a, t.tx, t.ty)), b = cache.get(key(S.b, t.tx, t.ty));
    if (diffs.has(k) || !a || !b) continue;
    const d = difference(pixels(a), pixels(b)), el = document.createElement('canvas');
    el.width = d.width; el.height = d.height; el.className = 'tile';
    /** @type {CanvasRenderingContext2D} */ (el.getContext('2d')).putImageData(new ImageData(/** @type {Uint8ClampedArray<ArrayBuffer>} */ (d.data), d.width, d.height), 0, 0);
    Object.assign(el.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${d.width}px`, height: `${d.height}px` });
    lay.append(el); diffs.set(k, el, pinned);
  }
}

/** Shows what the toggles ask for: the method shown; with Split, A left of the divider and B right of it; with
 * Difference, the difference instead of the layers. Nothing is drawn by the engine here. */
export function show() {
  if (S.diff) differ();
  for (const [id, { pane }] of view.all()) {
    const on = id === 'diff' ? S.diff : !S.diff && (S.split ? id === S.a || id === S.b : id === S.shown);
    pane.hidden = !on;
    const left = `${(S.cut * 100).toFixed(2)}%`, right = `${((1 - S.cut) * 100).toFixed(2)}%`;
    pane.style.clipPath = !on || !S.split || S.diff ? '' : id === S.a ? `inset(0 ${right} 0 0)` : `inset(0 0 0 ${left})`;
  }
}
