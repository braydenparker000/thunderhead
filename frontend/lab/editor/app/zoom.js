// @ts-check
// Zoom on the photo (docs/design/EDITOR.md), wherever a board marks its slot data-zoom: pinch freely from the
// fitted photo to 300 %, drag to look around, double-tap for 100 % and back. While fingers move nothing is
// drawn: the picture on screen is moved and scaled. When they stop, the sensor's pixels are drawn over the
// editing copy (../../engine/full.js): from 100 % up in one pass that then follows every control live; from
// 40 % to 100 %, where more than a screenful of the sensor shows, in a few passes onto a still canvas (a
// control moved there shows the editing copy until it rests). Below 40 % the editing copy is sharp enough.
//
// A board whose one finger is a tool (Masks, Heal) marks its slot data-zoom="tool": there only two fingers zoom
// and move the photo, wherever in the photo's room they land, and whatever the board marks data-zoom-with (what
// it lays over the photo) is moved and scaled with it.
//
// The photo is not inside any board. It lives in one layer of its own (`home`) under the boards, and a board's
// slot is only a window: the layer takes the window's place and glides to the next board's. So changing tool
// neither redraws the photo nor loses where it was zoomed to.
import * as photo from './session.js';
import { tile } from './tiles.js';

/** @typedef {NonNullable<ReturnType<typeof photo.whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
const READBACK = new URLSearchParams(location.search).has('readback'), EASE = 'transform 260ms cubic-bezier(0.2, 0.85, 0.2, 1)';
const make = (/** @type {string} */ tag, /** @type {string} */ css, cls = '') => { const e = document.createElement(tag); e.style.cssText = css; e.className = cls; e.setAttribute('aria-hidden', 'true'); return e; };
const LAYER = 'position: absolute; pointer-events: none; display: none';
const wrap = make('div', 'position: absolute; transform-origin: 0 0; will-change: transform', 'fillphoto');
const over = /** @type {HTMLImageElement} */ (make('img', `${LAYER}; inset: 0; image-rendering: pixelated`));   // the clipping overlay
const still = /** @type {HTMLCanvasElement} */ (make('canvas', LAYER)), live = /** @type {HTMLCanvasElement} */ (make('canvas', LAYER));
const badge = make('span', 'position: absolute; left: 12px; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: none', 'glass');
const map = make('div', 'position: absolute; right: 12px; bottom: 14px; border-radius: 10px; overflow: hidden; padding: 0; display: none', 'glass');
const mapImg = /** @type {HTMLImageElement} */ (make('img', 'width: 100%; height: 100%; display: block; opacity: 0.85')), box = make('span', 'position: absolute; box-shadow: 0 0 0 1.5px #e8202a, 0 0 0 999px rgba(0,0,0,0.35)');
map.append(mapImg, box);

const home = make('div', 'position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; display: none');   // the photo's own layer, under the boards
const slot = home;
let win = /** @type {HTMLElement | null} */ (null), shown = /** @type {unknown} */ (null);   // the board's window on the photo; the photo it shows
let f = { W: 0, H: 0, w: 1, h: 1, ox: 0, oy: 0, fw: 1, fh: 1 };   // the slot, and the photo fitted in it (design pixels); the photo's sensor size
let z = 1, tx = 0, ty = 0, job = 0, timer = 0, tiled = -1;   // the wrap's scale and shift from fitted; the detail being made
let view = /** @type {View | null} */ (null), from = /** @type {Big | null} */ (null), cap = 0, making = /** @type {Promise<View | null> | null} */ (null);

