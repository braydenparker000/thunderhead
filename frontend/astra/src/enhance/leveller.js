// Even loudness in the sound chain (sound-chain.js): a meter on the chain's
// input (an AudioWorklet, loaded from a blob: URL like sound.js's channel
// counter) measures the film's programme loudness as BS.1770 does
// (loudness.js), and a gain further down moves smoothly towards the level
// that brings it to the target.
//
// The meter runs before any feature, so what it measures is the film, not
// what Boost, Night mode or the gain itself made of it. The element's volume
// is applied before the chain (Chromium scales a MediaElementSource by it), so
// each step is divided by the volume squared: the volume swipe stays the
// owner's, rather than being measured as a quieter film and lifted back.

import {kWeighting, kSquares, channelWeights, Gate, wantedGain, nextGain, SETTLED} from './loudness.js';

const STEP = 0.1; // seconds of sound in one meter step
const SAVE_EVERY = 300; // measured blocks between two saves of the settled gain (30 s)

// Posts the weighted mean square of each step of whole render quanta (about 100 ms).
const METER = `const kSquares = ${kSquares.toString()};
registerProcessor('astra-loudness', class extends AudioWorkletProcessor {
  constructor(o) { super(); const p = o.processorOptions; this.k = p.k; this.w = p.weights; this.len = p.len; this.n = -1; this.sum = 0; this.done = 0; }
  process(inputs) {
    const ins = inputs[0] || [], n = ins.length, w = this.w[n] || [];
    if (n !== this.n) { this.n = n; this.states = ins.map(() => new Float64Array(4)); }
    for (let c = 0; c < n; c++) if (w[c]) this.sum += w[c] * kSquares(ins[c], this.k, this.states[c]);
    this.done += 128;
    if (this.done >= this.len) { this.port.postMessage(this.sum / this.done); this.sum = 0; this.done = 0; }
    return true;
  }
});`;

const loaded = new WeakMap(); // context → the module's promise

function load(ctx) {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([METER], {type: 'text/javascript'}));
    loaded.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
  }
  return loaded.get(ctx);
}

export class Leveller {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{volume?: () => number, onSettle?: (id: string, db: number) => void}} [options]
   *   volume: the gain applied before the chain's input (the element's volume); onSettle: a film's settled gain, to remember
   */
  constructor(ctx, {volume, onSettle} = {}) {
    this.ctx = ctx;
    this.volume = volume || (() => 1);
    this.onSettle = onSettle || (() => {});
    this.gain = ctx.createGain(); // where the chain puts it: after the mix, before night, boost and the limiter
    this.gate = new Gate();
    this.db = 0; this.known = false; this.id = null; this.saved = 0;
    this.meter = null; this.input = null; this.closed = false;
  }

  /** A film or episode opens: the measure begins afresh, from the title's remembered gain or a guess. */
  film(id, {db = 0, known = false} = {}) {
    this.settle();
    this.id = id; this.gate.reset(); this.saved = 0;
    this.known = known; this.set(db, 0.05);
  }

  /** Measures `input` (the chain's input node); called again after every rebuild, which disconnects it. */
  listen(input) {
    this.input = input;
    if (this.meter) { input.connect(this.meter); return; }
    if (this.loading) return;
    this.loading = true;
    load(this.ctx).then(() => {
      if (this.closed) return;
      const len = Math.max(128, Math.round(this.ctx.sampleRate * STEP / 128) * 128), weights = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(channelWeights);
      this.meter = new AudioWorkletNode(this.ctx, 'astra-loudness', {numberOfOutputs: 0, channelCountMode: 'max', processorOptions: {k: kWeighting(this.ctx.sampleRate), weights, len}});
      this.meter.port.onmessage = e => this.step(e.data, len / this.ctx.sampleRate);
      this.input?.connect(this.meter);
    }, () => {}); // no worklet: the gain stays where the film started (its remembered gain, or the guess)
  }

  step(z, dt) {
    const v = this.volume();
    if (!(v > 0.01)) return; // muted: nothing to measure
    if (!this.gate.step(z / (v * v))) return;
    const loudness = this.gate.integrated;
    if (loudness == null) return;
    this.set(nextGain(this.db, wantedGain(loudness), this.gate.seconds, dt, this.known), dt);
    if (this.gate.blocks >= SETTLED * 10 * 3 && this.gate.blocks - this.saved >= SAVE_EVERY) this.settle();
  }

  set(db, ramp) {
    if (db === this.db && ramp) return;
    this.db = db;
    const g = this.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(10 ** (db / 20), t + ramp);
  }

  /** Hands on the gain once the film has been measured long enough (30 s) to be worth remembering. */
  settle() {
    if (this.id && this.gate.blocks >= SETTLED * 10 * 3) { this.saved = this.gate.blocks; this.onSettle(this.id, this.db); }
  }

  close() {
    this.settle();
    this.closed = true;
    this.meter?.disconnect(); this.meter = null;
    this.gain.disconnect();
  }
}
