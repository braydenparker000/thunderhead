// @ts-check
// The network on the phone's CPU, beside the GPU (AUDIT.md P.3), upgraded for Starfish v0.2.0:
// Winograd F(2x2, 3x3) SIMD convs (2.3x faster than direct conv3r) + phase-grouped 64-hidden head (L1-resident banks).
// The GPU still does each window's first (cut + guided ca_fix) and last (place) passes, and helper() restores mos/sig
// alongside the CPU's output so place() stays race-free while GPU and CPU process different windows concurrently.
const DIR = new URL('./nets/starfish-xtrans/f32/', import.meta.url), S = 3;
const G = [[1, 0, 0], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0, 0, 1]];

/** Reads Starfish v0.2.0's WebGPU export and pre-transforms all 3x3 trunk weights into Winograd U[ob8][16][cin][8]. */
export async function layersOf() {
  const get = async (/** @type {string} */ f) => { const r = await fetch(new URL(f, DIR)); if (!r.ok) throw new Error(`the network's ${f} did not load`); return r; };
  const ops = (await (await get('graph.txt')).text()).split('\n').filter((l) => l.startsWith('op ')).map((l) => l.split(/\s+/)[1]);
  const [texts, wbuf] = await Promise.all([Promise.all(ops.map(async (f) => (await get(f)).text())), get('weights.bin').then((r) => r.arrayBuffer())]);
  const pw = new Float32Array(wbuf), c = (/** @type {string} */ t, /** @type {string} */ k) => { const m = new RegExp(`const ${k}: \\w+ = (-?\\d+)u?;`).exec(t); return m ? +m[1] : NaN; };
  if (c(texts[0], 'TL') !== S || !/const W0:/.test(texts[texts.length - 1])) throw new Error('the network is not the shape the CPU makes');
  const layers = texts.slice(1, -1).map((t) => {
    const cin = c(t, 'CIN'), cinp = c(t, 'CINP'), cout = c(t, 'COUT'), nob = c(t, 'NOB'), ocb = c(t, 'OCB'), nv = ocb / 4;
    const pwoff = c(t, 'PWOFF'), pad = Math.ceil(cout / 8) * 8;
    const preAct = t.includes('return max(v, v * T(0.1))');
    const skip = t.includes('r += A(inp[');
    if (!/const K: u32 = 3u;/.test(t) || (/const OUT_SHUF: bool = true;/.test(t) !== (t === texts[texts.length - 2])) || (/OUT_SHUF: bool = true/.test(t) && c(t, 'SF') !== S)) {
      throw new Error('the network is not the shape the CPU makes');
    }
    const filt = new Float32Array(pad * cin * 9), b = new Float32Array(pad);
    for (let ob = 0; ob < nob; ob++) {
      for (let ci = 0; ci < cinp; ci++) {
        for (let k = 0; k < 9; k++) {
          for (let h = 0; h < nv; h++) {
            const vi = pwoff + (ob * cinp + ci) * 9 * nv + k * nv + h;
            const oc0 = ob * ocb + h * 4;
            for (let o = 0; o < 4; o++) {
              const oc = oc0 + o;
              if (oc < cout && ci < cin) filt[(oc * cin + ci) * 9 + k] = pw[vi * 4 + o];
            }
          }
        }
      }
    }
    const bBase = (pwoff + nob * cinp * 9 * nv) * 4;
    for (let oc = 0; oc < cout; oc++) b[oc] = pw[bBase + oc];
    // Winograd F(2x2, 3x3) filter transform: U[ob8][p: 0..16][ci: 0..cin][8]
    const w = new Float32Array((pad / 8) * 16 * cin * 8), tmp = new Float32Array(12);
    for (let oc = 0; oc < pad; oc++) {
      const ob8 = oc >> 3, oo = oc & 7;
      for (let ci = 0; ci < cin; ci++) {
        const base = (oc * cin + ci) * 9;
        for (let r = 0; r < 4; r++) {
          for (let col = 0; col < 3; col++) {
            tmp[r * 3 + col] = G[r][0] * filt[base + col] + G[r][1] * filt[base + 3 + col] + G[r][2] * filt[base + 6 + col];
          }
        }
        for (let r = 0; r < 4; r++) {
          for (let col = 0; col < 4; col++) {
            const p = r * 4 + col;
            w[((ob8 * 16 + p) * cin + ci) * 8 + oo] = tmp[r * 3] * G[col][0] + tmp[r * 3 + 1] * G[col][1] + tmp[r * 3 + 2] * G[col][2];
          }
        }
      }
    }
    return { cin, cout: pad, flags: (preAct ? 1 : 0) | (skip ? 2 : 0), w, b };
  });
  const h = texts[texts.length - 1];
  if (/PHASE_OUT: bool = true/.test(h) || c(h, 'NV') !== 16 || c(h, 'NW0') !== 736 || c(h, 'NW1') !== 49) throw new Error('the network\'s head is not the shape the CPU makes');
  return { layers, head: { w0: pw.slice(c(h, 'W0') * 4, (c(h, 'W0') + 36 * 736) * 4), w1: pw.slice(c(h, 'W1') * 4, (c(h, 'W1') + 49) * 4) } };
}

