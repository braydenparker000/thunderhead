// Music's audio engine rendered offline (frontend/music/src/dsp/engine-worklet.js in an
// OfflineAudioContext; MUSIC.md §5 "Clipping and headroom"): with a +6 dB equaliser boost, a full-scale
// signal (two sines, 100 Hz and 1 kHz, each at half scale) comes out with no sample over full scale, the
// boost's shape kept (1 kHz up 6 dB against 100 Hz as the filter's response says) and its level lowered by
// the automatic headroom; with a flat equaliser the output is the input, delayed, within float rounding,
// and the safety net does not touch it. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only', timeout: 120_000 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

/** Renders the two-sine signal (or a cosine) through cp-eq and cp-out with these bands; returns input and output (left). */
async function render(page, { bands, signal }) {
  return page.evaluate(async ({ bands, signal }) => {
    const { headroomDb } = await import('/music/src/dsp/headroom.js');
    const fs = 48000, n = fs, ac = new OfflineAudioContext(2, n, fs);
    await ac.audioWorklet.addModule('/music/src/dsp/engine-worklet.js');
    const opts = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
    const eq = new AudioWorkletNode(ac, 'cp-eq', { ...opts, numberOfInputs: 2, numberOfOutputs: 3, outputChannelCount: [2, 2, 2] });
    const out = new AudioWorkletNode(ac, 'cp-out', { ...opts, numberOfInputs: 3, numberOfOutputs: 1, outputChannelCount: [2] });
    const buf = ac.createBuffer(2, n, fs), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = signal === 'two' ? 0.5 * Math.sin(2 * Math.PI * 100 * i / fs) + 0.5 * Math.sin(2 * Math.PI * 1000 * i / fs) : Math.pow(10, -0.1 / 20) * Math.cos(2 * Math.PI * 441 * i / fs + 0.2) * (1 - i / n);
    buf.copyToChannel(x, 0); buf.copyToChannel(x, 1);
    const src = new AudioBufferSourceNode(ac, { buffer: buf });
    src.connect(eq, 0, 0); eq.connect(out, 0, 0); out.connect(ac.destination);
    const hr = headroomDb(bands, 0, fs);
    eq.port.postMessage({ type: 'state', preamp: 1, headroom: Math.pow(10, -hr / 20), bands, matrix: [1, 0, 0, 1], send: [0, 0] });
    out.port.postMessage({ type: 'state', dry: 1, wet: [0, 0], volume: 1, limiter: false });
    // Each stage has taken its state (messages arrive in order) before the render starts.
    for (const node of [eq, out]) await new Promise((r) => { node.port.onmessage = (e) => { if (e.data.type === 'pong') r(); }; node.port.postMessage({ type: 'ping', id: 1 }); });
    src.start(0);
    const y = (await ac.startRendering()).getChannelData(0);
    return { x: [...x], y: [...y], hr };
  }, { bands, signal });
}

/** Amplitude of the f Hz component over samples [a, b) (Goertzel). */
function amp(y, f, a, b, fs = 48000) {
  const w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = a; i < b; i++) { const s = y[i] + c * s1 - s2; s2 = s1; s1 = s; }
  const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
  return 2 * Math.hypot(re, im) / (b - a);
}

