// @ts-check
// One core's part of the network on the CPU (net-cpu.js): a strip of a window's rows through every layer, in
// WebAssembly's vector maths (engine/netcpu, cpu/*.wasm). The strip is low-resolution rows a to b of the packed
// 6 x 6 grid; at each 3 x 3 layer it needs one row of its neighbours' either side, which net-cpu.js passes along
// (`edge`, answered by `halo`), and the head at full size needs one more of the last layer's.
/** @typedef {{ kind: 3 | 1, cin: number, cout: number, act: boolean, w: Float32Array, b: Float32Array }} Layer */

const S = 6, LW = 176 + 2;   // the pattern's size; a ringed low-resolution row, in pixels (the window is 1056 = 176 x 6)
let x = /** @type {any} */ (null), mem = /** @type {WebAssembly.Memory | null} */ (null);
/** @type {{ L: (Layer & { wp: number, bp: number })[], h0: number, h1: number, A: number, B: number, I: number, O: number, rows: number, win: number }} */
let at = /** @type {any} */ (null);
const f32 = (/** @type {number} */ p, /** @type {number} */ n) => new Float32Array(/** @type {WebAssembly.Memory} */ (mem).buffer, p, n);
const put = (/** @type {Float32Array} */ a) => { const p = x.room(a.length * 4 + 16); if (!p) throw new Error('no room'); f32(p, a.length).set(a); return p; };
let wake = /** @type {((h: { top: Float32Array | null, bottom: Float32Array | null }) => void) | null} */ (null);

/** Waits for the neighbours' rows of the picture at `p` (cin channels): `top` goes in the ring's first row, `bottom` in its last. */
async function trade(/** @type {number} */ stage, /** @type {number} */ p, /** @type {number} */ cin, /** @type {number} */ h) {
  const row = LW * cin, buf = f32(p, (h + 2) * row);
  self.postMessage({ edge: stage, top: buf.slice(row + cin, row + cin + 176 * cin), bottom: buf.slice(h * row + cin, h * row + cin + 176 * cin) });
  const got = await new Promise((res) => { wake = res; });
  for (const [r, v] of [[0, got.top], [h + 1, got.bottom]]) { const o = r * row + cin; if (v) buf.set(v, o); else buf.fill(0, o, o + 176 * cin); }
  for (let r = 0; r < h + 2; r++) { buf.fill(0, r * row, r * row + cin); buf.fill(0, r * row + (LW - 1) * cin, (r + 1) * row); }   // the ring's columns: zero
}

/** A strip through the network: `mos` and `sig` the window's full-size rows from `r0` (balanced, as neural.js `cut`
 * writes them), `a`..`b` this strip's low-resolution rows of the `hv` that hold the window's picture. */
async function strip(/** @type {{ a: number, b: number, hv: number, r0: number, mos: Float32Array, sig: Float32Array }} */ j) {
  const { a, b, hv, r0, mos, sig } = j, h = b - a, win = at.win, L = at.L;
  // the packed grid: for each low-resolution pixel the 36 sites of its 6 x 6 and their mean noise, rows a - 1 to b
  let cur = at.A, other = at.B;
  { const buf = f32(cur, (h + 2) * LW * 37); buf.fill(0);
    for (let r = 0; r < h + 2; r++) {
      const ly = a - 1 + r; if (ly < 0 || ly >= hv) continue;
      for (let lx = 0; lx < 176; lx++) {
        const o = (r * LW + lx + 1) * 37; let s = 0;
        for (let i = 0; i < S; i++) { const row = (ly * S + i - r0) * win + lx * S; for (let k = 0; k < S; k++) { buf[o + i * S + k] = mos[row + k]; s += sig[row + k]; } }
        buf[o + 36] = s / 36;
      }
    } }
  let stage = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.kind === 3 && i > 0) await trade(++stage, cur, l.cin, h);
    const fn = l.kind === 3 ? x.conv3r : x.conv1r;
    if (fn(cur, l.wp, l.bp, other, l.cin, l.cout, h, 176, l.act ? 1 : 0) !== 0) throw new Error(`layer ${i} refused`);
    [cur, other] = [other, cur];
  }
  const last = L[L.length - 1].cout;   // the last layer: three colours of each site of the 6 x 6, padded to a multiple of 8
  await trade(++stage, cur, last, h);   // the head at full size reads a row either side: the neighbours' last layer
  // the head's input: the estimate (the last layer laid out at full size), the mosaic and its noise, rows 6a - 1 to 6b
  const fh = h * S, rowI = (win + 2) * 5, inp = f32(at.I, (fh + 2) * rowI), src = f32(cur, (h + 2) * LW * last);
  inp.fill(0);
  for (let r = 0; r < fh + 2; r++) {
    const Y = a * S - 1 + r; if (Y < 0 || Y >= hv * S) continue;
    const lr = Math.floor(Y / S) - (a - 1), sy = Y % S, mrow = (Y - r0) * win;
    for (let X = 0; X < win; X++) {
      const p = (lr * LW + Math.floor(X / S) + 1) * last, s = sy * S + (X % S), o = r * rowI + (X + 1) * 5;
      inp[o] = src[p + s]; inp[o + 1] = src[p + 36 + s]; inp[o + 2] = src[p + 72 + s]; inp[o + 3] = mos[mrow + X]; inp[o + 4] = sig[mrow + X];
    }
  }
  if (x.head(at.I, at.h0, at.h1, at.O, fh, win, (a * S) % S, 0) !== 0) throw new Error('the head refused');
  return f32(at.O, fh * win * 3).slice();
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.halo) { const w = wake; wake = null; w?.(d); return; }
    if (d.module) {   // the module and the weights, once: the layers' weights laid in its memory, and room for the largest strip
      mem = null; x = (await WebAssembly.instantiate(d.module, {})).exports; mem = x.memory;
      const rows = d.rows, win = d.win, L = d.layers.map((/** @type {Layer} */ l) => ({ ...l, wp: put(l.w), bp: put(l.b) }));
      const big = Math.max(...L.map((/** @type {Layer} */ l) => Math.max(l.cin, l.cout)));
      const room = (/** @type {number} */ n) => { const p = x.room(n * 4 + 16); if (!p) throw new Error('no room for a strip'); return p; };
      at = { L, h0: put(d.head.w0), h1: put(d.head.w1), A: room((rows + 2) * LW * big), B: room((rows + 2) * LW * big), I: room((rows * S + 2) * (win + 2) * 5), O: room(rows * S * win * 3), rows, win };
      self.postMessage({ ready: true }); return;
    }
    const out = await strip(d);
    self.postMessage({ done: true, out }, [out.buffer]);
  } catch (err) { self.postMessage({ error: String(/** @type {any} */ (err)?.message || err) }); }
};