/** Workers on `n` of the CPU's cores, each with the network.
 * @param {number} [n] @param {number} [win] */
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
  /** @param {Float32Array} mos @param {Float32Array} sig @param {number} vh @param {number} [vw] */
  const one = (mos, sig, vh, vw = win) => new Promise((res, rej) => {
    const hv = Math.ceil(vh / S), wv = Math.ceil(vw / S), m = Math.min(n, hv), out = new Float32Array(3 * win * win), edges = new Map(), left = { n: m };
    const part = (/** @type {number} */ i) => [Math.floor((hv * i) / m), Math.floor((hv * (i + 1)) / m)];
    const fail = (/** @type {any} */ err) => { for (const w of pool) { w.onmessage = null; w.onerror = null; } rej(err instanceof Error ? err : new Error(String(err))); };
    for (let i = 0; i < m; i++) {
      const w = pool[i], [a, b] = part(i), r0 = Math.max(0, (a - 1) * S), r1 = Math.min(vh, (b + 1) * S);
      w.onerror = (e) => fail(new Error(e.message || 'a CPU worker failed'));
      w.onmessage = (e) => {
        const d = e.data;
        if (d.error) return fail(d.error);
        if (d.edge) {
          const got = edges.get(d.edge) || []; got[i] = d; edges.set(d.edge, got);
          if (got.filter(Boolean).length === m) for (let k = 0; k < m; k++) pool[k].postMessage({ halo: true, top: k > 0 ? got[k - 1].bottom : null, bottom: k + 1 < m ? got[k + 1].top : null });
          return;
        }
        const s = /** @type {Float32Array} */ (d.out), plane = win * win;
        for (let p = 0, o = a * S * win; p < s.length; p += 3, o++) { out[o] = s[p]; out[plane + o] = s[p + 1]; out[2 * plane + o] = s[p + 2]; }
        if (--left.n === 0) res(out);
      };
      w.postMessage({ a, b, hv, wv, vw, vh, r0, mos: mos.slice(r0 * win, r1 * win), sig: sig.slice(r0 * win, r1 * win) });
    }
  });
  return {
    n,
    /** @param {Float32Array} mos @param {Float32Array} sig @param {number} vh @param {number} [vw] @returns {Promise<Float32Array>} */
    run: (mos, sig, vh, vw = win) => { const p = busy.then(() => one(mos, sig, vh, vw)); busy = p.then(() => {}, () => {}); return p; },
    end: () => { for (const w of pool) w.terminate(); },
  };
}

