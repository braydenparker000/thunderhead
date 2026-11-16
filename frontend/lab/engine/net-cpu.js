// @ts-check
// The network on the phone's CPU, beside the GPU (AUDIT.md P.3). An export by the network is about 46 windows of the
// sensor, and on the owner's 4 GB phone 109 of its 119 seconds are the GPU making them; measured on that phone, the
// CPU's cores and the GPU at once get through 1.74 times what the GPU does alone (net-both.js). So an export hands
// some of its windows to the CPU (export.js). The GPU still does each window's first and last pass (neural.js `cut`
// and `place`: the retouched spots, the lens's fringing laid right, the noise each site is told of, the grain put
// back, the clipped colours), so a window made here is the same picture as one made there: only the network's own
// layers run on the CPU, here in full floats (the GPU's are half floats on a phone; the two agree to well under a
// level of 255). Each of the CPU's cores takes a strip of the window's rows (net-cpu-worker.js), and at each 3 x 3
// layer they trade the one row either side they need of each other's.
const DIR = new URL('./nets/starfish-xtrans/f32/', import.meta.url), S = 6;

/** The network's layers as the CPU takes them, read from its WebGPU export (each pass's constants and its weights,
 * re-laid: a 3 x 3 layer's for each 8 outputs, each tap, each input, 8 weights; a 1 x 1's for each 8 outputs, each
 * input, 8 weights; outputs padded to a multiple of 8). Throws for an export of another shape. */
export async function layersOf() {
  const get = async (/** @type {string} */ f) => { const r = await fetch(new URL(f, DIR)); if (!r.ok) throw new Error(`the network's ${f} did not load`); return r; };
  const ops = (await (await get('graph.txt')).text()).split('\n').filter((l) => l.startsWith('op ')).map((l) => l.split(/\s+/)[1]);
  const [texts, wbuf] = await Promise.all([Promise.all(ops.map(async (f) => (await get(f)).text())), get('weights.bin').then((r) => r.arrayBuffer())]);
  const pw = new Float32Array(wbuf), c = (/** @type {string} */ t, /** @type {string} */ k) => { const m = new RegExp(`const ${k}: \\w+ = (-?\\d+)u?;`).exec(t); return m ? +m[1] : NaN; };
  if (!/fn main[\s\S]*TL \* TL/.test(texts[0]) || !/const W0:/.test(texts[texts.length - 1])) throw new Error('the network is not the shape the CPU makes');
  const layers = texts.slice(1, -1).map((t) => {
    const cin = c(t, 'CIN'), cinp = c(t, 'CINP'), cout = c(t, 'COUT'), off = c(t, 'PWOFF') * 4, three = /const K: u32 = 3u;/.test(t), act = /const ACT: bool = true;/.test(t), pad = Math.ceil(cout / 8) * 8;
    const w = new Float32Array(pad * cin * (three ? 9 : 1)), b = new Float32Array(pad);
    if (three) {   // the GPU's: ((block of 8 · CINP + input) · 9 + tap) · 8 + output
      for (let oc = 0; oc < cout; oc++) for (let i = 0; i < cin; i++) for (let k = 0; k < 9; k++) w[(((oc >> 3) * 9 + k) * cin + i) * 8 + (oc & 7)] = pw[off + (((oc >> 3) * cinp + i) * 9 + k) * 8 + (oc & 7)];
      for (let oc = 0; oc < cout; oc++) b[oc] = pw[off + c(t, 'NOB') * cinp * 9 * 8 + oc];
    } else {   // the GPU's: (group of 32 · CINP + input) · 32 + output
      for (let oc = 0; oc < cout; oc++) for (let i = 0; i < cin; i++) w[((oc >> 3) * cin + i) * 8 + (oc & 7)] = pw[off + ((oc >> 5) * cinp + i) * 32 + (oc & 31)];
      for (let oc = 0; oc < cout; oc++) b[oc] = pw[off + c(t, 'NOG') * cinp * 32 + oc];
    }
    if (/const OUT_SHUF: bool = true;/.test(t) !== (t === texts[texts.length - 2]) || (/OUT_SHUF: bool = true/.test(t) && c(t, 'SF') !== S)) throw new Error('the network is not the shape the CPU makes');
    return { kind: three ? 3 : 1, cin, cout: pad, act, w, b };
  });
  const h = texts[texts.length - 1];
  if (/PHASE_OUT: bool = true/.test(h) || c(h, 'NV') !== 8 || c(h, 'NW0') !== 368 || c(h, 'NW1') !== 25) throw new Error('the network\'s head is not the shape the CPU makes');
  return { layers, head: { w0: pw.slice(c(h, 'W0') * 4, (c(h, 'W0') + 36 * 368) * 4), w1: pw.slice(c(h, 'W1') * 4, (c(h, 'W1') + 25) * 4) } };
}

