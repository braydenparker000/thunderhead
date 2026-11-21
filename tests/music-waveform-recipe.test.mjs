// The waveform recipe handed to Muse (docs/engineering/MUSE-WAVEFORMS.md), against the phone's own
// reading of it (frontend/music/src/library/waveform.js) and the Worker's limits (backend
// areas/music/shapes.ts waveBytes: base64 of 16 to 1000 bytes, at most 1,400 characters): a made-up
// song (silence, a quiet intro, loud, a break, loud, silence) measured by the recipe is accepted, is
// not taken for a cut decode, and draws its quiet intro and break below 0.7 and its loud parts at
// 0.9 or more (MUSIC.md §2.4), each part where it is in time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barsFromMeanSquares, rmsBytesToMeanSquares, waveSteps, MIN_WAVE_STEPS, WAVE_BARS } from '../frontend/music/src/library/waveform.js';

const RATE = 48000, BINS = 1000;

/** The recipe (MUSE-WAVEFORMS.md §2): channels' samples, BINS equal spans, mean square over every sample of every channel, byte = round(255 · ms^(1/4)). */
function recipe(channels) {
  const n = channels[0].length, out = new Uint8Array(BINS);
  for (let k = 0; k < BINS; k++) {
    const a = Math.floor((k * n) / BINS), b = Math.floor(((k + 1) * n) / BINS);
    let sum = 0;
    for (const ch of channels) for (let i = a; i < b; i++) sum += ch[i] * ch[i];
    const ms = b > a ? sum / ((b - a) * channels.length) : 0;
    out[k] = Math.min(255, Math.round(255 * Math.sqrt(Math.sqrt(ms))));
  }
  return out;
}

/** A 200 s stereo song at 48 kHz, its parts as [seconds, level], each swelling slowly. */
function song() {
  const parts = [[4, 0], [30, 0.05], [60, 0.7], [20, 0.08], [80, 0.7], [6, 0]];
  const n = parts.reduce((s, [sec]) => s + sec * RATE, 0);
  const l = new Float32Array(n), r = new Float32Array(n);
  let at = 0;
  for (const [sec, level] of parts) {
    for (let i = 0; i < sec * RATE; i++, at++) {
      // A slow swell (phrases), as music has: every bin differs from the next.
      const wobble = 0.85 + 0.15 * Math.sin((2 * Math.PI * at) / (RATE * 3.7));
      l[at] = level * wobble * Math.sin((2 * Math.PI * 220 * at) / RATE);
      r[at] = level * wobble * Math.sin((2 * Math.PI * 330 * at) / RATE);
    }
  }
  return { channels: [l, r], seconds: n / RATE };
}

test('the recipe makes waveforms the Worker takes and the phone draws as MUSIC.md asks', () => {
  const { channels, seconds } = song();
  const bytes = recipe(channels);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.equal(bytes.length, 1000);
  assert.ok(b64.length >= 20 && b64.length <= 1400, `base64 is ${b64.length} characters`);
  assert.ok(waveSteps(bytes) >= MIN_WAVE_STEPS, 'not taken for a cut decode');

  const bars = barsFromMeanSquares(rmsBytesToMeanSquares(bytes));
  assert.equal(bars.length, WAVE_BARS);
  const bar = (s) => bars[Math.min(WAVE_BARS - 1, Math.floor((s / seconds) * WAVE_BARS))];
  for (const s of [1, 197]) assert.ok(bar(s) < 0.05, `silence at ${s} s draws low (${bar(s)})`);
  for (const s of [10, 25, 100]) assert.ok(bar(s) < 0.7, `the quiet part at ${s} s stays below 0.7 (${bar(s)})`);
  // Each loud section (34–94 s, 114–194 s) reaches 0.9, and all of it stands above the quiet parts.
  const span = (a, b) => Array.from({ length: b - a }, (_, i) => bar(a + i));
  for (const [a, b] of [[35, 93], [115, 193]]) {
    assert.ok(Math.max(...span(a, b)) >= 0.9, `the loud part ${a}–${b} s reaches 0.9`);
    assert.ok(Math.min(...span(a, b)) > Math.max(...span(5, 33), ...span(95, 113)), `the loud part ${a}–${b} s stands above the quiet parts`);
  }
});