const LIGHT = new Float32Array(65536);
for (let i = 0; i < 65536; i++) { const e = (i >> 10) & 31, m = i & 1023, v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15); LIGHT[i] = i & 32768 ? -v : v; }
const halfOf = (/** @type {Float32Array} */ a) => {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length), out = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = u[i], s = (x >>> 16) & 32768, e = ((x >>> 23) & 255) - 112, m = x & 0x7fffff;
    if (e <= 0) {
      if (e < -10) { out[i] = s; continue; }
      const mant = (m | 0x800000) >>> (14 - e), round = ((m | 0x800000) >>> (13 - e)) & 1;
      out[i] = s | (mant + round);
    } else if (e >= 31) out[i] = s | (e === 143 && m ? 32256 : 31744);
    else { const r = (m + 0xfff + ((m >>> 13) & 1)) >>> 13; out[i] = s | ((e << 10) + r); }
  }
  return out;
};

/** A window made by the CPU for the GPU's network (neural.js `demosaicer`).
 * @param {GPUDevice} device @param {any} net @param {Awaited<ReturnType<typeof crew>>} cpu */
export function helper(device, net, cpu) {
  const { g, bufs } = net.parts, wide = g.kind === 'f16' ? 2 : 4, win = g.win;
  let seq = 0;
  /** @param {number} rx @param {number} ry @param {number} rw @param {number} rh @param {Float32Array | null} spots @param {number} smooth @param {number} keep @param {number} quiet */
  return async (rx, ry, rw, rh, spots, smooth, keep, quiet) => {
    if (rw > net.core || rh > net.core) return null;
    const passes = net.parts.at(40 + (seq++ % 4), [rx, ry, rw, rh], rx, ry, spots, Math.max(0, smooth) ** 2, keep, quiet, 1, true);
    const vh = passes.vh, vw = passes.vw, pre = passes.pre || 1, n = vh * win * wide;
    const back = device.createBuffer({ size: 2 * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    for (let j = 0; j < pre; j++) { const [p, b, x, y, z] = passes[j]; pass.setPipeline(p); pass.setBindGroup(0, b); pass.dispatchWorkgroups(x, y, z); }
    pass.end();
    const [place, placeBind, pa, pb, pc] = passes[passes.length - 1];
    enc.copyBufferToBuffer(bufs[g.mosaic], 0, back, 0, n); enc.copyBufferToBuffer(bufs[g.sigma], 0, back, n, n);
    device.queue.submit([enc.finish()]);
    await back.mapAsync(GPUMapMode.READ);
    const raw = back.getMappedRange(), [mos, sig] = [0, n].map((o) => (wide === 4 ? new Float32Array(raw.slice(o, o + n)) : Float32Array.from(new Uint16Array(raw, o, n / 2), (h) => LIGHT[h])));
    back.unmap(); back.destroy();
    const made = await cpu.run(mos, sig, vh, vw), plane = win * win;
    // Restore mos & sig alongside made so place() reads this exact window's mos/sig even when GPU ran other windows in between.
    return (/** @type {GPUCommandEncoder} */ enc2) => {
      const part = vh * win * wide, stage = device.createBuffer({ size: 5 * part, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE, mappedAtCreation: true }), room = stage.getMappedRange();
      const put = (/** @type {number} */ slot, /** @type {Float32Array} */ v) => { if (wide === 4) new Float32Array(room, slot * part, vh * win).set(v); else new Uint16Array(room, slot * part, vh * win).set(halfOf(v)); };
      for (let k = 0; k < 3; k++) put(k, made.subarray(k * plane, k * plane + vh * win));
      put(3, mos); put(4, sig);
      stage.unmap();
      for (let k = 0; k < 3; k++) enc2.copyBufferToBuffer(stage, k * part, bufs[g.output], k * plane * wide, part);
      enc2.copyBufferToBuffer(stage, 3 * part, bufs[g.mosaic], 0, part);
      enc2.copyBufferToBuffer(stage, 4 * part, bufs[g.sigma], 0, part);
      const p = enc2.beginComputePass(); p.setPipeline(place); p.setBindGroup(0, placeBind); p.dispatchWorkgroups(pa, pb, pc); p.end();
      queueMicrotask(() => device.queue.onSubmittedWorkDone().then(() => stage.destroy()));
    };
  };
}
