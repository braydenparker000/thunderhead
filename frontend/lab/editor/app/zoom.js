// @ts-check
// Zoom on the photo (docs/design/EDITOR.md), wherever a board marks its slot data-zoom: pinch freely from the
// fitted photo to 300 %, drag to look around, double-tap for 100 % and back. While fingers move nothing is
// drawn: the picture on screen is moved and scaled. When they stop, the sensor's pixels are drawn over the
// editing copy (../../engine/full.js): from a third of the sensor's size, where the copy would be stretched, a tile at a
// time onto a still canvas, and from 100 % in one pass, then Starfish's (the owner, 2026-11-16). A control moved, or the
// photo moved, shows the copy until it rests: a layer only shows for the edit and the place it was made for.
//
// A board whose one finger is a tool (Masks, Heal) marks its slot data-zoom="tool": there only two fingers zoom and move the
// photo, wherever in the photo's room they land, and whatever the board marks data-zoom-with (what it lays over the photo) is
// moved and scaled with it. A one-finger pan let go while moving glides on and eases to rest (fling.js); two fingers tapped
// undo a step and three redo one (taps.js).
//
// The photo is not inside any board. It lives in one layer of its own (`home`) under the boards, and a board's
// slot is only a window: the layer takes the window's place and glides to the next board's. So changing tool
// neither redraws the photo nor loses where it was zoomed to.
import { pref, prefOn } from '/th/pref.js';
import * as photo from './session.js';
import { tile } from './tiles.js';
import { note } from './timings.js';
import { fling, gliding, halt, heard, speed, trail } from './fling.js';
import { hear } from './taps.js';
import { tell } from './told.js';
import { moved } from './moved.js';
import { flip, flying } from './flip.js';
import { badgeLines } from './zoom-note.js';
import { forget, tiles } from './zoom-tiles.js';
import { doing, hold as claim, making as loading } from '../../engine/work.js';
import { room } from '../../engine/gpu-memory.js';
import { level, share, went } from '../../engine/gentle.js';
import { starfish, viewMem } from './zoom-fine.js';
/** @typedef {NonNullable<ReturnType<typeof photo.whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
const READBACK = new URLSearchParams(location.search).has('readback'), EASE = 'transform 260ms cubic-bezier(0.2, 0.85, 0.2, 1)';
const make = (/** @type {string} */ tag, /** @type {string} */ css, cls = '') => { const e = document.createElement(tag); e.style.cssText = css; e.className = cls; e.setAttribute('aria-hidden', 'true'); return e; };
const LAYER = 'position: absolute; pointer-events: none; display: none';
const wrap = make('div', 'position: absolute; transform-origin: 0 0; will-change: transform', 'fillphoto');
const over = /** @type {HTMLImageElement} */ (make('img', `${LAYER}; inset: 0; image-rendering: pixelated`));   // the clipping overlay
const still = /** @type {HTMLCanvasElement} */ (make('canvas', LAYER, 'zl')), live = /** @type {HTMLCanvasElement} */ (make('canvas', LAYER, 'zl'));   // zl: fades in, crisp pixels from 200 % (editor.css)
const closer = /** @type {HTMLCanvasElement} */ (make('canvas', LAYER, 'zl'));   // from 100 %: what shows, made by the network once the photo rests (`finer`)
const badge = make('span', 'position: absolute; left: 12px; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: none', 'glass'), pctEl = badgeLines(badge, () => { badge.style.display = z > 1.02 || loading() ? 'block' : 'none'; });
const map = make('div', 'position: absolute; right: 12px; bottom: 14px; border-radius: 10px; overflow: hidden; padding: 0; display: none; background: rgba(16,18,20,0.88); border: 1px solid rgba(255,255,255,0.22); box-shadow: 0 10px 24px rgba(0,0,0,0.55)');
const mapImg = /** @type {HTMLImageElement} */ (make('img', 'width: 100%; height: 100%; display: block; opacity: 0.85')), box = make('span', 'position: absolute; box-shadow: 0 0 0 1.5px #e8202a, 0 0 0 999px rgba(0,0,0,0.35)');
map.append(mapImg, box);
const home = make('div', 'position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; display: none');   // the photo's own layer, under the boards
const slot = home;
let win = /** @type {HTMLElement | null} */ (null), shown = /** @type {unknown} */ (null);   // the board's window on the photo; the photo it shows
let f = { W: 0, H: 0, w: 1, h: 1, ox: 0, oy: 0, fw: 1, fh: 1 };   // the slot, and the photo fitted in it (design pixels); the photo's sensor size
let z = 1, tx = 0, ty = 0, job = 0, timer = 0, madeFor = -1, fingers = /** @type {null | (() => void)} */ (null);   // the wrap's scale and shift from fitted; the detail being made; the edit its layers show (photo.stamp); a finger's hold on the GPU
let view = /** @type {View | null} */ (null), from = /** @type {Big | null} */ (null), cap = 0, making = /** @type {Promise<View | null> | null} */ (null);