/** Workers on `n` of the CPU's cores (all but two by default: the GPU's driver wants some), each with the network.
 * `run` makes a window's colours from its packed mosaic and noise, as the GPU's own layers would: three planes of
 * win x win, the first `vh` rows filled. @param {number} [n] @param {number} [win] */
export async function crew(n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 2)), win = 1056) {
  const net = await layersOf(), fused = await WebAssembly.compileStreaming(fetch(new URL('./cpu/conv-fused.wasm', import.meta.url))).catch(() => null);
  const module = fused || (await WebAssembly.compileStreaming(fetch(new URL('./cpu/conv.wasm', import.meta.url))));
  const rows = Math.ceil(win / S / n), pool = /** @type {Worker[]} */ ([]);
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./net-cpu-worker.js', import.meta.url), { type: 'module' });
      pool.push(w);
      await new Promise((res, rej) => { w.onmessage = (e) => (e.data.error ? rej(new Error(e.data.error)) : res(null)); w.onerror = (e) => rej(new Error(e.message || 'the worker did not start')); w.postMessage({ module, rows, win, ...net }); });
    }
  } catch (err) { for (const w of pool) w.terminate(); throw err; }
  let busy = Promise.resolve();
  /** @param {Float32Array} mos @param {Float32Array} sig the window's first `vh` rows, win wide @param {number} vh */
  const one = (mos, sig, vh) => new Promise((res, rej) => {
    const hv = Math.ceil(vh / S), m = Math.min(n, hv), out = new Float32Array(3 * win * win), edges = new Map(), left = { n: m };
    const part = (/** @type {number} */ i) => [Math.floor((hv * i) / m), Math.floor((hv * (i + 1)) / m)];
    const fail = (/** @type {any} */ err) => { for (const w of pool) { w.onmessage = null; w.onerror = null; } rej(err instanceof Error ? err : new Error(String(err))); };
    for (let i = 0; i < m; i++) {
      const w = pool[i], [a, b] = part(i), r0 = Math.max(0, (a - 1) * S), r1 = Math.min(vh, (b + 1) * S);
      w.onerror = (e) => fail(new Error(e.message || 'a CPU worker failed'));
      w.onmessage = (e) => {
        const d = e.data;
        if (d.error) return fail(d.error);
        if (d.edge) {   // a strip's first and last rows at a 3 x 3 layer: once all are in, each strip is given its neighbours'
          const got = edges.get(d.edge) || []; got[i] = d; edges.set(d.edge, got);
          if (got.filter(Boolean).length === m) for (let k = 0; k < m; k++) pool[k].postMessage({ halo: true, top: k > 0 ? got[k - 1].bottom : null, bottom: k + 1 < m ? got[k + 1].top : null });
          return;
        }
        const s = /** @type {Float32Array} */ (d.out), plane = win * win;   // red, green and blue a pixel, laid into the three planes
        for (let p = 0, o = a * S * win; p < s.length; p += 3, o++) { out[o] = s[p]; out[plane + o] = s[p + 1]; out[2 * plane + o] = s[p + 2]; }
        if (--left.n === 0) res(out);
      };
      w.postMessage({ a, b, hv, r0, mos: mos.slice(r0 * win, r1 * win), sig: sig.slice(r0 * win, r1 * win) });
    }
  });
  return {
    n,
    /** One window at a time (the workers are all on it). @param {Float32Array} mos @param {Float32Array} sig @param {number} vh @returns {Promise<Float32Array>} */
    run: (mos, sig, vh) => { const p = busy.then(() => one(mos, sig, vh)); busy = p.then(() => {}, () => {}); return p; },
    end: () => { for (const w of pool) w.terminate(); },
  };
}

