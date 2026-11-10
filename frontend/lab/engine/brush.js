// @ts-check
// Painted masks (local.js): a brush mask's weight is a small picture of its own, one layer of a texture the frame
// pass reads between its four nearest values. A stroke is kept as the points a finger went through, in mask units,
// and is laid down here as soft round dabs along that path, so it can be drawn again at any time (after Undo, on
// the next visit) and comes out the same.

/** @typedef {{ id: number, r: number, feather: number, flow: number, erase: boolean, pts: number[] }} Stroke
 * `r`: the brush's radius in mask units; `feather` 0..1: how much of the radius fades out; `flow` 0..1: how much one
 * dab lays down; `pts`: x, y, x, y … in mask units */
export const LAYERS = 4, LONG = 1024;   // painted masks a photo can have; a layer's longer side in pixels

/** Lays a stroke's dabs on a layer, from its point `from` on (0: all of it). The dabs fall at the same places
 * whether a stroke is laid at once or as it grows. Returns the rectangle touched [x0, y0, x1, y1), or null.
 * @param {Uint16Array} d the layer, W × H, 0..65535 @param {number} W @param {number} H @param {Stroke} s @param {number} from */
export function lay(d, W, H, s, from = 0) {
  const R = Math.max(0.75, s.r * W), step = Math.max(0.75, R / 4), soft = Math.min(1, Math.max(0, s.feather)), p = s.pts;
  let box = /** @type {number[] | null} */ (null);
  const dab = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W, Math.ceil(cx + R) + 1), y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H, Math.ceil(cy + R) + 1);
    if (x0 >= x1 || y0 >= y1) return;
    box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      if (t >= 1) continue;
      const e = soft > 0 ? Math.min(1, (1 - t) / soft) : 1, a = s.flow * e * e * (3 - 2 * e), i = y * W + x, v = d[i] / 65535;
      d[i] = Math.round((s.erase ? v * (1 - a) : v + (1 - v) * a) * 65535);
    }
  };
  for (let k = Math.max(0, from); k < p.length / 2; k++) {
    const x = p[k * 2] * W, y = p[k * 2 + 1] * W;
    if (k === 0) { dab(x, y); continue; }
    const px = p[k * 2 - 2] * W, py = p[k * 2 - 1] * W, n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / step));
    for (let j = 1; j <= n; j++) dab(px + ((x - px) * j) / n, py + ((y - py) * j) / n);
  }
  return box;
}

/** The painted layers of one photo. @param {GPUDevice} device @param {number} uw @param {number} uh the upright, uncropped picture's size */
export function brushes(device, uw, uh) {
  const W = uw >= uh ? LONG : Math.max(1, Math.round((LONG * uw) / uh)), H = uw >= uh ? Math.max(1, Math.round((LONG * uh) / uw)) : LONG;
  let tex = device.createTexture({ size: [1, 1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }), real = false;
  /** What each layer holds: its values, and the strokes laid on it as [id, points] @type {{ d: Uint16Array, on: number[][] }[]} */
  const layers = [];
  const send = (/** @type {number} */ l, /** @type {number[]} */ [x0, y0, x1, y1]) => {
    const w = x1 - x0, h = y1 - y0, b = new Uint8Array(w * h), d = layers[l].d;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = d[(y0 + y) * W + x0 + x] >> 8;
    device.queue.writeTexture({ texture: tex, origin: [x0, y0, l] }, b, { bytesPerRow: w }, [w, h]);
  };
  return {
    /** The texture as the frame pass binds it. */
    view: () => tex.createView({ dimension: '2d-array' }),
    /** Brings the layers up to date with the photo's brush masks, in their order (the first LAYERS of them). A stroke
     * that only grew is carried on from where it stood; anything else is laid again from nothing. True when the
     * texture itself was made anew, so whoever binds it must bind again. @param {import('./local.js').Mask[] | null | undefined} masks */
    sync(masks) {
      const mine = (masks || []).filter((m) => m.kind === 'Brush').slice(0, LAYERS);
      let made = false;
      if (mine.length && !real) { tex.destroy(); tex = device.createTexture({ size: [W, H, LAYERS], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); real = made = true; layers.length = 0; }
      mine.forEach((m, l) => {
        const strokes = /** @type {Stroke[]} */ (m.strokes || []), had = layers[l], on = had?.on || [];
        const grew = !!had && on.length <= strokes.length && on.every(([id, n], k) => strokes[k].id === id && (k === on.length - 1 ? strokes[k].pts.length >= n : strokes[k].pts.length === n));
        if (!grew) { layers[l] = { d: had ? had.d.fill(0) : new Uint16Array(W * H), on: [] }; }
        const L = layers[l]; let box = grew ? null : (had ? [0, 0, W, H] : null);
        strokes.forEach((s, k) => {
          const from = grew && k < L.on.length ? L.on[k][1] / 2 : 0;
          if (from * 2 >= s.pts.length) return;
          const b = lay(L.d, W, H, s, from);
          if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
        });
        L.on = strokes.map((s) => [s.id, s.pts.length]);
        if (box) send(l, box);
      });
      for (let l = mine.length; l < layers.length; l++) if (layers[l].on.length) { layers[l].d.fill(0); layers[l].on = []; send(l, [0, 0, W, H]); }   // a layer whose mask is gone
      return made;
    },
    destroy: () => tex.destroy(),
  };
}
