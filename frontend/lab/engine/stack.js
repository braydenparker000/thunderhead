// @ts-check
// Frames stacked for noise (engine/raw/ROADMAP.md stage 8): several exposures of one scene from a tripod, averaged
// into one. Noise falls with the square root of how many there are (four frames: half the noise, a stop of ISO
// twice over), which no single frame's noise reduction can give, because nothing is guessed: it is more light.
// The frames are averaged as sensor data, sensel by sensel, before any colour is made, so the stack is a raw
// photo still: it takes the camera's profile, the demosaic, the lens corrections and every control as one frame
// does. That asks that the frames lie exactly on each other, so each is measured against the first and one that
// has moved is left out (`shiftOf`). This file is the arithmetic and the stack's file; the editor's part is
// app/stack.js. It imports nothing, so the decoder's thread uses it too.

/** Levels kept under the camera's own: a stack is written at four times the camera's scale, so an average holds
 * two more bits than a frame (14 bits become 16). */
export const FINER = 4;
/** How far, in pixels of the editing copy (three sensels each), a frame may sit from the first and still be
 * stacked: half a sensel, which a tripod on a floor gives and which costs no detail that can be seen. (Noise
 * does not disturb the reading: two frames that had not moved read 0.02 apart at the worst noise tried.) */
export const STILL = 0.17;

/** How far frame `b` sits from frame `a`, in pixels of the editing copy, by their green in a square at the middle:
 * the whole-pixel shift (within 2 each way) where they differ least, made finer by the two beside it.
 * @param {Uint16Array} a an editing copy (RGBA) @param {Uint16Array} b another of the same size @param {number} w @param {number} h @returns {[number, number]} */
export function shiftOf(a, b, w, h) {
  const n = Math.min(384, w - 8, h - 8), x0 = Math.floor((w - n) / 2), y0 = Math.floor((h - n) / 2), R = 2;
  const sad = (/** @type {number} */ dx, /** @type {number} */ dy) => { let s = 0; for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) s += Math.abs(a[((y0 + y) * w + x0 + x) * 4 + 1] - b[((y0 + y + dy) * w + x0 + x + dx) * 4 + 1]); return s; };
  let best = [0, 0], least = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const s = sad(dx, dy); if (s < least) { least = s; best = [dx, dy]; } }
  const fine = (/** @type {number} */ lo, /** @type {number} */ hi) => { const d = lo - 2 * least + hi; return d > 0 ? (0.5 * (lo - hi)) / d : 0; };
  const [bx, by] = best, inside = Math.abs(bx) < R && Math.abs(by) < R;
  return inside ? [bx + fine(sad(bx - 1, by), sad(bx + 1, by)), by + fine(sad(bx, by - 1), sad(bx, by + 1))] : [bx, by];
}

/** Frames being averaged. `add` takes each frame's sensor data; `done` gives their mean at `FINER` times the scale.
 * @param {number} length sensels in a frame */
export function summer(length) {
  const sum = new Uint32Array(length);
  let n = 0;
  return {
    get count() { return n; },
    /** @param {Uint16Array} mosaic */
    add(mosaic) { for (let i = 0; i < length; i++) sum[i] += mosaic[i]; n++; },
    done() { const out = new Uint16Array(length), k = FINER / n; for (let i = 0; i < length; i++) out[i] = Math.min(65535, Math.round(sum[i] * k)); return out; },
  };
}
/** What the engine is told of a stack of `n` frames, from what it was told of the first: the levels at the finer
 * scale, and the ISO its noise now answers to (noise's variance falls with the count, as it does with ISO).
 * @param {any} meta the first frame's @param {number} n @param {{ dr?: number, settings?: string }} [more] */
export const stackMeta = (meta, n, more = {}) => ({ ...meta, black: meta.black * FINER, white: meta.white * FINER, iso: Math.max(1, Math.round((meta.iso || 100) / n)), frames: n, ...more });

/** A stack's file: the sensor data first (so it is read where it lies), then what the engine is told of it, then
 * how long that is. @param {Uint16Array} mosaic @param {any} meta @returns {BlobPart[]} */
export function pack(mosaic, meta) {
  const text = new TextEncoder().encode(JSON.stringify(meta));
  return [new Uint8Array(mosaic.buffer, mosaic.byteOffset, mosaic.byteLength), text, new Uint8Array(Uint32Array.of(text.length).buffer)];
}
/** @param {ArrayBuffer} buf a stack's file @returns {{ meta: any, mosaic: Uint16Array }} */
export function unpack(buf) {
  const len = new DataView(buf).getUint32(buf.byteLength - 4, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, buf.byteLength - 4 - len, len)));
  if (!(meta.fullWidth > 0 && meta.fullHeight > 0) || meta.fullWidth * meta.fullHeight * 2 > buf.byteLength - 4 - len) throw new Error('not a stack');
  return { meta, mosaic: new Uint16Array(buf, 0, meta.fullWidth * meta.fullHeight) };
}
/** The editing copy of sensor data, as the decoder makes a frame's (engine/raw `bin`): each 3 × 3 of the mosaic
 * averaged by colour, 0..65535 of the sensor's range, and in the fourth value which colours had a clipped sensel.
 * @param {Uint16Array} mosaic @param {{ fullWidth: number, fullHeight: number, black: number, white: number, cfa: string }} meta */
export function binned(mosaic, meta) {
  const W = meta.fullWidth, pw = W / 3, ph = meta.fullHeight / 3, out = new Uint16Array(pw * ph * 4), scale = 65535 / Math.max(1, meta.white - meta.black), clip = meta.black + 0.97 * (meta.white - meta.black);
  const colour = Uint8Array.from(meta.cfa, Number), s = [0, 0, 0], c = [0, 0, 0];
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    s[0] = s[1] = s[2] = c[0] = c[1] = c[2] = 0;
    let flags = 0;
    for (let j = 0; j < 3; j++) for (let i = 0, y = py * 3 + j, at = y * W + px * 3, row = (y % 6) * 6; i < 3; i++) { const k = colour[row + (px * 3 + i) % 6], v = mosaic[at + i]; s[k] += v; c[k]++; if (v >= clip) flags |= 1 << k; }
    const o = (py * pw + px) * 4;
    for (let k = 0; k < 3; k++) out[o + k] = c[k] ? Math.max(0, Math.min(65535, Math.floor((s[k] / c[k] - meta.black) * scale))) : 0;
    out[o + 3] = flags;
  }
  return out;
}
