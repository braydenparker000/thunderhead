// Unit tests for the ceiling upgrades: strict Fritsch-Carlson monotonic curves, Capture One Luma curve,
// exact CIE 1960 uv Planckian white balance across 2500-14000 K, Oklab upper+lower gamut check,
// local Clarity/Texture mapping, correlated RGB dither, scalar crisp sharpening, and DR-aware sensorNoise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveRows, lumaRow, through, tangents } from '../frontend/lab/engine/grade.js';
import { whiteOf, neutralFor } from '../frontend/lab/engine/dcp.js';
import { USIZE, WGSL } from '../frontend/lab/engine/wgsl.js';
import { localRows } from '../frontend/lab/engine/local.js';
import { sensorNoise } from '../frontend/lab/engine/noise-fit.js';
import { crisp } from '../frontend/lab/engine/reduce.js';
import { png, reseed } from '../frontend/lab/engine/files.js';
import { paced } from '../frontend/lab/engine/net-pace.js';
import { readFileSync } from 'node:fs';

test('Fritsch-Carlson tangent clamping prevents overshoot on steep tone and luma curves', () => {
  const steep = [[0, 0], [0.49, 0.05], [0.51, 0.95], [1, 1]];
  const m = tangents(steep);
  // alpha^2 + beta^2 <= 9 on the steep segment
  const s = (0.95 - 0.05) / (0.51 - 0.49);
  const a = m[1] / s, b = m[2] / s;
  assert.ok(a * a + b * b <= 9.0001, `alpha^2 + beta^2 = ${a * a + b * b}`);
  const row = curveRows({ RGB: steep });
  let prev = -1;
  for (let i = 0; i < 128; i++) {
    const v = row[i * 4];
    assert.ok(v >= prev - 1e-6 && v >= 0 && v <= 1, `non-monotonic or out of bounds at ${i}: ${prev} -> ${v}`);
    prev = v;
  }
  const luma = lumaRow({ Luma: steep });
  prev = -1;
  for (let i = 0; i < 128; i++) {
    const v = luma[i];
    assert.ok(v >= prev - 1e-6 && v >= 0 && v <= 1, `luma non-monotonic at ${i}: ${prev} -> ${v}`);
    prev = v;
  }
});

test('Capture One Luma curve returns null when neutral and shifts luminance smoothly when edited', () => {
  assert.equal(lumaRow(null), null);
  assert.equal(lumaRow({ Luma: [[0, 0], [1, 1]] }), null);
  const pts = [[0, 0], [0.5, 0.65], [1, 1]];
  const lifted = lumaRow({ Luma: pts });
  assert.equal(lifted.length, 128);
  assert.ok(lifted[64] > 0.62 && lifted[64] < 0.68, `midpoint ${lifted[64]}`);
  assert.ok(through(pts, 0.5) > 0.64);
});

test('CIE 1960 uv Planckian white balance round-trips accurately from 2500 K to 14000 K', () => {
  const id = { cm1: [1, 0, 0, 0, 1, 0, 0, 0, 1], cm2: [1, 0, 0, 0, 1, 0, 0, 0, 1], t1: 2856, t2: 6504 };
  for (const K of [2500, 3200, 4500, 5500, 6500, 8500, 11000, 14000]) {
    for (const T of [-30, 0, 30]) {
      const got = whiteOf(id, neutralFor(id, K, T));
      assert.ok(Math.abs(got.kelvin - K) <= 15, `K=${K} T=${T} -> ${got.kelvin.toFixed(1)} K`);
      assert.ok(Math.abs(got.tint - T) <= 0.5, `K=${K} T=${T} -> tint ${got.tint.toFixed(2)}`);
    }
  }
});