const frame = () => /** @type {HTMLElement} */ (document.getElementById('frame'));
/** Screen pixels in one of the design's (the page's frame is the 412-wide design, scaled to the screen). */
const scale = () => (frame().getBoundingClientRect().width / 412) * devicePixelRatio;
const full = () => f.fw / (f.w * scale());   // the wrap's scale at 100 %: a sensor pixel to a screen pixel
const most = () => Math.max(1, 3 * full());
/** Whether the photo is zoomed, and to what per cent of the sensor's pixels. */
export const info = () => ({ on: z > 1.02, pct: Math.round((z / full()) * 100) });
/** The fitted photo's box in its slot, in design pixels (a board lays its before/after over it). */
export const fitted = () => ({ left: f.ox, top: f.oy, width: f.w, height: f.h });
const tool = () => win?.dataset.zoom === 'tool';
/** Where gestures are heard, and what holds the fingers of a pinch: the page's frame, over photo and boards alike. */
const ear = frame;
/** Whether two fingers are on the photo: a tool board's one-finger tool stands down. */
export const pinching = () => pts.size > 1 || !!g?.two;
/** The photo's shift and scale from fitted, as CSS: for what a tool board lays over it (zoom.js keeps it up to date while fingers move). */
export const transform = () => `translate(${tx}px, ${ty}px) scale(${z})`;
/** How many times its fitted size the photo is shown (a brush keeps its size on screen, so it covers less of a zoomed photo). */
export const mag = () => z;

function hold() {   // the photo keeps covering the slot (or sits in its middle, where smaller)
  const lim = (/** @type {number} */ t, /** @type {number} */ size, /** @type {number} */ room, /** @type {number} */ o) => (size <= room ? (room - size) / 2 - o : Math.max(room - size - o, Math.min(-o, t)));
  tx = lim(tx, f.w * z, f.W, f.ox); ty = lim(ty, f.h * z, f.H, f.oy);
}
function apply(ease = false) {
  wrap.style.transition = ease ? EASE : 'none';
  wrap.style.transform = transform();
  if (tool()) for (const el of /** @type {NodeListOf<HTMLElement>} */ (ear().querySelectorAll('[data-zoom-with]'))) { el.style.transition = wrap.style.transition; el.style.transform = wrap.style.transform; }
  const on = z > 1.02, pct = (/** @type {number} */ v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
  badge.style.display = map.style.display = on ? 'block' : 'none';
  if (!on) return;
  badge.textContent = `${info().pct}%`;
  box.style.left = pct(-(f.ox + tx) / (f.w * z)); box.style.top = pct(-(f.oy + ty) / (f.h * z));
  box.style.width = pct(f.W / (f.w * z)); box.style.height = pct(f.H / (f.h * z));
}
/** To scale `to`, the photo's point under (x, y) of the slot staying there. @param {number} to @param {number} x @param {number} y */
function zoomAt(to, x, y, ease = false) {
  const px = (x - f.ox - tx) / z, py = (y - f.oy - ty) / z;
  z = Math.max(1, Math.min(most(), to)); tx = x - f.ox - px * z; ty = y - f.oy - py * z;
  hold(); apply(ease);
}
function layout() {
  if (!win) return;
  const r = slot.getBoundingClientRect(), s = r.width / (slot.offsetWidth || 1), [fw, fh] = photo.shape(), W = r.width / s, H = r.height / s, k = Math.min(W / fw, H / fh);
  if (!(W > 0 && H > 0)) return;
  const was = `${f.ox},${f.oy},${f.w},${f.h}`;
  f = { W, H, w: fw * k, h: fh * k, ox: (W - fw * k) / 2, oy: (H - fh * k) / 2, fw, fh };
  if (was !== `${f.ox},${f.oy},${f.w},${f.h}`) queueMicrotask(() => photo.events.dispatchEvent(new Event('change')));   // a board lays things over the fitted photo
  Object.assign(wrap.style, { left: `${f.ox}px`, top: `${f.oy}px`, width: `${f.w}px`, height: `${f.h}px` });
  Object.assign(map.style, { width: `${fw >= fh ? 96 : (96 * fw) / fh}px`, height: `${fw >= fh ? (96 * fh) / fw : 96}px` });
  z = Math.min(z, most()); hold(); apply();
}
const watch = new ResizeObserver(() => { layout(); rest(); });
const GLIDE = 'left 320ms cubic-bezier(0.2, 0.85, 0.2, 1), top 320ms cubic-bezier(0.2, 0.85, 0.2, 1), width 320ms cubic-bezier(0.2, 0.85, 0.2, 1), height 320ms cubic-bezier(0.2, 0.85, 0.2, 1)';
let glide = 0;
/** The layer takes its window's place (in the frame's own pixels); with no window on the page it is put away. */
function follow() {
  if (!win?.isConnected) { home.style.display = 'none'; return; }
  const fr = frame().getBoundingClientRect(), r = win.getBoundingClientRect(), k = fr.width / 412 || 1;
  Object.assign(home.style, { display: 'block', left: `${(r.left - fr.left) / k}px`, top: `${(r.top - fr.top) / k}px`, width: `${r.width / k}px`, height: `${r.height / k}px` });
}
const seen = new ResizeObserver(follow);   // the window moves or resizes (a panel opening), or leaves with its board
addEventListener('resize', follow);

/** The session hands over the photo's element for a zoomable slot (and again when the element changes). */
photo.hooks.fill = (s, el) => {
  if (!home.isConnected) {   // once: the layer goes under the boards, and the frame hears the gestures
    const fr = frame(); fr.insertBefore(home, fr.firstChild); home.replaceChildren(wrap, badge, map); watch.observe(home);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) fr.addEventListener(t, (e) => touch(/** @type {PointerEvent} */ (e)));
  }
  if (photo.current() !== shown) { shown = photo.current(); z = 1; tx = ty = 0; job++; hide(); }   // another photo: fitted again
  if (s !== win) {   // another board's window: the layer glides to it, zoomed as it was
    const moved = !!win && home.style.display !== 'none';
    if (win) seen.unobserve(win);
    win = s; seen.observe(s); pts.clear(); g = null;
    const low = s.dataset.zoom !== 'top';
    badge.style.top = low ? '' : '12px'; badge.style.bottom = low ? '14px' : '';
    clearTimeout(glide); home.style.transition = moved ? GLIDE : 'none'; glide = setTimeout(() => { home.style.transition = 'none'; }, 360);
  }
  if (el.parentElement !== wrap) wrap.replaceChildren(el, over, still, live);
  follow(); layout();
};
/** The photo's element went into a board's own slot (Crop, Export): the layer is put away until a window asks again. */
photo.hooks.away = () => { if (win) seen.unobserve(win); win = null; pts.clear(); g = null; home.style.display = 'none'; };
/** The clipping overlay to lay over the photo ('' for none): it zooms with it. @param {string} url */
export function clip(url) { if (over.getAttribute('src') !== url) over.src = url; over.style.display = url ? 'block' : 'none'; if (url) Object.assign(over.style, { width: '100%', height: '100%' }); }

