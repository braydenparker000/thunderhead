// @ts-check
// The photo's zoom and pan in the editor (PHOTOS.md, the editor). While a finger moves, the frame last
// developed is moved by a CSS transform (the compositor's work, no GPU pass), over a backdrop of the
// whole photo for what the move uncovers; the photo develops again when the fingers stop for 120 ms or
// lift, and only then is a sharper detail asked for: the one on screen stays until the new one is
// ready, a newer request makes an older one stale, and a stale one never draws. A pinch zooms about the
// point between the fingers and keeps it under them; a fling glides a short way; past an edge or a zoom
// limit the photo gives like a rubber band and comes back; a double tap animates between fit and 1:1.
import { motionReduced } from '/th/motion.js';
import { geometry, photoBox } from './geometry.js';

const PAUSE_MS = 120, ANIM_MS = 200, GLIDE_MS = 110, EDGE_MS = 30, MARGIN = 0.25, BACK_SIDE = 1024;
/** --ease-out (ui/tokens.css): cubic-bezier(.2, .8, .2, 1). @param {number} x */
const easeOut = (x) => {
  const b = (/** @type {number} */ t, /** @type {number} */ p1, /** @type {number} */ p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (b(m, 0.2, 0.2) < x) lo = m; else hi = m; }
  return b((lo + hi) / 2, 0.8, 1);
};
/** Past an edge by `d`, the photo shows `band(d)`: it gives less the further it goes, never past `dim`. */
const band = (/** @type {number} */ d, /** @type {number} */ dim) => (dim * d * 0.55) / (dim + 0.55 * d);
const soft = (/** @type {number} */ x, /** @type {number[]} */ [lo, hi], /** @type {number} */ dim) => (x < lo ? lo - band(lo - x, dim) : x > hi ? hi + band(x - hi, dim) : x);
const hard = (/** @type {number} */ x, /** @type {number[]} */ [lo, hi]) => Math.min(hi, Math.max(lo, x));

/** @typedef {{ z: number, cu: number, cv: number, pw: number, ph: number, tile: null | { u0: number, v0: number, u1: number, v1: number, texel: number[], dens: number } }} View */
/**
 * @param {{ stage: HTMLElement, canvas: HTMLCanvasElement, root: HTMLElement, view: View, frame: () => number[],
 *   r: import('./renderer.js').Renderer, img: { width: number, height: number }, original: () => import('./source.js').Original | null,
 *   shown: () => import('./fields.js').Recipe, draw: () => void,
 *   readSmall: (rec: import('./fields.js').Recipe, side: number) => Promise<{ px: Uint8Array, w: number, h: number }> }} c
 */