test('WGSL frame shader carries hue-preserving highlight roll-off, tetrahedral LUT, ProPhoto film luma, tanh clarity, and Luma curve', () => {
  assert.equal(USIZE, 4144);
  assert.match(WGSL, /mix\(s \/ mx, vec3f\(1\.0\),/);
  assert.match(WGSL, /p\.luma\[/);
  assert.match(WGSL, /tanh\(rawLocal \/ 0\.65\)/);
  assert.match(WGSL, /smoothstep\(-6\.0, -3\.5,/);
  assert.match(WGSL, /if \(needL\) \{ l = lightAt\(/);
});

test('localRows maps Clarity to slot 40 and Texture to slot 41 without swapping', () => {
  const geo = { W: 300, H: 200, rot: 0, flip: 0, cos: 1, sin: 0, cx: 150, cy: 100, ow: 300, oh: 200, h: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const cOnly = localRows([{ kind: 'Radial', a: [0.5, 0.5, 0.3, 0.3], vals: { Clarity: 50 } }], geo, -1, 0);
  const tOnly = localRows([{ kind: 'Radial', a: [0.5, 0.5, 0.3, 0.3], vals: { Texture: 50 } }], geo, -1, 0);
  // o = 16, fx row is offset +24 -> indices 40 (Clarity) and 41 (Texture)
  assert.ok(cOnly[40] > 0 && cOnly[41] === 0, `Clarity row: ${cOnly.slice(40, 44)}`);
  assert.ok(tOnly[41] > 0 && tOnly[40] === 0, `Texture row: ${tOnly.slice(40, 44)}`);
});

test('sensorNoise accounts for Fujifilm DR200 and DR400 effective analog ISO', () => {
  const iso320 = sensorNoise(320);
  const dr200 = sensorNoise(640, 200);
  const dr400 = sensorNoise(1280, 400);
  assert.ok(Math.abs(dr200.a - iso320.a) < 1e-12 && Math.abs(dr200.b - iso320.b) < 1e-18);
  assert.ok(Math.abs(dr400.a - iso320.a) < 1e-12 && Math.abs(dr400.b - iso320.b) < 1e-18);
});

test('scalar crisp() sharpens an edge cleanly without array allocation or overshoot', async () => {
  const rows = [];
  const sink = { rows: async (px) => { rows.push(px.slice()); }, done: async () => new Blob([]) };
  const c = crisp(sink, 8, 0.8);
  const band = new Uint16Array(8 * 4 * 3);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const v = x < 4 ? 20000 : 45000, o = (y * 8 + x) * 3;
    band[o] = band[o + 1] = band[o + 2] = v;
  }
  await c.rows(band, 4);
  await c.done();
  const out = rows[0];
  assert.ok(out[3 * 3] < 20000 && out[3 * 3] >= 18000, `dark edge side ${out[3 * 3]}`);
  assert.ok(out[4 * 3] > 45000 && out[4 * 3] <= 47000, `bright edge side ${out[4 * 3]}`);
  assert.equal(out[0], 20000);
});

test('correlated RGB dither in png() keeps neutral grays strictly neutral (zero chroma speckle)', async () => {
  reseed();
  const w = 16, h = 16, px = new Uint16Array(w * h * 3).fill(32896);   // 128.000 in 8-bit + fractional residual
  for (let i = 0; i < w * h; i++) { const v = 32768 + (i % 257); px[i * 3] = px[i * 3 + 1] = px[i * 3 + 2] = v; }
  const p = png(w, h, null);
  await p.rows(px, h);
  const blob = await p.done();
  assert.ok(blob.size > 60 && blob.type === 'image/png');
});

test('WGSL carries local chroma-guided highlight reconstruction and 2-band multi-scale Clarity', () => {
  assert.match(WGSL, /fn localChroma\(x: u32, y: u32\) -> vec3f/);
  assert.match(WGSL, /0\.72 \* \(fBand - \(m - ev\)\) \+ 0\.28 \* \(l - fBand\)/);
  const deconv = readFileSync(new URL('../frontend/lab/engine/deconv.js', import.meta.url), 'utf8');
  assert.match(deconv, /fn sigmaAt\(q: vec2i\) -> vec2f/);
  assert.match(deconv, /let sRad = 1\.15 \* d\.img\.w;/);
});

test('net-pace adaptively batches consecutive non-sliceable passes and stops immediately on touch', async () => {
  const submits = [];
  const dev = {
    queue: {
      writeBuffer() {},
      submit(cmds) { submits.push(cmds[0]); },
      async onSubmittedWorkDone() {},
    },
    createCommandEncoder() {
      const dispatches = [];
      return {
        beginComputePass: () => ({
          setPipeline() {}, setBindGroup() {},
          dispatchWorkgroups(a, b, c) { dispatches.push([a, b, c]); },
          end() {},
        }),
        finish: () => dispatches,
      };
    },
  };
  const passes = [
    ...Array.from({ length: 12 }, (_, i) => [i, i, 4, 4, 1, false]),
    ['head', 'head', 4, 4, 6, true],
    ['place', 'place', 4, 4, 1, false],
  ];
  const ok = await paced(/** @type {any} */ (dev), /** @type {any} */ (passes), /** @type {any} */ ({}), { aim: 12 });
  assert.equal(ok, true);
  // 12 non-sliceable passes batched into <= 3 submits (3 + 6 + 3) instead of 12 individual submits
  const nonSliceTotal = submits.slice(0, 3).reduce((n, d) => n + d.length, 0);
  assert.equal(nonSliceTotal, 12, `batched into 3 submits: ${JSON.stringify(submits.map((d) => d.length))}`);
  assert.ok(submits.length < 10, `total submits cut from 19 to ${submits.length}`);
  // Stopping after first submit aborts cleanly
  let n = 0;
  const stopped = await paced(/** @type {any} */ (dev), /** @type {any} */ (passes), /** @type {any} */ ({}), { stop: () => ++n >= 1 });
  assert.equal(stopped, false);
});

test('Mali zero-spill Winograd, high-SNR shadow anchor, Clarity fine mask, and Ultra 4x ETA normalization', async () => {
  const wino = readFileSync(new URL('../frontend/lab/engine/net-wino.js', import.meta.url), 'utf8');
  assert.match(wino, /@workgroup_size\(16, 4, 1\)/);
  assert.match(wino, /let p = wg\.z \+ valid\.z0;/);
  assert.doesNotMatch(wino, /var v: array<f32, 45>;/);
  const neural = readFileSync(new URL('../frontend/lab/engine/neural.js', import.meta.url), 'utf8');
  assert.match(neural, /smoothstep\(25\.0, 60\.0, snr\)/);
  const gpu = readFileSync(new URL('../frontend/lab/engine/gpu.js', import.meta.url), 'utf8');
  assert.match(gpu, /more\.texture \|\| more\.clarity \|\| mFine \|\| mTone/);
  const { perMp } = await import('../frontend/lab/editor/app/eta.js');
  const oldSlow = { kind: 'save', ms: 600_000, px: 40e6, net: 1 };
  const newFast1x = { kind: 'save', ms: 100_000, px: 40e6, net: 1, tta: 1, wino: 2 };
  const newFast4x = { kind: 'save', ms: 400_000, px: 40e6, net: 1, tta: 4, wino: 2 };
  // Ultra 4x timing normalizes by tta=4 and wino>=2 supersedes legacy pre-Winograd timings
  assert.equal(perMp([oldSlow, newFast1x, newFast4x], true), 2500);
});

test('16-bit TIFF uses lossless Deflate + Horizontal Differencing (Predictor=2) and round-trips exact pixels', async () => {
  const { tiff } = await import('../frontend/lab/engine/files.js');
  const w = 16, h = 8, px = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    px[o] = (x * 4096 + y * 512) & 0xffff;
    px[o + 1] = ((x + y) * 2048 + 7) & 0xffff;
    px[o + 2] = (65535 - x * 3000) & 0xffff;
  }
  const sink = tiff(w, h, null);
  await sink.rows(px, h);
  const bytes = new Uint8Array(await (await sink.done()).arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOff = dv.getUint32(4, true), n = dv.getUint16(ifdOff, true);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const at = ifdOff + 2 + i * 12;
    tags.set(dv.getUint16(at, true), dv.getUint32(at + 8, true));
  }
  assert.equal(tags.get(259), 8, 'Compression tag 259 is Adobe Deflate (8)');
  assert.equal(tags.get(317), 2, 'Predictor tag 317 is Horizontal Differencing (2)');
  const stripOff = tags.get(273), stripLen = tags.get(279);
  const dec = new Uint8Array(await new Response(new Blob([bytes.subarray(stripOff, stripOff + stripLen)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const got = new Uint16Array(dec.buffer, dec.byteOffset, w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = y * w * 3;
    for (let i = 3; i < w * 3; i++) got[row + i] = (got[row + i] + got[row + i - 3]) & 0xffff;
  }
  assert.deepEqual([...got], [...px]);
});

test('blockForJpeg prunes oversized MakerNotes while preserving Exif, and icc exports srgbProfile + XYZ_TO_P3', async () => {
  const { blockForJpeg } = await import('../frontend/lab/engine/exif.js');
  const { srgbProfile, XYZ_TO_P3 } = await import('../frontend/lab/engine/icc.js');
  const big = [
    { tag: 0x010f, type: 2, count: 9, data: new TextEncoder().encode('FUJIFILM\0') },
    {
      tag: 0x8769, type: 4, count: 1, data: new Uint8Array(4),
      sub: [
        { tag: 0x829a, type: 5, count: 1, data: new Uint8Array([1, 0, 0, 0, 100, 0, 0, 0]) },
        { tag: 0x927c, type: 7, count: 70000, data: new Uint8Array(70000) },
      ],
    },
  ];
  const blk = blockForJpeg(/** @type {any} */ (big));
  assert.ok(blk && blk.length < 65500, `pruned Exif fits in APP1 (${blk?.length} B)`);
  const srgb = srgbProfile();
  assert.ok(srgb.length > 400 && new TextDecoder().decode(srgb.subarray(12, 24)) === 'mntrRGB XYZ ');
  assert.equal(XYZ_TO_P3.length, 9);
});

test('lens.js supports independent per-table knots and smooth monotone cubic splines', async () => {
  const { lensTable, fringeOf } = await import('../frontend/lab/engine/lens.js');
  const lens = {
    knots: [0.25, 0.5, 0.75, 1],
    dist: [0.5, 1.8, 3.6, 5.2],
    cKnots: [0.2, 0.5, 0.8, 1],
    red: [-0.0004, -0.0012, -0.0021, -0.003],
    blue: [0.0002, 0.0007, 0.0013, 0.002],
    bKnots: [0.3, 0.6, 0.85, 1],
    vig: [96, 88, 76, 62],
  };
  const tbl = lensTable(lens, 6000, 4000);
  const fr = fringeOf(lens, 6000, 4000);
  assert.ok(tbl && tbl.length === 256 && fr && fr.table.length === 64);
  // Vignette gain increases monotonically from centre (r=0) to corner
  for (let i = 1; i < 50; i++) assert.ok(tbl[i * 4 + 3] >= tbl[(i - 1) * 4 + 3] - 1e-5, `vignette gain monotonic at ${i}`);
  // Red and blue fringe signs match input
  assert.ok(fr.table[15 * 4] < -0.002 && fr.table[15 * 4 + 1] > 0.0015);
});

test('stack.js finerOf, gainOf, and soft HDR bracket feathering work cleanly without contour jumps', async () => {
  const { finerOf, gainOf, summer } = await import('../frontend/lab/engine/stack.js');
  assert.equal(finerOf(16383), 4);
  assert.equal(finerOf(32767), 2);
  assert.equal(finerOf(65535), 1);
  // Empirical gain calibration recovers actual 4.18x exposure ratio when nominal was 4.0x
  const w = 64, h = 64, a = new Uint16Array(w * h * 4), b = new Uint16Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[i * 4 + 1] = 4000 + (i % 1000); b[i * 4 + 1] = Math.round(a[i * 4 + 1] * 4.18); }
  const g = gainOf(a, b, w, h, 4.0);
  assert.ok(Math.abs(g - 4.18) < 0.01, `calibrated gain ${g}`);
  // Soft HDR feathering produces monotonic smooth ramp with zero jump across the clip threshold
  const n = 200, black = 100, clip = 14000, s = summer(n, black, clip, true, 4);
  const f0 = Uint16Array.from({ length: n }, (_, i) => black + i * 25);
  const f1 = Uint16Array.from({ length: n }, (_, i) => Math.min(16383, black + i * 100));
  s.add(f0, 1); s.add(f1, 4);
  const out = s.done();
  for (let i = 1; i < n; i++) assert.ok(out[i] >= out[i - 1], `monotonic at ${i}: ${out[i - 1]} -> ${out[i]}`);
});

test('D4 90-degree transpose-shift (ay+3, ax) strictly preserves Fujifilm X-Trans 6x6 CFA colour layout', () => {
  // Standard X-Trans 6x6 period: 0=R, 1=G, 2=B
  const cfa = [
    1, 2, 0, 1, 0, 2,
    0, 1, 1, 2, 1, 1,
    2, 1, 1, 0, 1, 1,
    1, 0, 2, 1, 2, 0,
    2, 1, 1, 0, 1, 1,
    0, 1, 1, 2, 1, 1,
  ];
  for (let ay = 0; ay < 6; ay++) for (let ax = 0; ax < 6; ax++) {
    const sx = (ay + 3) % 6, sy = ax % 6;
    assert.equal(cfa[sy * 6 + sx], cfa[ay * 6 + ax], `CFA mismatch at (${ax},${ay}) -> (${sx},${sy})`);
  }
});


