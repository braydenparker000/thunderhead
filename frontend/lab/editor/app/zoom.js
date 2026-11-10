// @ts-check
// The View board's 100 % (docs/design/EDITOR.md): one sensor pixel to one screen pixel. The board sizes and moves
// the photo's wrapper; in it the editing copy, stretched, stands in while the wrapper animates, while the
// sensor's pixels are still loading, and at the edges during a drag. Over it lies this module's canvas: the
// engine's full-resolution view (../../engine/full.js) of the part on screen, laid on whole screen pixels.
import * as photo from './session.js';

/** @typedef {NonNullable<ReturnType<typeof photo.whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
/** @typedef {ReturnType<View['place']>} Rect */
const READBACK = new URLSearchParams(location.search).has('readback');
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-hidden', 'true');
canvas.style.cssText = 'position: absolute; left: 0; top: 0; transform-origin: 0 0; opacity: 0';
// the board marks the canvas's place with data-keep="detail": the photo's area, over the wrapper
let slot = /** @type {HTMLElement | null} */ (null);
document.addEventListener('dc:keep', (e) => { const el = /** @type {HTMLElement} */ (/** @type {CustomEvent} */ (e).detail); if (el.dataset.keep === 'detail') { slot = el; el.replaceChildren(canvas); } });

let from = /** @type {Big | null} */ (null), view = /** @type {View | null} */ (null), cap = 0, making = /** @type {Promise<View | null> | null} */ (null);
let target = /** @type {{ imL: number, imT: number } | null} */ (null);   // where the board has the wrapper, while 100 % is on
let shown = /** @type {Rect | null} */ (null), hold = 0, busy = false;   // what the canvas holds; when the wrapper's animation ends

const frame = () => /** @type {HTMLElement} */ (document.getElementById('frame'));
/** Screen pixels in one of the design's (the page's frame is the 412-wide design, scaled to the screen). */
const scale = () => (frame().getBoundingClientRect().width / 412) * devicePixelRatio;

/** The photo area's height and the fitted photo's size, in design pixels, and how many times larger 100 % is. */
export function geometry() {
  const ah = 738 - (parseFloat(frame().style.getPropertyValue('--cut')) || 0), [fw, fh] = photo.shape(), f = Math.min(412 / fw, ah / fh);
  return { ah, w: fw * f, h: fh * f, z: 1 / (f * scale()) };
}

/** The photo's view, made at the first 100 % and kept: as large as the photo's area can be on this screen, and a
 * pixel more on every side, so the canvas covers the area wherever the whole-pixel rounding puts it. */
const ensure = () => (making ||= make().finally(() => { making = null; }));
async function make() {
  const big = photo.whole(), k = scale(), need = Math.ceil(412 * k) + 2;
  if (big !== from) { from = big; view = null; cap = 0; }   // a photo's views go with it (the session's dispose)
  if (!big) return null;
  if (view && cap >= need) return view;
  view?.dispose();
  const v = await big.view(need, Math.ceil(738 * k) + 2, canvas, READBACK);
  if (photo.whole() !== big) { v.dispose(); return null; }
  v.onframe = onframe;
  cap = need;
  return (view = v);
}

const hide = () => { canvas.style.transition = 'none'; canvas.style.opacity = '0'; };
function reveal() {
  if (!target || !shown || performance.now() < hold) return;
  canvas.style.transition = 'opacity 140ms'; canvas.style.opacity = '1';
}
/** Puts the canvas where its pixels belong under the wrapper, on whole screen pixels. */
function lay() {
  if (!target || !shown || !slot) return;
  const k = scale(), dpr = devicePixelRatio, a = slot.getBoundingClientRect(), ax = a.left * dpr, ay = a.top * dpr;
  const x = Math.round(ax + target.imL * k + shown.X) - ax, y = Math.round(ay + target.imT * k + shown.Y) - ay;
  canvas.style.width = `${shown.cw / k}px`; canvas.style.height = `${shown.ch / k}px`;
  canvas.style.transform = `translate(${x / k}px, ${y / k}px)`;
}
/** The engine drew the view (in this task): the canvas now holds `at`. @param {Rect} at */
function onframe(at) {
  if (!target || !canvas.isConnected) { view?.rest(); hide(); return; }   // left behind by another board's frames
  shown = at; lay(); reveal();
}
/** Draws the part on screen, again while the photo keeps moving. */
async function chase() {
  if (busy) return;
  busy = true;
  try {
    while (target && slot?.isConnected) {
      const v = await ensure();
      if (!v || !target) break;
      const a = slot.getBoundingClientRect(), k = scale(), dpr = devicePixelRatio;
      const want = v.place(-target.imL * k - 1, -target.imT * k - 1, a.width * dpr + 2, a.height * dpr + 2);
      if (want === shown) break;
      await photo.frame();
      if (shown !== want) break;   // nothing drew it (the photo is closing)
    }
  } finally { busy = false; }
}

/** The board says, each time it renders, whether 100 % is on and where the photo's wrapper sits in its area
 * (design pixels). @param {boolean} on @param {number} imL @param {number} imT */
export function aim(on, imL, imT) {
  if (!on) {
    if (target) { target = null; shown = null; hide(); view?.rest(); }
    return;
  }
  if (!target) { hold = performance.now() + 340; setTimeout(reveal, 350); }   // the wrapper takes 320 ms to get there
  target = { imL, imT };
  lay(); chase();
}