test('a +6 dB boost of a full-scale signal: nothing over full scale, its shape kept, lowered by the headroom; flat is the input, a −0.1 dBFS master bit for bit', opts, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/music/src/dsp/headroom.js`);
  const bands = [{ id: 'p', type: 3, f: 1000, q: 1, g: 6, ch: 0 }];
  const r = await render(page, { bands, signal: 'two' });
  assert.ok(Math.abs(r.hr - 6) < 0.01, `headroom ${r.hr} dB`);
  const over = r.y.filter((v) => Math.abs(v) > 1).length, peak = Math.max(...r.y.map(Math.abs));
  assert.equal(over, 0, `no clipped sample (peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS)`);
  // The steady part (after the glides and the filter's settling): 100 Hz and 1 kHz, as the response says.
  const { coefficientsInto } = await import('../frontend/music/src/dsp/filters.js');
  const mag = (f) => { const [b0, b1, b2, a0, a1, a2] = coefficientsInto(3, 1000, 1, 6, 48000, new Array(6)), w = 2 * Math.PI * f / 48000;
    const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w)), dr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); };
  const a = 24_000, b = 48_000, g = Math.pow(10, -r.hr / 20);
  for (const f of [100, 1000]) {
    const got = amp(r.y, f, a, b), want = 0.5 * mag(f) * g;
    assert.ok(Math.abs(20 * Math.log10(got / want)) < 0.05, `${f} Hz at ${(20 * Math.log10(got)).toFixed(2)} dB, expected ${(20 * Math.log10(want)).toFixed(2)} dB`);
  }
  // Flat: the input, delayed by the engine's constant latency, within float rounding.
  const f = await render(page, { bands: [], signal: 'cos' });
  assert.equal(f.hr, 0);
  const d = f.y.findIndex((v) => v !== 0);
  let worst = 0;
  for (let i = 0; i + d < f.y.length; i++) worst = Math.max(worst, Math.abs(f.y[i + d] - f.x[i]));
  assert.ok(d > 0 && worst <= 1e-7, `flat: delayed ${d} frames, largest difference ${worst}`);
  await page.close();
});

test('a +12 dB band stepped up and down on a near-full-scale signal: no sample over full scale and no limiter action', opts, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/music/src/dsp/headroom.js`);
  const r = await page.evaluate(async () => {
    const { headroomDb } = await import('/music/src/dsp/headroom.js');
    const fs = 48000, n = fs * 2, ac = new OfflineAudioContext(2, n, fs);
    await ac.audioWorklet.addModule('/music/src/dsp/engine-worklet.js');
    const opts = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
    const eq = new AudioWorkletNode(ac, 'cp-eq', { ...opts, numberOfInputs: 2, numberOfOutputs: 3, outputChannelCount: [2, 2, 2] });
    const out = new AudioWorkletNode(ac, 'cp-out', { ...opts, numberOfInputs: 3, numberOfOutputs: 1, outputChannelCount: [2] });
    const buf = ac.createBuffer(2, n, fs), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.99 * Math.sin(2 * Math.PI * 1000 * i / fs);
    buf.copyToChannel(x, 0); buf.copyToChannel(x, 1);
    const src = new AudioBufferSourceNode(ac, { buffer: buf });
    src.connect(eq, 0, 0); eq.connect(out, 0, 0); out.connect(ac.destination);
    const meters = [];
    const state = (g) => { const bands = [{ id: 'p', type: 3, f: 1000, q: 1, g, ch: 0 }]; eq.port.postMessage({ type: 'state', preamp: 1, headroom: Math.pow(10, -headroomDb(bands, 0, fs) / 20), bands, matrix: [1, 0, 0, 1], send: [0, 0] }); };
    state(0);
    out.port.postMessage({ type: 'state', dry: 1, wet: [0, 0], volume: 1, limiter: false });
    for (const node of [eq, out]) await new Promise((res) => { node.port.onmessage = (e) => { if (e.data.type === 'pong') res(); }; node.port.postMessage({ type: 'ping', id: 1 }); });
    out.port.onmessage = (e) => { if (e.data.type === 'meter') meters.push(e.data); };
    for (const [at, g] of [[0.5, 12], [1.2, 0]]) ac.suspend(at).then(() => { state(g); ac.resume(); });
    src.start(0);
    const y = (await ac.startRendering()).getChannelData(0);
    await new Promise((res) => setTimeout(res, 300));
    let over = 0, peak = 0;
    for (const v of y) { if (Math.abs(v) > 1) over++; peak = Math.max(peak, Math.abs(v)); }
    return { over, peak, minGain: Math.min(...meters.map((m) => m.minGain)), clamps: meters.reduce((s, m) => s + m.clamps, 0), meters: meters.length };
  });
  assert.ok(r.meters > 5, 'the limiter reported');
  assert.deepEqual({ over: r.over, minGain: r.minGain, clamps: r.clamps }, { over: 0, minGain: 1, clamps: 0 }, `peak ${r.peak}`);
  await page.close();
});