/* Gestures: one finger drags a zoomed photo, two pinch, two quick taps go to 100 % and back. */
const pts = /** @type {Map<number, { x: number, y: number }>} */ (new Map());
let g = /** @type {null | { pinch: boolean, two: boolean, x: number, y: number, tx: number, ty: number, z: number, d: number, far: number }} */ (null), tap = { t: 0, x: 0, y: 0 };
function touch(/** @type {PointerEvent} */ e) {
  if (!win?.isConnected) return;
  // a gesture starts in the photo's window; on a tool board anywhere in the photo's room (the board's own layers lie over the window)
  if (e.type === 'pointerdown' && !(tool() ? win.parentElement : win)?.contains(/** @type {Node} */ (e.target))) return;
  const r = slot.getBoundingClientRect(), s = r.width / f.W, at = { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  const mid = () => { const [a, b = a] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
  const begin = () => { const m = mid(); g = { pinch: pts.size > 1, two: pts.size > 1 || !!g?.two, x: m.x, y: m.y, tx, ty, z, d: m.d, far: g ? 99 : 0 }; };   // two: two fingers were down at some point of this gesture
  if (e.type === 'pointerdown') {
    if (pts.size > 1) return;
    pts.set(e.pointerId, at); begin();
    if (pts.size > 1) for (const id of pts.keys()) ear().setPointerCapture(id);
  } else if (e.type === 'pointermove') {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, at);
    const m = mid();
    g.far = Math.max(g.far, Math.hypot(m.x - g.x, m.y - g.y));
    if (g.pinch) { const px = (g.x - f.ox - g.tx) / g.z, py = (g.y - f.oy - g.ty) / g.z; z = Math.max(1, Math.min(most(), (g.z * m.d) / g.d)); tx = m.x - f.ox - px * z; ty = m.y - f.oy - py * z; }
    else if (!tool() && z > 1.02 && g.far > 6) { if (!ear().hasPointerCapture(e.pointerId)) ear().setPointerCapture(e.pointerId); tx = g.tx + m.x - g.x; ty = g.ty + m.y - g.y; }
    else return;
    hold(); apply();
  } else if (pts.delete(e.pointerId)) {
    if (pts.size) { begin(); return; }   // one finger of a pinch lifted: the other drags on
    const was = g, now = performance.now(); g = null;
    if (tool() && !was?.two) return;   // one finger on a tool board is the board's
    if (was && was.far < 8 && !was.pinch) {   // a tap: the second of two quick ones zooms
      if (now - tap.t < 320 && Math.hypot(at.x - tap.x, at.y - tap.y) < 36) { tap.t = 0; zoomAt(z > 1.02 ? 1 : full(), at.x, at.y, true); settle(300); } else tap = { t: now, x: at.x, y: at.y };
      return;
    }
    const p = z / full();
    if (z < 1.04) zoomAt(1, f.W / 2, f.H / 2, true); else if (Math.abs(p - 1) < 0.07) zoomAt(full(), f.W / 2, f.H / 2, true);   // near fitted or near 100 %: exactly that
    settle(z < 1.04 || Math.abs(p - 1) < 0.07 ? 300 : 60);
  }
}
/** Between fitted and 100 %, about the slot's middle (a board's 100 % key). */
export function toggle() { zoomAt(z > 1.02 ? 1 : full(), f.W / 2, f.H / 2, true); settle(300); }

/* Detail: the sensor's pixels, drawn once the photo rests. */
function hide() { still.style.display = live.style.display = 'none'; tiled = -1; view?.rest(); }
const rest = () => settle(120);
/** The photo has come to rest (or will, in `ms`): tell the boards, and draw what the zoom now needs. @param {number} ms */
function settle(ms) {
  clearTimeout(timer); job++;
  timer = setTimeout(() => { photo.events.dispatchEvent(new Event('change')); detail(job).catch((e) => console.error('zoom detail', e)); }, ms);
}
const ensure = () => (making ||= (async () => {
  const big = photo.whole(), k = scale(), need = Math.ceil(412 * k) + 2;
  if (big !== from) { from = big; view = null; cap = 0; }   // a photo's views go with it (the session's dispose)
  if (!big) return null;
  if (view && cap >= need) return view;
  view?.dispose();
  const v = await big.view(need, Math.ceil(738 * k) + 2, live, READBACK);
  if (photo.whole() !== big) { v.dispose(); return null; }
  v.onframe = (at) => { if (!live.isConnected || z / full() < 0.999) { v.rest(); return; } place(live, at.X, at.Y, at.cw, at.ch); };
  cap = need;
  return (view = v);
})().finally(() => { making = null; }));
/** Lays a detail canvas over the sensor rectangle it holds, in the wrap's own space, and shows it. By a transform
 * from its own pixel size: a laid-out size is rounded to 1/64 pixel, which the wrap's scale would turn into a blur. */
function place(/** @type {HTMLCanvasElement} */ c, /** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ w, /** @type {number} */ h) {
  const q = f.w / f.fw;
  Object.assign(c.style, { left: '0', top: '0', width: `${c.width}px`, height: `${c.height}px`, transformOrigin: '0 0', transform: `translate(${X * q}px, ${Y * q}px) scale(${(w * q) / c.width}, ${(h * q) / c.height})`, display: 'block' });
}
async function detail(/** @type {number} */ mine) {
  mapImg.src = z > 1.02 ? tile(`map:${photo.stamp()}`, null, 192, {}, true) || photo.jpeg() : '';
  const p = z / full(), k = scale(), q = f.fw / (f.w * z);   // sensor pixels to a design pixel, as shown
  if (!win?.isConnected || p < 0.4 || !photo.whole()) { hide(); return; }
  const v = await ensure();
  if (mine !== job || !v || !win) return;
  const X = Math.max(0, Math.floor(-(f.ox + tx) * q)), Y = Math.max(0, Math.floor(-(f.oy + ty) * q));
  const X1 = Math.min(f.fw, Math.ceil((f.W - f.ox - tx) * q)), Y1 = Math.min(f.fh, Math.ceil((f.H - f.oy - ty) * q));
  if (p >= 0.999) {   // one pass, and it follows the engine's frames from here
    const r = slot.getBoundingClientRect(), dx = r.left * devicePixelRatio + (f.ox + tx) * k, dy = r.top * devicePixelRatio + (f.oy + ty) * k;
    if (Math.abs(p - 1) < 0.001) { tx += (Math.round(dx) - dx) / k; ty += (Math.round(dy) - dy) / k; apply(); }   // at 100 % exactly, on whole screen pixels
    const [rw, rh] = v.room(), w = Math.min(X1 - X + 2, rw), h = Math.min(Y1 - Y + 2, rh);   // strongly straightened, the view holds less than a screenful: its middle
    v.place(X - 1 + (X1 - X + 2 - w) / 2, Y - 1 + (Y1 - Y + 2 - h) / 2, w, h);
    await photo.frame();
    if (mine === job) { still.style.display = 'none'; tiled = -1; }
    return;
  }
  // 40 % to 100 %: more than the view holds, so a tile at a time onto the still canvas
  const w = Math.round((X1 - X) * p), h = Math.round((Y1 - Y) * p), ctx = /** @type {CanvasRenderingContext2D} */ (still.getContext('2d')), at0 = v.at(), LAP = 8;
  const tw = Math.min(Math.ceil(412 * k), v.room()[0]) - LAP, th = Math.min(Math.ceil(600 * k), v.room()[1]) - LAP, stamp = photo.stamp();
  live.style.display = 'none'; still.style.display = 'none'; still.width = w; still.height = h; ctx.imageSmoothingQuality = 'high';
  for (let y = Y; y < Y1; y += th) for (let x = X; x < X1; x += tw) {
    let im = /** @type {ImageData | null} */ (null), at = at0;
    await photo.alone(async () => { if (mine !== job) return; await photo.settle(); at = await v.region(x, y, Math.min(tw + LAP, X1 - x), Math.min(th + LAP, Y1 - y)); im = await v.read(); v.rest(); });
    if (mine !== job || !im || !at) return;
    const bm = await createImageBitmap(im);
    ctx.drawImage(bm, (at.X - X) * p, (at.Y - Y) * p, at.cw * p, at.ch * p); bm.close();
  }
  if (mine !== job) return;
  place(still, X, Y, X1 - X, Y1 - Y); tiled = stamp;
}
// an edit while the still canvas shows: it is of the photo as it was, so the editing copy shows until the control rests
photo.events.addEventListener('change', () => { if (tiled >= 0 && tiled !== photo.stamp()) { still.style.display = 'none'; tiled = -1; settle(350); } });
// the sensor's pixels reach the GPU a little after a photo opens: a photo already zoomed by then gets its detail now
let had = /** @type {unknown} */ (null);
photo.events.addEventListener('change', () => { const big = photo.whole(); if (big === had) return; had = big; if (big && win?.isConnected && z / full() >= 0.4) settle(60); });
