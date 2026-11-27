// @ts-check
// One core's part of Starfish v0.2.0 on the CPU (net-cpu.js): a strip of a window's rows through every layer,
// using Winograd F(2x2, 3x3) SIMD (`conv3r_wino`) and phase-grouped 64-hidden head (`head64`) in WebAssembly.
/** @typedef {{ cin: number, cout: number, flags: number, w: Float32Array, b: Float32Array }} Layer */

const S = 3, PW = 352, LW = PW + 2;   // 3x3 packed tile; ringed low-res width (1056 = 352 * 3)
let x = /** @type {any} */ (null), mem = /** @type {WebAssembly.Memory | null} */ (null);
/** @type {{ L: (Layer & { wp: number, bp: number })[], h0: number, h1: number, A: number, B: number, S: number, I: number, O: number, rows: number, win: number }} */
let at = /** @type {any} */ (null);
const f32 = (/** @type {number} */ p, /** @type {number} */ n) => new Float32Array(/** @type {WebAssembly.Memory} */ (mem).buffer, p, n);
const put = (/** @type {Float32Array} */ a) => { const p = x.room(a.length * 4 + 16); if (!p) throw new Error('no room'); f32(p, a.length).set(a); return p; };
let wake = /** @type {((h: { top: Float32Array | null, bottom: Float32Array | null }) => void) | null} */ (null);

/** Exchanges top/bottom halo rows with neighbour strips and zeroes left/right border columns. */
async function trade(/** @type {number} */ stage, /** @type {number} */ p, /** @type {number} */ cin, /** @type {number} */ h, /** @type {number} */ wv) {
  const row = LW * cin, buf = f32(p, (h + 2) * row);
  self.postMessage({ edge: stage, top: buf.slice(row + cin, row + cin + PW * cin), bottom: buf.slice(h * row + cin, h * row + cin + PW * cin) });
  const got = await new Promise((res) => { wake = res; });
  for (const [r, v] of [[0, got.top], [h + 1, got.bottom]]) { const o = r * row + cin; if (v) buf.set(v, o); else buf.fill(0, o, o + PW * cin); }
  for (let r = 0; r < h + 2; r++) {
    buf.fill(0, r * row, r * row + cin);
    buf.fill(0, r * row + (wv + 1) * cin, (r + 1) * row);
  }
}

/** Runs one strip of a window through Starfish v0.2.0 (`00_prep` -> 11 Winograd 3x3 layers -> `head64`). */
async function strip(/** @type {{ a: number, b: number, hv: number, wv: number, vw: number, vh: number, r0: number, mos: Float32Array, sig: Float32Array }} */ j) {
  const { a, b, hv, wv, vw, vh, r0, mos, sig } = j, h = b - a, win = at.win, L = at.L;
  let cur = at.A, other = at.B;
  {
    const buf = f32(cur, (h + 2) * LW * 15);
    buf.fill(0);
    for (let r = 0; r < h + 2; r++) {
      const ly = a - 1 + r; if (ly < 0 || ly >= hv) continue;
      for (let lx = 0; lx < wv; lx++) {
        const o = (r * LW + lx + 1) * 15, q = (ly % 2) * 2 + (lx % 2);
        const m9 = ((9 >> q) & 1) !== 0, m6 = ((6 >> q) & 1) !== 0;
        const r0i = (ly * 3 - r0) * win + lx * 3, r1i = r0i + win, r2i = r1i + win;
        const m00 = mos[r0i], m01 = mos[r0i + 1], m02 = mos[r0i + 2];
        const m10 = mos[r1i], m11 = mos[r1i + 1], m12 = mos[r1i + 2];
        const m20 = mos[r2i], m21 = mos[r2i + 1], m22 = mos[r2i + 2];
        buf[o] = m00; buf[o + 1] = m01; buf[o + 2] = m9 ? m02 : 0; buf[o + 3] = m6 ? m02 : 0;
        buf[o + 4] = m10; buf[o + 5] = m11; buf[o + 6] = m6 ? m12 : 0; buf[o + 7] = m9 ? m12 : 0;
        buf[o + 8] = m6 ? m20 : 0; buf[o + 9] = m9 ? m20 : 0; buf[o + 10] = m9 ? m21 : 0; buf[o + 11] = m6 ? m21 : 0;
        buf[o + 12] = m22; buf[o + 13] = m6 ? 1 : 0;
        buf[o + 14] = (sig[r0i] + sig[r0i + 1] + sig[r0i + 2] + sig[r1i] + sig[r1i + 1] + sig[r1i + 2] + sig[r2i] + sig[r2i + 1] + sig[r2i + 2]) / 9;
      }
    }
  }
  let stage = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (i > 0) await trade(++stage, cur, l.cin, h, wv);
    if (x.conv3r_wino(cur, l.wp, l.bp, other, at.S, l.cin, l.cout, h, PW, l.flags) !== 0) throw new Error(`layer ${i} refused`);
    [cur, other] = [other, cur];
  }
  const last = L[L.length - 1].cout;   // 27 channels padded to 32 (3 colours x 3x3 pixel shuffle)
  await trade(++stage, cur, last, h, wv);
  const fh = h * S, rowI = (win + 2) * 5, inp = f32(at.I, (fh + 2) * rowI), src = f32(cur, (h + 2) * LW * last);
  inp.fill(0);
  for (let r = 0; r < fh + 2; r++) {
    const Y = a * S - 1 + r; if (Y < 0 || Y >= vh) continue;
    const lr = Math.floor(Y / S) - (a - 1), sy = Y % S, mrow = (Y - r0) * win;
    for (let X = 0; X < vw; X++) {
      const p = (lr * LW + Math.floor(X / S) + 1) * last, s = sy * S + (X % S), o = r * rowI + (X + 1) * 5;
      inp[o] = src[p + s]; inp[o + 1] = src[p + 9 + s]; inp[o + 2] = src[p + 18 + s]; inp[o + 3] = mos[mrow + X]; inp[o + 4] = sig[mrow + X];
    }
  }
  if (x.head64(at.I, at.h0, at.h1, at.O, fh, win, (a * S) % 6, 0) !== 0) throw new Error('the head refused');
  return f32(at.O, fh * win * 3).slice();
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.halo) { const w = wake; wake = null; w?.(d); return; }
    if (d.module) {
      mem = null; x = (await WebAssembly.instantiate(d.module, {})).exports; mem = x.memory;
      const rows = d.rows, win = d.win, L = d.layers.map((/** @type {Layer} */ l) => ({ ...l, wp: put(l.w), bp: put(l.b) }));
      const big = Math.max(...L.map((/** @type {Layer} */ l) => Math.max(l.cin, l.cout)));
      const room = (/** @type {number} */ n) => { const p = x.room(n * 4 + 16); if (!p) throw new Error('no room for a strip'); return p; };
      at = { L, h0: put(d.head.w0), h1: put(d.head.w1), A: room((rows + 2) * LW * big), B: room((rows + 2) * LW * big), S: room(16 * big * 4), I: room((rows * S + 2) * (win + 2) * 5), O: room(rows * S * win * 3), rows, win };
      self.postMessage({ ready: true }); return;
    }
    const out = await strip(d);
    self.postMessage({ done: true, out }, [out.buffer]);
  } catch (err) { self.postMessage({ error: String(/** @type {any} */ (err)?.message || err) }); }
};
