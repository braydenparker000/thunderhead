// How well a heal's correction matches a spot to its surroundings, tried in plain code: node heal.mjs <crop.bin> [spots]
// Many spots are placed at random on the known picture, each with a source 2.4 radii away. The source is brought to the
// spot's surroundings from samples on a ring round both (as frontend/lab/engine/heal.js does it), and the result is
// compared with what is really there, smoothed (texture is meant to differ; brightness and colour are not): over the
// whole spot, and along its rim, where a mismatch shows as a seam. `order` 1 is a tilted plane; higher orders let the
// correction bend, as a membrane stretched on the ring would (a disc's harmonic functions, r^n cos and sin of n times the angle).
import fs from 'node:fs';
const bin = process.argv[2], N = +(process.argv[3] || 300), j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K;
const t = new Float32Array(fs.readFileSync(bin.replace(/\.bin$/, '.truth.f32')).buffer.slice(0)), RING = 16, OUT = 1.2;
const around = (x, y, c) => { let s = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) s += t[(Math.min(h - 1, Math.max(0, Math.round(y) + v)) * w + Math.min(w - 1, Math.max(0, Math.round(x) + u))) * 3 + c]; return s / 9; };
const smooth = (f, x, y) => { let s = 0, n = 0; for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) { s += f(x + u, y + v); n++; } return s / n; };
let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (const order of [0, 1, 2, 3, 5]) {
  let all = 0, rim = 0, n = 0; seed = 7;
  for (let k = 0; k < N; k++) {
    const r = 10 + rnd() * 20, cx = 120 + rnd() * (w - 240), cy = 120 + rnd() * (h - 240), ang = rnd() * 6.283, ox = Math.round(2.4 * r * Math.cos(ang)), oy = Math.round(2.4 * r * Math.sin(ang));
    for (let c = 0; c < 3; c++) {
      const L = []; for (let i = 0; i < RING; i++) { const a = (i / RING) * 6.283185, x = cx + OUT * r * Math.cos(a), y = cy + OUT * r * Math.sin(a); L.push(Math.log2((around(x, y, c) + 1e-3) / (around(x + ox, y + oy, c) + 1e-3))); }
      const A = [L.reduce((p, q) => p + q) / RING], B = [0];
      for (let m = 1; m <= order; m++) { let a = 0, b = 0; for (let i = 0; i < RING; i++) { const th = (i / RING) * 6.283185; a += L[i] * Math.cos(m * th); b += L[i] * Math.sin(m * th); } A.push((2 * a) / RING / OUT ** m); B.push((2 * b) / RING / OUT ** m); }
      const gain = (ex, ey) => { const rr = Math.hypot(ex, ey), th = Math.atan2(ey, ex); let g = A[0]; for (let m = 1; m <= order; m++) g += rr ** m * (A[m] * Math.cos(m * th) + B[m] * Math.sin(m * th)); return 2 ** g; };
      const healed = (x, y) => { const ex = (x - cx) / r, ey = (y - cy) / r; return Math.hypot(ex, ey) < 1 ? t[((Math.round(y) + oy) * w + Math.round(x) + ox) * 3 + c] * gain(ex, ey) : t[(Math.round(y) * w + Math.round(x)) * 3 + c]; };
      const real = (x, y) => t[(Math.round(y) * w + Math.round(x)) * 3 + c];
      for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283185; for (const rr of [0.3, 0.6, 0.95]) { const x = cx + rr * r * Math.cos(a), y = cy + rr * r * Math.sin(a), e = Math.abs(Math.log2((smooth(healed, x, y) + 1e-3) / (smooth(real, x, y) + 1e-3))); all += e; if (rr > 0.9) rim += e; n++; } }
    }
  }
  console.log(`order ${order}: mean error ${(all / n).toFixed(4)} stops over the spot, ${(rim / (n / 3)).toFixed(4)} at its rim`);
}
