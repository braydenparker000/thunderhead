// A zone plate (rings finer and finer outwards) taken down 3.77 times (7728 -> 2048) two ways: the area average the
// export uses, and a Lanczos-3 filter. Past the small picture's limit nothing should be left (what is left is moire);
// inside it, the rings should keep their contrast.
const S = 2048, ratio = 7728 / 2048, O = Math.round(S / ratio), R = S / 2;
const src = new Float32Array(S * S);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const r2 = (x - R) ** 2 + (y - R) ** 2; src[y * S + x] = 0.5 + 0.5 * Math.cos((Math.PI * r2) / (2 * R)); }   // frequency r / (2R) cycles a pixel
const box = (a, n, o) => { const out = new Float32Array(o * n), k = n / o; for (let y = 0; y < n; y++) for (let X = 0; X < o; X++) { let s = 0, w = 0; const x0 = X * k, x1 = x0 + k; for (let x = Math.floor(x0); x < Math.ceil(x1); x++) { const c = Math.min(x + 1, x1) - Math.max(x, x0); s += c * a[y * n + x]; w += c; } out[y * o + X] = s / w; } return out; };
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (A) => (a, n, o) => { const out = new Float32Array(o * n), k = n / o; for (let y = 0; y < n; y++) for (let X = 0; X < o; X++) { const c = (X + 0.5) * k - 0.5; let s = 0, w = 0; for (let x = Math.ceil(c - A * k); x <= Math.floor(c + A * k); x++) { const t = (x - c) / k, wt = sinc(t) * sinc(t / A), xx = Math.min(n - 1, Math.max(0, x)); s += wt * a[y * n + xx]; w += wt; } out[y * o + X] = s / w; } return out; };
const tr = (a, w, h) => { const t = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = a[y * w + x]; return t; };
const two = (f) => tr(f(tr(f(src, S, O), O, S), S, O), O, O);   // rows, then columns
const score = (out) => {
  const rN = (0.5 / ratio) * 2 * R / ratio;   // the radius, in the small picture, where its own limit is reached
  let alias = 0, na = 0, lo = [1, 0], hi = [1, 0];
  for (let y = 0; y < O; y++) for (let x = 0; x < O; x++) { const r = Math.hypot(x + 0.5 - O / 2, y + 0.5 - O / 2), v = out[y * O + x]; if (r > rN * 1.15 && r < O / 2) { alias += (v - 0.5) ** 2; na++; } else if (r > rN * 0.45 && r < rN * 0.55) { lo[0] = Math.min(lo[0], v); lo[1] = Math.max(lo[1], v); } else if (r > rN * 0.75 && r < rN * 0.85) { hi[0] = Math.min(hi[0], v); hi[1] = Math.max(hi[1], v); } }
  return { 'moire left past the limit (rms, of 255)': +(Math.sqrt(alias / na) * 255).toFixed(1), 'contrast kept at half the limit': +(lo[1] - lo[0]).toFixed(2), 'at 0.8 of it': +(hi[1] - hi[0]).toFixed(2) };
};
console.log('area average (the export now):', JSON.stringify(score(two(box))));
console.log('Lanczos-3                    :', JSON.stringify(score(two(lanczos(3)))));
console.log('Lanczos-2                    :', JSON.stringify(score(two(lanczos(2)))));
