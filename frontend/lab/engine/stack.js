// @ts-check
// Frames stacked for noise (engine/raw/ROADMAP.md stage 8): several exposures of one scene from a tripod, averaged
// into one. Noise falls with the square root of how many there are (four frames: half the noise, a stop of ISO
// twice over), which no single frame's noise reduction can give, because nothing is guessed: it is more light.
// The frames are averaged as sensor data, sensel by sensel, before any colour is made, so the stack is a raw
// photo still: it takes the camera's profile, the demosaic, the lens corrections and every control as one frame
// does. That asks that the frames lie exactly on each other, so each is measured against the first and one that
// has moved is left out (`shiftOf`). This file is the arithmetic and the stack's file; the editor's part is
// app/stack.js. It imports nothing, so the decoder's thread uses it too.
//   A bracket (the same scene at several shutter times) is the same sum, each frame counted by its exposure: what
// a sensel is worth is all the light it gathered in the frames where it did not clip, over the time they were
// open. That is the best estimate there is of the light when its noise is the light's own, and for frames shot
// alike it is their mean. Where the long frames clipped, the short ones speak alone, so the highlights are the
// short frame's and the shadows are all the frames' together. The stack is kept at the shortest frame's exposure,
// where nothing more is clipped than was in it.

/** Levels kept under the camera's own: a stack is written at four times the camera's scale, so an average holds
 * two more bits than a frame (14 bits become 16). */
export const FINER = 4;
/** How far, in pixels of the editing copy (three sensels each), a frame may sit from the first and still be
 * stacked: half a sensel, which a tripod on a floor gives and which costs no detail that can be seen. (Noise
 * does not disturb the reading: two frames that had not moved read 0.02 apart at the worst noise tried.) */
export const STILL = 0.17;

/** Scale factor that maximizes extra bits without overflowing 16-bit Uint16 (4 for 14-bit sensors, 2 for 15-bit, 1 for 16-bit). @param {number} white */
export const finerOf = (white) => Math.max(1, Math.min(FINER, Math.floor(65535 / Math.max(1, white))));

/** Empirical exposure ratio `b / a` measured from unclipped midtone greens in the centre of the frame, so
 * mechanical shutter tolerances never leave a brightness step at a bracket's highlight transition. Falls back to
 * `nominal` when too few pixels qualify or the reading lies outside [0.75, 1.33] of `nominal`.
 * @param {Uint16Array} a @param {Uint16Array} b @param {number} w @param {number} h @param {number} [nominal] */
export function gainOf(a, b, w, h, nominal = 1) {
  const n = Math.min(384, w - 8, h - 8), x0 = Math.floor((w - n) / 2), y0 = Math.floor((h - n) / 2), LO = 2000, HI = 45000;
  const r = /** @type {number[]} */ ([]);
  for (let y = 0; y < n; y += 4) for (let x = 0; x < n; x += 4) {
    const o = ((y0 + y) * w + x0 + x) * 4 + 1, p = a[o], q = b[o];
    if (p >= LO && p <= HI && q >= LO && q <= HI) r.push(q / p);
  }
  if (r.length < 64) return nominal;
  r.sort((u, v) => u - v);
  const med = r[r.length >> 1];
  return med >= 0.75 * nominal && med <= 1.33 * nominal ? med : nominal;
}

/** How far frame `b` sits from frame `a`, in pixels of the editing copy, by their green in a square at the middle:
 * the whole-pixel shift (within 2 each way) where they differ least in L2 (unbiased under parabolic subpixel fit),
 * made finer by the two beside it. `gain` is what brings b's exposure to a's (a bracket's frames); a pixel near
 * clipping in either is not compared.
 * @param {Uint16Array} a an editing copy (RGBA) @param {Uint16Array} b another of the same size @param {number} w @param {number} h @param {number} [gain] @returns {[number, number]} */
