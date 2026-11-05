// @ts-check
// Camera compare (PHOTOS.md, the editor): the camera's own JPEG (the one inside the RAW) drawn by a second
// renderer with exactly our view (zoom, pan, the edit's crop and geometry, nothing else), so the two line
// up. Held past As shot, it takes our render's place until the finger lifts; in the wipe, chosen from
// More, a vertical line you drag splits the photo: the camera's on the left, yours on the right.
import { el } from '/th/ui.js';
import { icon } from '../shelf.js';
import { makeRenderer } from './renderer.js';
import { pack, toneLut } from './uniforms.js';
import { withGeometryOf } from './versions.js';

/** @typedef {{ scale: number[], offset: number[], size: number[], flip: number, p0: number[], tile: unknown }} View */

/**
 * @param {HTMLElement} stage the editor's stage (our canvas first in it)
 * @param {Blob} jpeg the camera's JPEG
 * @param {{ img: any, recipe: () => import('./fields.js').Recipe, view: () => View, pw: number, ph: number }} ed
 */
export async function cameraCompare(stage, jpeg, ed) {
  const ours = /** @type {HTMLCanvasElement} */ (stage.querySelector('.ecanvas'));
  let canvas = /** @type {HTMLCanvasElement} */ (el('canvas', { class: 'ecanvas ecam', 'aria-label': "The camera's JPEG", hidden: '' }));
  ours.after(canvas);
  const made = await makeRenderer(canvas);
  const r = made.r;
  canvas = made.canvas;
  const bmp = await createImageBitmap(jpeg, { resizeWidth: ed.pw, resizeHeight: ed.ph, resizeQuality: 'high' });
  r.source({ kind: 'bitmap', width: bmp.width, height: bmp.height, bitmap: bmp }, ed.pw, ed.ph);
  bmp.close();
  const lut = toneLut({}, false);
  // While a finger moves, zoom.js moves our last frame by a CSS transform: the camera's follows it.
  new MutationObserver(() => { canvas.style.transform = ours.style.transform; }).observe(ours, { attributes: true, attributeFilter: ['style'] });
  let held = false, wiping = false, at = 0.5;
  const draw = () => {
    if (canvas.hidden) return;
    if (canvas.width !== ours.width || canvas.height !== ours.height) { canvas.width = ours.width; canvas.height = ours.height; }
    const v = ed.view();
    const img = { ...ed.img, raw: false, rawPhoto: false, auto: null, ca: undefined };
    r.draw(pack(withGeometryOf({}, ed.recipe()), img, { ...v, flip: r.kind === 'webgl2' ? 1 : 0, p0: [1 / ed.pw, 1 / ed.ph], tile: null }), lut);
  };
  const line = el('div', { class: 'ewipe', role: 'slider', 'aria-label': 'Wipe between the camera and yours', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: '' }, [
    el('span', { class: 'ewlabel', text: 'Camera' }), el('span', { class: 'ewknob', 'aria-hidden': 'true' }), el('span', { class: 'ewlabel', text: 'Yours' }),
  ]);
  const done = el('button', { type: 'button', class: 'vback ewdone', 'aria-label': 'End the wipe', hidden: '' }, [icon('x')]);
  stage.append(line, done);
  const place = () => {
    canvas.style.clipPath = wiping && !held ? `inset(0 ${((1 - at) * 100).toFixed(2)}% 0 0)` : '';
    line.style.left = `${(at * 100).toFixed(2)}%`;
    line.setAttribute('aria-valuenow', String(Math.round(at * 100)));
  };
  const show = () => {
    canvas.hidden = !(held || wiping);
    line.hidden = done.hidden = !wiping || held;
    stage.dataset.camera = held ? 'held' : wiping ? 'wipe' : 'off';
    place();
    draw();
  };
  line.addEventListener('pointerdown', (e) => { e.stopPropagation(); line.setPointerCapture(e.pointerId); });
  line.addEventListener('pointermove', (e) => {
    if (!line.hasPointerCapture(e.pointerId)) return;
    const b = stage.getBoundingClientRect();
    at = Math.min(0.98, Math.max(0.02, (e.clientX - b.left) / b.width));
    place();
  });
  line.addEventListener('pointerup', (e) => e.stopPropagation());
  line.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key];
    if (d) { at = Math.min(0.98, Math.max(0.02, at + d)); place(); }
  });
  line.tabIndex = 0;
  done.addEventListener('pointerdown', (e) => e.stopPropagation());
  done.addEventListener('click', () => { wiping = false; show(); });
  return {
    /** Redraw with our current view (the editor calls it after each of its own draws). */
    draw,
    /** @param {boolean} on */
    hold(on) { held = on; show(); },
    wipe() { wiping = true; at = 0.5; show(); },
  };
}
