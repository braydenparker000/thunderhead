// @ts-check
// A phone's ways for the network's passes (net-ways.js), chosen without anyone asking. The engine test page measures
// them thoroughly (net-bench.js), but nobody should have to open a test page to have the faster network: the first
// time a browser uses the network, a moment after it is compiled, this times each pass each way on a small part of
// a window and keeps the fastest that makes exactly the exported pass's result, the whole small window then made
// both ways and held to be the same to the last bit. Exactness is the whole test here: a way whose sums only round
// apart is left for the test page, which judges by the picture against full floats, and what that page kept is
// only ever replaced here by something exact and clearly faster. Done once for each set of ways (a new way in
// net-ways.js has it done again); what is kept takes effect the next time the network is compiled.
import { demosaicer, forget } from './neural.js';
import { WAYS, choose, chosen, once, tune } from './net-tune.js';

const KEY = 'th.net.auto', V = 1, SIDE = 240;
/** A way must take under this share of the time of what the pass runs now to replace it. */
export const CLEARLY = 0.85;
const kept = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

/** The fastest exact way of each pass, against the way it runs now (`now`: a number a pass, 0 as exported).
 * @param {number[]} ms each pass as exported @param {import('./net-tune.js').Tried[][]} tried @param {number[]} now */
export function exact(ms, tried, now) {
  return ms.map((own, j) => {
    const row = tried[j] || [], cur = now[j] && row[now[j] - 1]?.ms >= 0 ? row[now[j] - 1].ms : own;
    let best = now[j] && row[now[j] - 1]?.ms >= 0 ? now[j] : 0, least = CLEARLY * cur;
    for (const [k, t] of row.entries()) if (t.ms >= 0 && t.rms === 0 && t.max === 0 && !t.odd?.[1] && t.ms < least) { best = k + 1; least = t.ms; }
    return best;
  });
}

/** Chooses this browser's ways if that has not been done for the ways there are now. Gives the ways kept, or null
 * where there was nothing to do (done before; a browser driven by a test, unless `force`; nowhere to keep a choice).
 * @param {GPUDevice} device the device the network is compiled on @param {{ force?: boolean, side?: number, reps?: number }} [o] `side`, `reps`: a test asks for less @returns {Promise<number[] | null>} */
export async function autoWays(device, o = {}) {
  const kind = device.features.has('shader-f16') ? 'f16' : 'f32', was = kept();
  if (!o.force && (navigator.webdriver || (was && was.v === V && was.ways === WAYS && was.kind === kind))) return null;
  try { localStorage.setItem(KEY, JSON.stringify({ v: V, ways: WAYS, kind, at: Date.now(), way: null })); } catch { return null; }   // marked first: a browser this cannot finish on is not asked again and again
  const side = o.side || SIDE, N = 264, made = /** @type {{ destroy: () => void }[]} */ ([]);
  try {
    // a made-up mosaic: mid greys with noise on them (seeded: the same every time)
    const mosaic = new Uint16Array(N * N);
    let s = 9; for (let i = 0; i < mosaic.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; mosaic[i] = 1022 + 2000 + ((i % N) * 12) + (s >>> 22); }
    const tex = device.createTexture({ size: [N, N], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    made.push(tex);
    device.queue.writeTexture({ texture: tex }, mosaic, { bytesPerRow: N * 2 }, [N, N]);
    const info = { phase: [0, 0], black: 1022, white: 16383, wb: [1.96, 1, 1.82], noise: { a: [1e-4, 1e-4, 1e-4], b: [1e-7, 1e-7, 1e-7] } };
    const net = async (/** @type {boolean | number[]} */ ways) => { const n = await demosaicer(device, tex, info, side, side, { kept: ways }); made.push(n); return n; };
    const whole = async (/** @type {Awaited<ReturnType<typeof net>>} */ n) => {
      const enc = device.createCommandEncoder(), read = device.createBuffer({ size: side * side * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      n.run(enc, 0, 0, side, side, null, 1, 0, 0); enc.copyBufferToBuffer(n.out, 0, read, 0, side * side * 8);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const px = new Uint32Array(read.getMappedRange().slice(0));
      read.destroy();
      return px;
    };
    const plain = await net(false), now = chosen(kind, plain.parts.exported.length);
    await once(device, plain.parts.lay(side)[0]);
    const t = await tune(plain.parts, { reps: o.reps || 3 }), way = exact(t.ms, t.tried, now);
    let keep = now;
    if (way.some((w, j) => w !== now[j])) {
      // the whole small window by those ways against the exported network's: the same to the last bit, or nothing changes
      const a = await whole(plain), set = await net(way), b = set.parts.g.ops === set.parts.exported ? null : await whole(set);
      if (b && a.length === b.length && a.every((v, i) => v === b[i])) keep = way;
    }
    if (keep !== now) { choose(kind, keep); forget(device); }
    try { localStorage.setItem(KEY, JSON.stringify({ v: V, ways: WAYS, kind, at: Date.now(), way: keep })); } catch { /* the mark made at the start stands */ }
    return keep;
  } finally { for (const m of made) m.destroy(); }
}
