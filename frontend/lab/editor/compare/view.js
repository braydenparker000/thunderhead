// @ts-check
// Where the photo shows on the compare page, and the fingers on it. Each method is a pane the size of the viewport
// (a split clips the panes in the viewport's own pixels) holding a layer: one photo pixel is one CSS pixel inside a
// layer, and every layer wears the same transform, so zoom 1 puts one photo pixel on one pixel of the screen.
// Moving and zooming only change that transform: nothing is drawn again. One finger drags, two pinch from
// 100 % to 300 %, a tap flips between the two methods, a double tap goes to 300 % and back about the finger.
import { S } from './state.js';

const MIN = 1, MAX = 3;
let vp = /** @type {HTMLElement | null} */ (null), z = 1, tx = 0, ty = 0;
const panes = /** @type {Map<string, { pane: HTMLElement, layer: HTMLElement }>} */ (new Map());
let moved = () => {}, tapped = () => {};

const scale = () => z / devicePixelRatio;   // CSS pixels per photo pixel
const box = () => { const r = /** @type {HTMLElement} */ (vp).getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; };

/** The photo keeps covering the viewport (or sits in its middle, where smaller). */
function hold() {
  const { w, h } = box(), s = scale();
  const lim = (/** @type {number} */ t, /** @type {number} */ size, /** @type {number} */ room) => (size <= room ? (room - size) / 2 : Math.max(room - size, Math.min(0, t)));
  tx = lim(tx, S.W * s, w); ty = lim(ty, S.H * s, h);
}
/** Every layer wears the transform; a zoomed-in photo shows its pixels as squares rather than blurred. */
function apply() {
  const t = `translate(${tx}px, ${ty}px) scale(${scale()})`;
  for (const { layer } of panes.values()) { layer.style.transform = t; layer.classList.toggle('sharp', z > 1.001); }
}

/** Sets the viewport up for a photo, at 100 % about its middle. @param {HTMLElement} el
 * @param {() => void} onMove after the view moved or zoomed @param {() => void} onTap a tap on the photo */
export function mount(el, onMove, onTap) {
  vp = el; moved = onMove; tapped = onTap; z = 1;
  const { w, h } = box(), s = scale(); tx = (w - S.W * s) / 2; ty = (h - S.H * s) / 2;
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => touch(/** @type {PointerEvent} */ (e)));
  addEventListener('resize', () => { hold(); apply(); moved(); });
  hold(); apply();
}

/** A method's pane and layer, made the first time. @param {string} id */
export function layer(id) {
  let p = panes.get(id);
  if (!p) {
    const pane = document.createElement('div'), lay = document.createElement('div');
    pane.className = 'pane'; pane.dataset.method = id; lay.className = 'layer';
    lay.style.width = `${S.W}px`; lay.style.height = `${S.H}px`;
    pane.append(lay); /** @type {HTMLElement} */ (vp).append(pane);
    p = { pane, layer: lay }; panes.set(id, p); apply();
  }
  return p;
}
/** Every pane, by method (and 'diff' for the difference's). */
export const all = () => panes;

/** The rectangle of the photo the viewport shows, in photo pixels. */
export function rect() { const { w, h } = box(), s = scale(); return { x: -tx / s, y: -ty / s, w: w / s, h: h / s }; }
/** The zoom: 1 is one photo pixel on one screen pixel. */
export const zoom = () => z;
/** The middle of the view, as fractions 0..1 of the photo. */
export function centre() {
  const r = rect(), clamp = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
  return { x: clamp((r.x + r.w / 2) / (S.W || 1)), y: clamp((r.y + r.h / 2) / (S.H || 1)) };
}
/** To zoom `to`, the photo's point under (x, y) of the viewport (its middle when not given) staying there.
 * @param {number} to @param {number} [x] @param {number} [y] */
export function zoomTo(to, x, y) {
  const { w, h } = box(), s = scale(), cx = x ?? w / 2, cy = y ?? h / 2, px = (cx - tx) / s, py = (cy - ty) / s;
  z = Math.max(MIN, Math.min(MAX, to));
  tx = cx - px * scale(); ty = cy - py * scale();
  hold(); apply(); moved();
}

/* Fingers: one drags, two pinch; a tap flips, two quick taps zoom. */
const pts = /** @type {Map<number, { x: number, y: number }>} */ (new Map());
let g = /** @type {null | { x: number, y: number, d: number, tx: number, ty: number, z: number, far: number, two: boolean }} */ (null), last = { t: 0, x: 0, y: 0 };
function mid() { const [a, b = a] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; }
function begin() { const m = mid(); g = { x: m.x, y: m.y, d: m.d, tx, ty, z, far: g?.far || 0, two: pts.size > 1 || !!g?.two }; }
function touch(/** @type {PointerEvent} */ e) {
  const r = box(), at = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (e.type === 'pointerdown') {
    if (pts.size > 1) return;
    pts.set(e.pointerId, at); /** @type {HTMLElement} */ (vp).setPointerCapture?.(e.pointerId); begin();
  } else if (e.type === 'pointermove') {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, at);
    const m = mid(); g.far = Math.max(g.far, Math.hypot(m.x - g.x, m.y - g.y));
    if (pts.size > 1) {   // a pinch, about the fingers' middle
      const s0 = g.z / devicePixelRatio, px = (g.x - g.tx) / s0, py = (g.y - g.ty) / s0;
      z = Math.max(MIN, Math.min(MAX, (g.z * m.d) / g.d)); tx = m.x - px * scale(); ty = m.y - py * scale();
    } else if (g.far > 6) { tx = g.tx + m.x - g.x; ty = g.ty + m.y - g.y; }
    else return;
    hold(); apply();
  } else if (pts.delete(e.pointerId)) {
    if (pts.size) { begin(); return; }   // one finger of a pinch lifted: the other drags on
    const was = g; g = null;
    if (was && was.far < 8 && !was.two) {   // a tap flips; the second of two quick ones also zooms
      const now = performance.now();
      tapped();
      if (now - last.t < 320 && Math.hypot(at.x - last.x, at.y - last.y) < 36) { last.t = 0; zoomTo(z > 1.5 ? 1 : 3, at.x, at.y); }
      else last = { t: now, x: at.x, y: at.y };
      return;
    }
    moved();
  }
}