const LIGHT = new Float32Array(65536);
for (let i = 0; i < 65536; i++) { const e = (i >> 10) & 31, m = i & 1023, v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15); LIGHT[i] = i & 32768 ? -v : v; }
const halfOf = (/** @type {Float32Array} */ a) => { const u = new Uint32Array(a.buffer, a.byteOffset, a.length), out = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) { const x = u[i], s = (x >>> 16) & 32768, e = ((x >>> 23) & 255) - 112, m = (x >>> 13) & 1023; out[i] = s | (e <= 0 ? 0 : e >= 31 ? 31744 : (e << 10) | m); }
  return out; };

/** A window made by the CPU for the GPU's network (neural.js `demosaicer`): `ahead` runs the window's first pass on the
 * GPU, reads its packed mosaic back and has the CPU make the colours; what it gives encodes the rest (the colours
 * written where the network's own would be, and the last pass) into a frame's commands, in place of `run`. Null for
 * a rectangle larger than one window. @param {GPUDevice} device @param {any} net @param {Awaited<ReturnType<typeof crew>>} cpu */
export function helper(device, net, cpu) {
  const { g, bufs } = net.parts, wide = g.kind === 'f16' ? 2 : 4, win = g.win;
  let seq = 0;
  /** @param {number} rx @param {number} ry @param {number} rw @param {number} rh @param {Float32Array | null} spots @param {number} smooth @param {number} keep @param {number} quiet */
  return async (rx, ry, rw, rh, spots, smooth, keep, quiet) => {
    if (rw > net.core || rh > net.core) return null;
    const passes = net.parts.at(40 + (seq++ % 4), [rx, ry, rw, rh], rx, ry, spots, Math.max(0, smooth) ** 2, keep, quiet), vh = passes.vh, n = vh * win * wide;
    const back = device.createBuffer({ size: 2 * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    const [cut, cutBind, a, b, c] = passes[0], [place, placeBind, pa, pb, pc] = passes[passes.length - 1];
    pass.setPipeline(cut); pass.setBindGroup(0, cutBind); pass.dispatchWorkgroups(a, b, c); pass.end();
    enc.copyBufferToBuffer(bufs[g.mosaic], 0, back, 0, n); enc.copyBufferToBuffer(bufs[g.sigma], 0, back, n, n);
    device.queue.submit([enc.finish()]);
    await back.mapAsync(GPUMapMode.READ);
    const raw = back.getMappedRange(), [mos, sig] = [0, n].map((o) => (wide === 4 ? new Float32Array(raw.slice(o, o + n)) : Float32Array.from(new Uint16Array(raw, o, n / 2), (h) => LIGHT[h])));
    back.unmap(); back.destroy();
    const made = await cpu.run(mos, sig, vh), plane = win * win;
    // the colours go in by a copy recorded with the frame's own commands, so they land in order with whatever else it does
    return (/** @type {GPUCommandEncoder} */ enc2) => {
      const part = vh * win * wide, stage = device.createBuffer({ size: 3 * part, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE, mappedAtCreation: true }), room = stage.getMappedRange();
      for (let k = 0; k < 3; k++) { const v = made.subarray(k * plane, k * plane + vh * win); if (wide === 4) new Float32Array(room, k * part, vh * win).set(v); else new Uint16Array(room, k * part, vh * win).set(halfOf(v)); }
      stage.unmap();
      for (let k = 0; k < 3; k++) enc2.copyBufferToBuffer(stage, k * part, bufs[g.output], k * plane * wide, part);
      const p = enc2.beginComputePass(); p.setPipeline(place); p.setBindGroup(0, placeBind); p.dispatchWorkgroups(pa, pb, pc); p.end();
      queueMicrotask(() => device.queue.onSubmittedWorkDone().then(() => stage.destroy()));   // (the frame is submitted in the same task)
    };
  };
}