const frame = () => /** @type {HTMLElement} */ (document.getElementById('frame') || document.getElementById('stage')?.parentElement);
/** Screen pixels in one of the design's (the page's frame is the 412-wide design, scaled to the screen). */
const scale = () => (frame().getBoundingClientRect().width / 412) * devicePixelRatio;
const full = () => f.fw / (f.w * scale());   // the wrap's scale at 100 %: a sensor pixel to a screen pixel
const most = () => Math.max(1, 3 * full());
/** Where a double-tap goes: 100 %, or 200 % with the owner's setting (Settings › Photos › Editor). */
const tapTo = () => Math.min(most(), full() * (pref('photos.double_tap') === '200' ? 2 : 1));
/** Whether the photo is zoomed, and to what per cent of the sensor's pixels. */
export const info = () => ({ on: z > 1.02, pct: Math.round((z / full()) * 100), making: making2 > 0, rest: !timer && !loading() });   // making: a full-size view is being made; rest: nothing waits to be drawn, nothing is being made
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

const lim = (/** @type {number} */ t, /** @type {number} */ size, /** @type {number} */ room, /** @type {number} */ o) => (size <= room ? (room - size) / 2 - o : Math.max(room - size - o, Math.min(-o, t)));
/** The nearest shift to (x, y) at which the photo keeps covering the slot (or sits in its middle, where smaller). @param {number} x @param {number} y */
const inside = (x, y) => [lim(x, f.w * z, f.W, f.ox), lim(y, f.h * z, f.H, f.oy)];
function hold() { [tx, ty] = inside(tx, ty); }
function apply(ease = false) {
  wrap.style.transition = ease ? EASE : 'none';
  wrap.style.transform = transform();
  if (tool()) for (const el of /** @type {NodeListOf<HTMLElement>} */ (ear().querySelectorAll('[data-zoom-with]'))) { el.style.transition = wrap.style.transition; el.style.transform = wrap.style.transform; }
  const on = z > 1.02, pct = (/** @type {number} */ v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`; if (madeFor >= 0 && z / full() < THIRD) hide();   // under a third the copy is the picture: no layer of the sensor's lingers
  map.style.display = on ? 'block' : 'none'; badge.style.display = on || loading() ? 'block' : 'none'; photo.atFit(!on); wrap.toggleAttribute('data-px', on && z / full() >= 2);
  if (!on) return;
  pctEl.textContent = `${info().pct}%`;
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
  halt();
  const r = slot.getBoundingClientRect(), s = r.width / (slot.offsetWidth || 1), [fw, fh] = photo.shape(), W = r.width / s, H = r.height / s, k = Math.min(W / fw, H / fh);
  if (!(W > 0 && H > 0)) return;
  const was = `${f.ox},${f.oy},${f.w},${f.h}`, o = f;
  f = { W, H, w: fw * k, h: fh * k, ox: (W - fw * k) / 2, oy: (H - fh * k) / 2, fw, fh };
  if (z > 1.02 && o.fw === fw && o.fh === fh && o.w > 1 && (o.w !== f.w || o.W !== W || o.H !== H)) {
    // the room changed under a zoomed photo (another board's window, a panel growing): it keeps its size on screen, and what was at the room's middle stays there
    const px = (o.W / 2 - o.ox - tx) / (o.w * z), py = (o.H / 2 - o.oy - ty) / (o.h * z);
    z = Math.max(1, (z * o.w) / f.w); tx = W / 2 - f.ox - px * f.w * z; ty = H / 2 - f.oy - py * f.h * z;
  }
  if (was !== `${f.ox},${f.oy},${f.w},${f.h}`) refit();   // a board lays things over the fitted photo
  Object.assign(wrap.style, { left: `${f.ox}px`, top: `${f.oy}px`, width: `${f.w}px`, height: `${f.h}px` });
  Object.assign(map.style, { width: `${fw >= fh ? 96 : (96 * fw) / fh}px`, height: `${fw >= fh ? (96 * fh) / fw : 96}px` });
  z = Math.min(z, most()); hold(); apply();
}
const watch = new ResizeObserver(() => { layout(); rest(); });
// The fit changed: the boards are told at once, and once more when it has stopped changing (not at every frame of a panel's growing: each redraws the board, 2026-11-18)
let fits = 0, hides = 0, quiet = 0, owed = false; const told = () => photo.events.dispatchEvent(new Event('change'));
function refit() { fits++; if (quiet) { owed = true; clearTimeout(quiet); } else queueMicrotask(told); quiet = setTimeout(() => { quiet = 0; if (owed) { owed = false; told(); } }, 90); }
/** How often the fit has changed and a made detail been put away since the page opened (noted for a swipe: boards/Barrel.js). */ export const counts = () => ({ fits, hides });
let glide = 0; const GLIDE = 'left 320ms cubic-bezier(0.2, 0.85, 0.2, 1), top 320ms cubic-bezier(0.2, 0.85, 0.2, 1), width 320ms cubic-bezier(0.2, 0.85, 0.2, 1), height 320ms cubic-bezier(0.2, 0.85, 0.2, 1)';
/** The layer takes its window's place (in the frame's own pixels); with no window on the page it is put away. */
function follow() {
  if (!win?.isConnected) { home.style.display = 'none'; return; }
  const fr = frame().getBoundingClientRect(), r = win.getBoundingClientRect(), k = fr.width / 412 || 1, to = { left: `${(r.left - fr.left) / k}px`, top: `${(r.top - fr.top) / k}px`, width: `${r.width / k}px`, height: `${r.height / k}px` };
  // shown, and its window moved or resized (another board's, or one whose panel settled after it showed): the photo glides there, never jumps
  const moves = home.style.display === 'block' && Object.entries(to).some(([p, v]) => home.style.getPropertyValue(p) !== v), before = wrap.getBoundingClientRect(); if (moves && z > 1.02 && !matchMedia('(prefers-reduced-motion: reduce)').matches) { clearTimeout(glide); home.style.transition = GLIDE; glide = setTimeout(() => { home.style.transition = 'none'; }, 360); }   // zoomed: its window's edges glide
  Object.assign(home.style, { display: 'block', ...to });
  if (moves && z <= 1.02) { layout(); flip(wrap, before, transform(), k, tx, ty, home); }   // fitted: by its transform alone (flip.js)
  wrap.style.filter = win.style.filter || 'none';   // what a board lays on its window (Heal's Visualize) is laid on the photo
}
const seen = new ResizeObserver(follow);   // the window moves or resizes (a panel opening), or leaves with its board
const styled = new MutationObserver(follow);   // or its board gives it another style
addEventListener('resize', follow);

/** The session hands over the photo's element for a zoomable slot (and again when the element changes). */
photo.hooks.fill = (s, el) => {
  if (!home.isConnected) {   // once: the layer goes under the boards, and the frame hears the gestures
    const fr = frame(); fr.insertBefore(home, fr.firstChild); home.replaceChildren(wrap, badge, map); watch.observe(home);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) fr.addEventListener(t, (e) => touch(/** @type {PointerEvent} */ (e)));
  }
  if (photo.current() !== shown) { shown = photo.current(); z = 1; tx = ty = 0; job++; hide(); forget(); }   // another photo: fitted again, its kept tiles let go
  if (s !== win) {   // another board's window: the layer glides to it, zoomed as it was
    if (win) seen.unobserve(win);
    win = s; seen.observe(s); styled.disconnect(); styled.observe(s, { attributes: true, attributeFilter: ['style'] }); pts.clear(); g = null;
    const low = s.dataset.zoom !== 'top';
    badge.style.top = low ? '' : '12px'; badge.style.bottom = low ? '14px' : '';
  }
  if (el.parentElement !== wrap) wrap.replaceChildren(el, over, still, live, closer);
  follow(); layout();
};
/** The photo's element went into a board's own slot (Crop, Export): the layer is put away until a window asks again. */
photo.hooks.away = () => { halt(); if (win) seen.unobserve(win); styled.disconnect(); wrap.style.filter = 'none'; win = null; pts.clear(); g = null; home.style.display = 'none'; };
/** The clipping overlay to lay over the photo ('' for none): it zooms with it. @param {string} url */
export function clip(url) { if (over.getAttribute('src') !== url) over.src = url; over.style.display = url ? 'block' : 'none'; if (url) Object.assign(over.style, { width: '100%', height: '100%' }); }

/* Gestures: one finger drags a zoomed photo, two pinch, two quick taps go to 100 % and back. */
const pts = /** @type {Map<number, { x: number, y: number }>} */ (new Map());
let g = /** @type {null | { pinch: boolean, two: boolean, x: number, y: number, tx: number, ty: number, z: number, d: number, far: number }} */ (null), tap = { t: 0, x: 0, y: 0 }, box0 = /** @type {null | { left: number, top: number, s: number }} */ (null);
function touch(/** @type {PointerEvent} */ e) {
  if (!win?.isConnected) return;
  // a gesture starts in the photo's window; on a tool board anywhere in the photo's room (the board's own layers lie over the window)
  const mine = !!(tool() ? win.parentElement : win)?.contains(/** @type {Node} */ (e.target));
  hear(e, mine);
  if (e.type === 'pointerdown' && halt()) { hold(); apply(); settle(60); }   // a touch stops a glide where it is
  if (e.type === 'pointerdown' && !mine) return;
  if (e.type === 'pointerdown' || !box0) { const r = slot.getBoundingClientRect(); box0 = { left: r.left, top: r.top, s: r.width / f.W || 1 }; }
  const at = { x: (e.clientX - box0.left) / box0.s, y: (e.clientY - box0.top) / box0.s };
  const mid = () => { const [a, b = a] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
  const begin = () => { const m = mid(); g = { pinch: pts.size > 1, two: pts.size > 1 || !!g?.two, x: m.x, y: m.y, tx, ty, z, d: m.d, far: g ? 99 : 0 }; trail.length = 0; };   // two: two fingers were down at some point of this gesture
  if (e.type === 'pointerdown') {
    if (pts.size > 1) return;
    pts.set(e.pointerId, at); begin(); moved(() => !!g || gliding(), making2 > 0); fingers ||= claim();   // (work that can wait waits for the finger: engine/work.js)
    if (pts.size > 1) for (const id of pts.keys()) ear().setPointerCapture(id);
  } else if (e.type === 'pointermove') {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, at);
    const m = mid();
    g.far = Math.max(g.far, Math.hypot(m.x - g.x, m.y - g.y));
    if (g.pinch) { const px = (g.x - f.ox - g.tx) / g.z, py = (g.y - f.oy - g.ty) / g.z; z = Math.max(1, Math.min(most(), (g.z * m.d) / g.d)); tx = m.x - f.ox - px * z; ty = m.y - f.oy - py * z; }
    else if (!tool() && z > 1.02 && g.far > 6) { if (!ear().hasPointerCapture(e.pointerId)) ear().setPointerCapture(e.pointerId); tx = g.tx + m.x - g.x; ty = g.ty + m.y - g.y; heard(e.timeStamp, m.x, m.y); }
    else return;
    hold(); apply();
  } else if (pts.delete(e.pointerId)) {
    if (pts.size) { begin(); return; } fingers?.(); fingers = null;   // one finger of a pinch lifted: the other drags on
    const was = g, now = e.timeStamp; g = null;   // when the finger lifted, not when the page got round to it: a busy moment must not turn a double tap into two taps
    if (tool() && !was?.two) return;   // one finger on a tool board is the board's
    if (was && was.far < 8 && !was.pinch) {   // a tap: the second of two quick ones zooms
      const u = (at.x - f.ox - tx) / (f.w * z), v = (at.y - f.oy - ty) / (f.h * z);   // where on the picture, in shares of it
      if (photo.armed()) { if (u >= 0 && u <= 1 && v >= 0 && v <= 1) photo.pickAt(u, v); tap.t = 0; return; }   // the eyedropper's tap (adjust.js)
      if (now - tap.t < 320 && Math.hypot(at.x - tap.x, at.y - tap.y) < 36) { tap.t = 0; zoomAt(z > 1.02 ? 1 : tapTo(), at.x, at.y, true); settle(300); } else tap = { t: now, x: at.x, y: at.y };
      return;
    }
    if (was && !was.two && !tool() && z > 1.02 && launch(e.timeStamp)) return;   // let go while moving: it glides on
    const p = z / full();
    if (z < 1.04) zoomAt(1, f.W / 2, f.H / 2, true); else if (Math.abs(p - 1) < 0.07) zoomAt(full(), f.W / 2, f.H / 2, true);   // near fitted or near 100 %: exactly that
    settle(z < 1.04 || Math.abs(p - 1) < 0.07 ? 300 : 60);
  }
}
/** A one-finger pan let go while moving glides on (fling.js), and the detail is made where it rests. @param {number} now */
function launch(now) {
  const v = speed(now);
  if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  clearTimeout(timer); timer = 0; job++;   // no detail is made for where it was let go
  fling({ x: tx, y: ty, vx: f.w * z > f.W ? v[0] : 0, vy: f.h * z > f.H ? v[1] : 0, inside, show: (x, y) => { tx = x; ty = y; apply(); }, rest: () => settle(60) });
  return true;
}
/** Between fitted and 100 %, about the slot's middle (a board's 100 % key). */
export function toggle() { zoomAt(z > 1.02 ? 1 : full(), f.W / 2, f.H / 2, true); settle(300); }

/* Detail: the sensor's pixels, drawn once the photo rests. */
function hide() { if (madeFor >= 0) hides++; still.style.display = live.style.display = closer.style.display = 'none'; madeFor = -1; view?.rest(); }
const rest = () => settle(120);
/** The photo has come to rest (or will, in `ms`): tell the boards, and draw what the zoom now needs. @param {number} ms */
function settle(ms) {
  clearTimeout(timer); job++;
  timer = setTimeout(() => {
    timer = 0; const st = photo.stamp();
    if (st !== edited) { edited = st; heldAt = performance.now(); if (madeFor >= 0 && madeFor !== st) hide(); settle(REST); return; }   // an edit since it was asked for (its frame may begin after its news): REST more
    if ((g && !tool()) || gliding() || flying() || dialing() || photo.busy()) { settle(ms); return; }   // fingers still move the photo, it glides, the dial turns or an edit's frame is drawn: once it rests
    photo.events.dispatchEvent(new Event('change'));
    const mine = job, began = performance.now(), sharp = z / full() >= THIRD && !!photo.whole();   // (the badge's dot beats while they are made: zoom-note.js)
    detail(mine).catch((e) => console.error('zoom detail', e)).then(() => { if (mine !== job) return; if (sharp) { photo.took.detail = (performance.now() - began) / 1000; note('detail', photo.took.detail * 1000); photo.events.dispatchEvent(new Event('change')); } });
  }, ms);
}
const ensure = () => (making ||= (async () => {
  const big = photo.whole(), k = scale(), need = Math.ceil(412 * k) + 2;
  if (big !== from) { from = big; view = null; cap = 0; }   // a photo's views go with it (the session's dispose)
  if (!big) return null;
  if (view && cap >= need) return view;
  view?.dispose(); if (!room(viewMem(need, Math.ceil(738 * k) + 2))) letFine();   // Starfish's view goes first where both would not fit (gpu-memory.js)
  const v = await big.view(need, Math.ceil(738 * k) + 2, live, READBACK);
  if (photo.whole() !== big) { v.dispose(); return null; }
  v.onframe = (at) => { if (!own || !live.isConnected || z / full() < 0.999) { v.rest(); live.style.display = 'none'; return; } place(live, at.X, at.Y, at.cw, at.ch); };   // only the detail's own frame: an edit's shows the copy
  cap = need;
  return (view = v);
})().finally(() => { making = null; }));
/** Lays a detail canvas over the sensor rectangle it holds, in the wrap's own space, and shows it. By a transform
 * from its own pixel size: a laid-out size is rounded to 1/64 pixel, which the wrap's scale would turn into a blur. */
function place(/** @type {HTMLCanvasElement} */ c, /** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ w, /** @type {number} */ h) {
  const q = f.w / f.fw;
  Object.assign(c.style, { left: '0', top: '0', width: `${c.width}px`, height: `${c.height}px`, transformOrigin: '0 0', transform: `translate(${X * q}px, ${Y * q}px) scale(${(w * q) / c.width}, ${(h * q) / c.height})`, display: 'block' });
}
let own = false;   // a frame the detail asked for itself
/** A full-size view is made for the screen a part at a time (engine/full.js `region`) and left undone the moment fingers move the photo, it glides, a newer job has begun or an edit's frame waits; `took` gathers each part's time. */
let making2 = 0; const pace = (/** @type {number} */ mine, /** @type {number[]} */ took) => ({ stop: () => mine !== job || (!!g && !tool()) || gliding() || dialing() || photo.wanted(), note: (/** @type {number} */ ms) => { took.push(ms); performance.mark('th:part'); } });
const parts = (/** @type {number[]} */ took) => (took.length ? { parts: took.length, part: Math.round(Math.max(...took)) } : {});
const again1 = (/** @type {number} */ mine) => { if (mine === job && !g && !gliding()) settle(400); };   // a view left for an edit's waiting frame (no finger, no newer job) is made again once the frames stop
const sf = starfish({ closer, place, pace, parts, again: again1, drop: () => { view?.dispose(); view = null; cap = 0; }, busy: (n) => { making2 += n; } }), letFine = sf.letFine;   // Starfish's view (zoom-fine.js)
const FINE = 0.999, THIRD = 0.37;   // from 100 % the network makes what shows (the owner, 2026-11-12, having compared them: the network is best); under a third of the sensor's size the copy has the screen's pixels already, and a little over it is stretched under a tenth, which does not show (no tiles made for that)
async function detail(/** @type {number} */ mine) {
  if (z > 1.02) performance.mark('th:map'); mapImg.src = z > 1.02 ? tile(`map:${photo.stamp()}`, null, 192, {}, true) || photo.jpeg() : '';
  const p = z / full(), k = scale(), q = f.fw / (f.w * z), stamp = photo.stamp();   // sensor pixels to a design pixel, as shown
  if (!win?.isConnected || p < THIRD || !photo.whole()) { hide(); return; }   // to a third of the sensor's size the copy has the screen's pixels already
  const done = doing('Loading full detail');
  try {
    const v = await ensure();
    if (mine !== job || !v || !win) return;
    const X = Math.max(0, Math.floor(-(f.ox + tx) * q)), Y = Math.max(0, Math.floor(-(f.oy + ty) * q));
    const X1 = Math.min(f.fw, Math.ceil((f.W - f.ox - tx) * q)), Y1 = Math.min(f.fh, Math.ceil((f.H - f.oy - ty) * q));
    const gentle = level('detail') > 0, fin = async () => {   // then Starfish's, from 100 %, the badge naming it (managed inside zoom-fine.js)
      if (!(p >= FINE && prefOn('photos.neural', true))) { closer.style.display = 'none'; return; }
      try { await sf.finer(mine, () => mine === job, X - 1, Y - 1, X1 - X + 2, Y1 - Y + 2); } catch (e) { console.warn('zoom network', e); }
    };
    if (p >= 0.999 && !gentle) {   // one pass, then Starfish's, however long it takes (the owner: no cap), the full detail showing meanwhile
      const r = slot.getBoundingClientRect(), dx = r.left * devicePixelRatio + (f.ox + tx) * k, dy = r.top * devicePixelRatio + (f.oy + ty) * k;
      if (Math.abs(p - 1) < 0.001) { tx += (Math.round(dx) - dx) / k; ty += (Math.round(dy) - dy) / k; apply(); }   // at 100 % exactly, on whole screen pixels
      const [rw, rh] = v.room(), w = Math.min(X1 - X + 2, rw), h = Math.min(Y1 - Y + 2, rh);   // strongly straightened, the view holds less than a screenful: its middle
      v.place(X - 1 + (X1 - X + 2 - w) / 2, Y - 1 + (Y1 - Y + 2 - h) / 2, w, h);
      // its colours are made first, a part at a time, and left if a finger comes down; the frame that follows only lays them out
      let ok = false; own = true; making2++; try { await photo.alone(async () => { ok = mine === job && !!(await v.region(X - 1 + (X1 - X + 2 - w) / 2, Y - 1 + (Y1 - Y + 2 - h) / 2, w, h, null, pace(mine, []))); }); if (ok) await photo.frame(); } finally { own = false; making2--; }
      if (!ok) { if (mine !== job || g || gliding()) note('detail', 0, { left: 1 }); again1(mine); return; }
      if (mine !== job) return;
      still.style.display = 'none'; madeFor = stamp; went('detail'); done();
      await fin();
      return;
    }
    // a third to 100 %: more than the view holds, so a tile at a time onto the still canvas, tiles made before at this scale for this edit taken as kept;
    // from 100 % too on a phone whose chip reset making the full detail (gentle.js), in tiles a share of the usual, at the sensor's own scale
    const sc = Math.min(p, 1), w = Math.round((X1 - X) * sc), h = Math.round((Y1 - Y) * sc), ctx = /** @type {CanvasRenderingContext2D} */ (still.getContext('2d', photo.space)), s = gentle ? Math.sqrt(share('detail')) : 1;
    const tw = Math.max(64, Math.round((Math.min(Math.ceil(412 * k), v.room()[0]) - 8) * s)), th = Math.max(64, Math.round((Math.min(Math.ceil(600 * k), v.room()[1]) - 8) * s));
    live.style.display = closer.style.display = still.style.display = 'none'; still.width = w; still.height = h; ctx.imageSmoothingQuality = 'high';
    const ok = await tiles({ ctx, X, Y, X1, Y1, p: sc, tw, th, key: `${stamp}|${sc.toFixed(4)}|${tw}`, mine: () => mine === job, make: async (x, y, mw, mh) => {
      let made = /** @type {{ im: ImageData, X: number, Y: number } | null} */ (null);
      await photo.alone(async () => { if (mine !== job) return; performance.mark('th:tile'); await photo.settle(); const at = await v.region(x, y, Math.min(mw, f.fw - x), Math.min(mh, f.fh - y), null, pace(mine, [])); const im = at && (await v.read()); v.rest(); if (im && at) made = { im, X: at.X, Y: at.Y }; });
      return made;
    } });
    if (!ok) { again1(mine); return; }
    if (mine !== job) return;
    place(still, X, Y, X1 - X, Y1 - Y); madeFor = stamp; went('detail'); done();
    if (p >= 0.999) await fin();
  } finally { done(); }
}
// An edit while a layer shows, or where one would be made: the layer is of the photo as it was, so the copy shows, and the full detail is made REST ms
// after the last edit, the dial at rest (the owner, 2026-11-17: "when the dial stops", not when the finger lifts and it coasts on). Every edit puts it
// off again (once the edit's frame has begun: an edit is told before it is drawn); news the zoom gives the boards itself is no edit (the stamp is the same).
const REST = 150; let edited = -1, held = false, heldAt = 0;
const dialing = () => held && performance.now() - heldAt < 3000;   // (a dial held still 3 s, or one taken away while it ran on, holds nothing up)
photo.events.addEventListener('change', () => queueMicrotask(() => { const s = photo.stamp(); if (s === edited) return; edited = s; heldAt = performance.now(); if (madeFor !== s && (madeFor >= 0 || z / full() >= THIRD)) { hide(); settle(REST); } }));
/** The dial is held or runs on, or the panel slides (true), or it has come to rest (false): boards/DialPlate.js, boards/Barrel.js. @param {boolean} on */
export function dial(on) { held = on; heldAt = performance.now(); if (!on && timer) settle(REST); }

// the sensor's pixels reach the GPU a little after a photo opens: a photo already zoomed by then gets its detail now
let had = /** @type {unknown} */ (null);
photo.events.addEventListener('change', () => { const big = photo.whole(); if (big === had) return; had = big; if (big && win?.isConnected) settle(60); });