export function shiftOf(a, b, w, h, gain = 1) {
  const n = Math.min(384, w - 8, h - 8), x0 = Math.floor((w - n) / 2), y0 = Math.floor((h - n) / 2), R = 2, TOP = 55000;
  const ssd = (/** @type {number} */ dx, /** @type {number} */ dy) => {
    let s = 0, k = 0;
    for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) { const p = a[((y0 + y) * w + x0 + x) * 4 + 1], q = b[((y0 + y + dy) * w + x0 + x + dx) * 4 + 1]; if (p < TOP && q < TOP && q * gain < TOP) { const e = p - q * gain; s += e * e; k++; } }
    return k > n ? s / k : Infinity;
  };
  let best = [0, 0], least = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const s = ssd(dx, dy); if (s < least) { least = s; best = [dx, dy]; } }
  const fine = (/** @type {number} */ lo, /** @type {number} */ hi) => { if (least === 0) return 0; const d = lo - 2 * least + hi; return d > 0 ? (0.5 * (lo - hi)) / d : 0; };
  const [bx, by] = best, inside = Math.abs(bx) < R && Math.abs(by) < R;
  return inside ? [bx + fine(ssd(bx - 1, by), ssd(bx + 1, by)), by + fine(ssd(bx, by - 1), ssd(bx, by + 1))] : [bx, by];
}

/** Frames being added up. `add` takes each frame's sensor data and its exposure against the first frame's (1: shot
 * alike), shortest exposure first; `done` gives the light each sensel saw, at the first frame's exposure and
 * `finer` times its scale. When `soft` is true (HDR brackets), each longer frame tapers smoothly to zero from 80 %
 * to 100 % of `clip` so highlight transitions carry no contour edge. `light` is the exposure of all frames together.
 * @param {number} length sensels in a frame @param {number} [black] the sensor's black level @param {number} [clip] a sensel at or over this has clipped @param {boolean} [soft] @param {number} [finer] */
export function summer(length, black = 0, clip = Infinity, soft = false, finer = FINER) {
  const num = soft ? new Float32Array(length) : new Int32Array(length), den = soft ? new Float32Array(length) : null, last = soft ? null : new Uint8Array(length), open = [0];
  const knee = black + 0.8 * (clip - black), span = Math.max(1, clip - knee);
  let n = 0;
  return {
    get count() { return n; },
    get light() { return open[n]; },
    /** @param {Uint16Array} mosaic @param {number} [t] */
    add(mosaic, t = 1) {
      if (soft && den) {
        if (n === 0) for (let i = 0; i < length; i++) { num[i] = mosaic[i] - black; den[i] = t; }
        else for (let i = 0; i < length; i++) {
          const v = mosaic[i];
          if (v < clip) { const u = v <= knee ? 1 : (clip - v) / span, w = u * u * (3 - 2 * u); num[i] += w * (v - black); den[i] += w * t; }
        }
      } else if (last) {
        for (let i = 0; i < length; i++) if (last[i] === n) { const v = mosaic[i]; if (v < clip || n === 0) { num[i] += v - black; last[i] = n + 1; } }
      }
      open.push(open[n] + t); n++;
    },
    done() {
      const out = new Uint16Array(length);
      if (soft && den) for (let i = 0; i < length; i++) out[i] = Math.max(0, Math.min(65535, Math.round((black + num[i] / den[i]) * finer)));
      else if (last) for (let i = 0; i < length; i++) out[i] = Math.max(0, Math.min(65535, Math.round((black + num[i] / open[last[i]]) * finer)));
      return out;
    },
  };
}
/** What the engine is told of a stack, from what it was told of its first (shortest) frame: the levels at the
 * finer scale; the ISO its noise now answers to (noise's variance falls with the light gathered, as it does with
 * ISO); and for a bracket, how far to lift it so it opens as bright as its middle frame (as the camera's own DR
 * modes are lifted: `dr`). @param {any} meta the first frame's @param {number} n frames @param {{ dr?: number, settings?: string, light?: number, lift?: number, finer?: number }} [more]
 *   `light`: the frames' exposure together against the first's (default: `n`, frames shot alike); `lift`: the middle frame's against the first's */
export function stackMeta(meta, n, more = {}) {
  const { light = n, lift = 1, dr = 100, finer = FINER, ...rest } = more;
  return { ...meta, black: meta.black * finer, white: meta.white * finer, iso: Math.max(1, Math.round((meta.iso || 100) / light)), frames: n, dr: Math.round(dr * lift), ...rest };
}

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