export function zoomer(c) {
  const { stage, canvas, root, view, r, img } = c;
  const back = /** @type {HTMLCanvasElement} */ (document.createElement('canvas'));
  back.className = 'eback';
  back.hidden = true;
  stage.prepend(back);
  let drawn = { z: 1, cu: 0.5, cv: 0.5 }, backKey = '', queued = false, fingers = false, dirty = false, detailN = 0, asked = 0, pauses = 0;
  /** @type {null | ((t: number) => boolean)} */
  let motion = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pauseT = null;
  /** @type {Promise<any>} */
  let busy = Promise.resolve(null);
  /** @type {null | { z0: number, anchor: number[], x: number, y: number }} */
  let pin = null;
  /** @type {null | number[]} */
  let raw = null;
  /** @type {number[][]} */
  let samples = [];
  root.dataset.detail = 'none';
  root.dataset.tiles = '0';

  const fit = () => { const f = c.frame(); return Math.min(canvas.width / f[0], canvas.height / f[1]); };
  // Canvas pixels per frame unit at zoom `z`, on each axis.
  const per = (/** @type {number} */ z) => { const f = c.frame(), s = fit() * z; return [s * f[0], s * f[1]]; };
  const zmax = () => Math.max(1, 1 / fit());
  const half = (/** @type {number} */ z) => { const [a, b] = per(z); return [canvas.width / (2 * a), canvas.height / (2 * b)]; };
  const range = (/** @type {number} */ z) => half(z).map((h) => (h >= 0.5 ? [0.5, 0.5] : [h, 1 - h]));
  const toCanvas = (/** @type {number} */ x, /** @type {number} */ y) => { const b = stage.getBoundingClientRect(); return [(x - b.left) * (canvas.width / b.width), (y - b.top) * (canvas.height / b.height)]; };
  const uvAt = (/** @type {number} */ x, /** @type {number} */ y) => { const [X, Y] = toCanvas(x, y), [a, b] = per(view.z); return [view.cu + (X - canvas.width / 2) / a, view.cv + (Y - canvas.height / 2) / b]; };
  /** The centre that puts frame point `uv` under canvas point `XY` at zoom `z`. */
  const centreFor = (/** @type {number[]} */ uv, /** @type {number[]} */ XY, /** @type {number} */ z) => { const [a, b] = per(z); return [uv[0] - (XY[0] - canvas.width / 2) / a, uv[1] - (XY[1] - canvas.height / 2) / b]; };
  const inside = () => { const rg = range(view.z), e = 1e-6; return view.z >= 1 - e && view.z <= zmax() + e && Math.abs(hard(view.cu, rg[0]) - view.cu) < e && Math.abs(hard(view.cv, rg[1]) - view.cv) < e; };
  const clamp = () => { view.z = hard(view.z, [1, zmax()]); const rg = range(view.z); view.cu = hard(view.cu, rg[0]); view.cv = hard(view.cv, rg[1]); };

  // What is on screen: the developed frame moved from where it was drawn to where the view is now.
  const place = () => {
    const b = stage.getBoundingClientRect(), qx = b.width / canvas.width, qy = b.height / canvas.height;
    const k = view.z / drawn.z, [a, bb] = per(view.z);
    const tx = (drawn.cu - view.cu) * a - (canvas.width / 2) * (k - 1), ty = (drawn.cv - view.cv) * bb - (canvas.height / 2) * (k - 1);
    const still = Math.abs(k - 1) < 1e-5 && Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05;
    canvas.style.transform = still ? '' : `translate(${tx * qx}px, ${ty * qy}px) scale(${k})`;
    back.hidden = still || backKey !== JSON.stringify(c.shown());
    if (!back.hidden) back.style.transform = `translate(${(canvas.width / 2 - view.cu * a) * qx}px, ${(canvas.height / 2 - view.cv * bb) * qy}px) scale(${(a * qx) / back.width}, ${(bb * qy) / back.height})`;
  };
  const tick = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame((t) => {
      queued = false;
      if (motion && !motion(t)) { motion = null; root.dataset.moving = 'false'; rest(); }
      place();
      if (motion) tick();
    });
  };
  const run = (/** @type {(t: number) => boolean} */ m) => { motion = m; root.dataset.moving = 'true'; tick(); };
  const stop = () => { if (motion) { motion = null; dirty = true; root.dataset.moving = 'false'; } };
  const rest = () => { c.draw(); settle(); };
  /** From the view now to `to` in `ms`, eased; the zoom about the one point both views share. */
  const toward = (/** @type {{ z: number, cu: number, cv: number }} */ to, ms = motionReduced() ? 0 : ANIM_MS) => {
    const from = { z: view.z, cu: view.cu, cv: view.cv };
    let t0 = -1;
    return (/** @type {number} */ t) => {
      if (t0 < 0) t0 = t;
      const x = ms ? (t - t0) / ms : 1, e = x >= 1 ? 1 : easeOut(x);
      view.z = from.z * (to.z / from.z) ** e;
      const f = Math.abs(1 / to.z - 1 / from.z) < 1e-9 ? e : (1 / view.z - 1 / from.z) / (1 / to.z - 1 / from.z);
      view.cu = from.cu + (to.cu - from.cu) * f;
      view.cv = from.cv + (to.cv - from.cv) * f;
      if (e === 1) Object.assign(view, to);
      return ms > 0 && t - t0 < ms;
    };
  };
  /** Where the view comes back to: inside the zoom limits about the last pinch's point, inside the edges. */
  const home = () => {
    const z = hard(view.z, [1, zmax()]), rg = range(z);
    const [cu, cv] = pin && z !== view.z ? centreFor(pin.anchor, [pin.x, pin.y], z) : [view.cu, view.cv];
    return { z, cu: hard(cu, rg[0]), cv: hard(cv, rg[1]) };
  };
  // Every step of a gesture: stale details are dropped, the frame is moved, and a pause develops it.
  const moved = () => {
    dirty = true;
    detailN++;
    if (pauseT) clearTimeout(pauseT);
    pauseT = setTimeout(() => { pauseT = null; if (fingers) { root.dataset.pauses = String(++pauses); rest(); } }, PAUSE_MS);
    tick();
  };

  const settle = async () => {
    const n = ++detailN;
    await busy;
    if (n !== detailN) return;
    if (view.z <= 1.05) { if (view.tile) { view.tile = null; r.clearDetail(); root.dataset.detail = 'none'; c.draw(); } return; }
    const g = geometry(c.shown(), img.width, img.height), [hu, hv] = half(view.z), dens = per(view.z)[0] / c.frame()[0];
    const box = (/** @type {number} */ m) => photoBox(g, [Math.max(0, view.cu - hu * (1 + m)), Math.max(0, view.cv - hv * (1 + m))], [Math.min(1, view.cu + hu * (1 + m)), Math.min(1, view.cv + hv * (1 + m))], 8);
    const o = c.original(), full = Boolean(o && dens > (o.source.width / img.width) * 1.05), seen = box(0), t = view.tile;
    const covers = Boolean(t && t.u0 <= seen[0] && t.v0 <= seen[1] && t.u1 >= seen[2] && t.v1 >= seen[3]);
    if (covers && t && t.dens >= (full ? 1 : dens) * 0.9) return;
    root.dataset.tiles = String(++asked);
    root.dataset.idle = 'false';
    let [u0, v0, u1, v1] = box(MARGIN);
    const working = () => {
      const d = o ? Math.min(dens, o.source.width / img.width) : dens, w = Math.max(1, Math.round((u1 - u0) * img.width * d)), h = Math.max(1, Math.round((v1 - v0) * img.height * d));
      r.detail(null, [u0, v0, u1, v1], w, h);
      view.tile = { u0, v0, u1, v1, texel: [1 / w, 1 / h], dens: d };
      root.dataset.detail = 'working';
      c.draw();
    };
    if (!full || !o) { working(); return; }
    if (!covers) working();
    busy = o.tile(Math.floor(u0 * img.width), Math.floor(v0 * img.height), Math.ceil((u1 - u0) * img.width), Math.ceil((v1 - v0) * img.height)).catch(() => null);
    const tile = await busy;
    if (n !== detailN || !tile) { if (tile?.kind === 'bitmap') tile.bitmap.close(); return; }
    if ('x' in tile && typeof tile.x === 'number') [u0, v0, u1, v1] = [tile.x / img.width, Number(tile.y) / img.height, (tile.x + tile.width) / img.width, (Number(tile.y) + tile.height) / img.height];
    r.detail(tile, [u0, v0, u1, v1], tile.width, tile.height);
    if (tile.kind === 'bitmap') tile.bitmap.close();
    view.tile = { u0, v0, u1, v1, texel: [1 / tile.width, 1 / tile.height], dens: 1 };
    root.dataset.detail = 'tile';
    c.draw();
  };

  const hooks = /** @type {any} */ (root);
  hooks.view = () => ({ z: view.z, cu: view.cu, cv: view.cv });
  hooks.uvAt = uvAt;
  hooks.inside = inside;
  return {
    uvAt, clamp, settle,
    /** The editor developed the frame at the view as it is now. */
    drawn() { drawn = { z: view.z, cu: view.cu, cv: view.cv }; place(); },
    /** The editor is idle: while zoomed, the backdrop is made again if the edit changed. */
    async idle() {
      const rec = c.shown(), key = JSON.stringify(rec);
      if (view.z <= 1.05 || key === backKey) return;
      const s = await c.readSmall(rec, Math.min(BACK_SIDE, canvas.width));
      Object.assign(back, { width: s.w, height: s.h });
      Object.assign(back.style, { width: `${s.w}px`, height: `${s.h}px` });
      /** @type {CanvasRenderingContext2D} */ (back.getContext('2d')).putImageData(new ImageData(new Uint8ClampedArray(/** @type {ArrayBuffer} */ (s.px.buffer), s.px.byteOffset, s.px.length), s.w, s.h), 0, 0);
      backKey = key;
    },
    /** The detail was taken for something else (an export): made again for the view. */
    retile() { view.tile = null; settle(); c.draw(); },
    down() { fingers = true; stop(); },
    /** @param {'start' | 'move' | 'end'} phase @param {number} ratio @param {number} x @param {number} y */
    pinch(phase, ratio, x, y) {
      if (phase === 'start') { pin = { z0: view.z, anchor: uvAt(x, y), x: 0, y: 0 }; [pin.x, pin.y] = toCanvas(x, y); return; }
      if (!pin || phase === 'end') return;
      view.z = Math.exp(soft(Math.log(pin.z0 * ratio), [0, Math.log(zmax())], 0.4));
      [pin.x, pin.y] = toCanvas(x, y);
      const [cu, cv] = centreFor(pin.anchor, [pin.x, pin.y], view.z), rg = range(view.z), [hu, hv] = half(view.z);
      view.cu = soft(cu, rg[0], hu);
      view.cv = soft(cv, rg[1], hv);
      moved();
    },
    /** @param {number} dx @param {number} dy @param {number} t */
    pan(dx, dy, t) {
      if (!raw) { raw = [view.cu, view.cv]; samples = []; }
      const b = stage.getBoundingClientRect(), [a, bb] = per(view.z), rg = range(view.z), [hu, hv] = half(view.z);
      raw[0] -= (dx * canvas.width) / b.width / a;
      raw[1] -= (dy * canvas.height) / b.height / bb;
      view.cu = soft(raw[0], rg[0], hu);
      view.cv = soft(raw[1], rg[1], hv);
      samples.push([t, raw[0], raw[1]]);
      while (samples.length > 2 && t - samples[0][0] > 80) samples.shift();
      moved();
    },
    /** All fingers up: a fling glides on, a view past an edge comes back, and the photo develops. */
    release() {
      fingers = false;
      if (pauseT) { clearTimeout(pauseT); pauseT = null; }
      const s0 = samples[0], s1 = samples.at(-1), p = raw;
      raw = null;
      samples = [];
      if (!dirty) return;
      dirty = false;
      const dt = s0 && s1 ? s1[0] - s0[0] : 0, v = p && s0 && s1 && dt > 0 && performance.now() - s1[0] < 60 && !motionReduced() ? [(s1[1] - s0[1]) / dt, (s1[2] - s0[2]) / dt] : [0, 0];
      const [a, bb] = per(view.z), fast = () => Math.hypot(v[0] * a, v[1] * bb);
      const back2 = () => { if (inside()) return false; motion = toward(home()); return true; };
      if (p && fast() > 0.3) {
        let last = performance.now();
        run((t) => {
          const dt2 = Math.max(0, Math.min(32, t - last)), rg = range(view.z), [hu, hv] = half(view.z);
          last = t;
          for (const i of [0, 1]) { p[i] += v[i] * dt2; v[i] *= Math.exp(-dt2 / (hard(p[i], rg[i]) === p[i] ? GLIDE_MS : EDGE_MS)); }
          view.cu = soft(p[0], rg[0], hu);
          view.cv = soft(p[1], rg[1], hv);
          return fast() > 0.02 || back2();
        });
      } else if (!inside()) run(toward(home()));
      else rest();
      pin = null;
    },
    /** @param {number} x @param {number} y */
    doubleTap(x, y) {
      stop();
      dirty = false;
      const z = zmax(), rg = range(z), [cu, cv] = centreFor(uvAt(x, y), toCanvas(x, y), z);
      run(toward(view.z > 1.05 ? { z: 1, cu: 0.5, cv: 0.5 } : { z, cu: hard(cu, rg[0]), cv: hard(cv, rg[1]) }));
    },
  };
}
