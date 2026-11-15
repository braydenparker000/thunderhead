// The sound chain itself, on any AudioContext: louder (boost through a
// limiter), night mode (a gentle compressor), clearer speech (a lifted centre
// channel, or a lifted speech band in stereo) and sound later than the picture.
// It runs from its own input gain to its own output gain, so the same chain can
// sit after a <video> element (sound.js) or inside the software decoder's own
// audio graph. With every feature off the input is wired straight to the
// output: nothing touches a sample.

/** Decibels one dialogue step adds (to the centre channel, or to the speech band in stereo). */
export const STEP_DB = 4;
/**
 * Night mode: from -30 dB the level rises a third as fast (3:1), with a 12 dB
 * soft knee so the change is not heard as pumping; 5 ms attack catches a bang,
 * 250 ms release lets speech come back up between words. The compressor adds
 * its own make-up gain (the Web Audio spec's (1/gain at 0 dB)^0.6), about
 * +10 dB here, so no extra make-up gain is added. Measured in Chromium with a
 * steady tone: -50 dB in comes out at -40, -30 at -21, -20 at -15, -10 at
 * -11.5 and 0 dB at -8: quiet sound up 10 dB, a full-scale bang down 8, a
 * 50 dB range squeezed into 32.
 */
export const NIGHT = {threshold: -30, knee: 12, ratio: 3, attack: 0.005, release: 0.25};
/** The limiter after boost: from -1 dBFS at 20:1 with a hard knee and a fast attack (Chrome's compressor also looks 6 ms ahead). */
export const LIMIT = {threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.1};
/** The speech band lifted in stereo: a peaking filter at 2 kHz two octaves wide (about 1 to 4 kHz). */
export const SPEECH = {frequency: 2000, Q: 0.7};

const H = Math.SQRT1_2;
const clamp = (x, lo, hi, d) => Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : d;
const step = s => Math.round(clamp(s, 0, 2, 0));

/** The settings as the chain uses them: boost 1 to 3, night on or off, dialogue 0 to 2 steps, delay 0 to 1 s. */
export function settle(s = {}) {
  return {boost: clamp(s.boost, 1, 3, 1), night: !!s.night, dialogue: step(s.dialogue), delay: clamp(s.delay, 0, 1, 0)};
}
export const OFF = Object.freeze(settle());
export const isOff = s => s.boost === 1 && !s.night && !s.dialogue && !s.delay;

/**
 * The gain on the centre channel for a dialogue step (0, 1 or 2): 1, +4 dB,
 * +8 dB. Pure, so the engine's own 5.1 mix (downmix.js) can use it too.
 */
export const centreGain = s => 10 ** (STEP_DB * step(s) / 20);

/** True when a layout of this many channels has a centre speaker (3, 5, 6, 7 or 8 channels). */
export const hasCentre = channels => channels === 3 || channels >= 5;

/**
 * How each channel reaches the left and right speakers: one [left, right]
 * pair per channel, in the usual order (L R C LFE SL SR …). The same mix as
 * the engine's downmix.js and as the browser's own 5.1 and quad down-mix:
 * centre and surrounds at -3 dB on their side, the bass channel left out.
 * `centre` scales the centre speaker.
 * @returns {number[][]}
 */
export function stereoMatrix(channels, centre = 1) {
  const C = [H * centre, H * centre];
  switch (channels) {
    case 1: return [[1, 1]];
    case 2: return [[1, 0], [0, 1]];
    case 3: return [[1, 0], [0, 1], C];
    case 4: return [[0.5, 0], [0, 0.5], [0.5, 0], [0, 0.5]];
    case 5: return [[1, 0], [0, 1], C, [H, 0], [0, H]];
    case 6: return [[1, 0], [0, 1], C, [0, 0], [H, 0], [0, H]];
    case 7: return [[1, 0], [0, 1], C, [0, 0], [0.5, 0.5], [H, 0], [0, H]];
    default: return [[1, 0], [0, 1], C, [0, 0], [0.5, 0], [0, 0.5], [0.5, 0], [0, 0.5]];
  }
}

/**
 * The make-up gain a DynamicsCompressorNode applies by itself, by the Web
 * Audio spec: (1 / its gain for a full-scale input) ^ 0.6. Exact for a hard
 * knee (the limiter's +0.57 dB, matched by Chromium); a soft knee lowers it.
 */
export function makeupGain({threshold, ratio}) {
  const out = threshold + (0 - threshold) / ratio; // dB out for 0 dB in
  return (10 ** (-out / 20)) ** 0.6;
}

export class SoundChain {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.in = ctx.createGain();
    this.out = ctx.createGain();
    this.in.connect(this.out);
    this.nodes = [];
    this.key = 'off';
    this.ref = {};
    this.settings = OFF;
    this.channels = 0;
  }

  /** Sets the features; `channels` is what the input really carries (0 while unknown). */
  apply(settings, channels = this.channels) {
    const s = this.settings = settle(settings);
    this.channels = channels;
    const centre = s.dialogue > 0 && hasCentre(channels), mid = s.dialogue > 0 && channels > 0 && !hasCentre(channels);
    const limit = s.boost > 1 || s.dialogue > 0;
    const key = isOff(s) ? 'off' : [centre && channels, mid, s.night, limit, s.delay > 0].join();
    if (key !== this.key) this.build(s, {centre, mid, limit}, key);
    const {boost, peak, lifts, delay} = this.ref, t = this.ctx.currentTime;
    if (boost) boost.gain.value = s.boost;
    if (peak) peak.gain.value = STEP_DB * s.dialogue;
    if (lifts) for (const g of lifts) g.gain.value = H * centreGain(s.dialogue);
    if (delay) delay.delayTime.setTargetAtTime(s.delay, t, 0.03);
  }

  build(s, {centre, mid, limit}, key) {
    const ctx = this.ctx;
    this.in.disconnect();
    for (const n of this.nodes) n.disconnect();
    this.nodes = []; this.ref = {}; this.key = key;
    if (key === 'off') { this.in.connect(this.out); return; }
    const keep = n => (this.nodes.push(n), n);
    const gain = (v = 1, channels = 0, interpretation = 'speakers') => {
      const g = keep(ctx.createGain());
      g.gain.value = v;
      if (channels) Object.assign(g, {channelCount: channels, channelCountMode: 'explicit', channelInterpretation: interpretation});
      return g;
    };
    let node = this.in;
    const then = n => { node.connect(n); node = n; return n; };
    if (centre) {
      // The browser would mix 5.1 down only after this chain, so mix it here, with the centre raised.
      const n = this.channels, split = keep(ctx.createChannelSplitter(n)), merge = keep(ctx.createChannelMerger(2));
      then(gain(1, n, 'discrete')).connect(split);
      this.ref.lifts = [];
      stereoMatrix(n).forEach((pair, i) => pair.forEach((v, side) => {
        if (!v) return;
        const g = gain(v);
        if (i === 2) this.ref.lifts.push(g);
        split.connect(g, i); g.connect(merge, 0, side);
      }));
      node = merge;
    } else if (mid) {
      // Stereo: lift the speech band of what both sides share (L+R), leave the difference (L-R) alone.
      const split = keep(ctx.createChannelSplitter(2)), merge = keep(ctx.createChannelMerger(2));
      then(gain(1, 2)).connect(split);
      const sum = gain(1, 1), diff = gain(1, 1), flip = gain(-1, 1);
      const peak = this.ref.peak = keep(Object.assign(ctx.createBiquadFilter(), {type: 'peaking'}));
      Object.assign(peak, {channelCount: 1, channelCountMode: 'explicit'});
      peak.frequency.value = SPEECH.frequency; peak.Q.value = SPEECH.Q;
      [[0, sum, 0.5], [1, sum, 0.5], [0, diff, 0.5], [1, diff, -0.5]].forEach(([i, to, v]) => { const g = gain(v, 1); split.connect(g, i); g.connect(to); });
      sum.connect(peak);
      peak.connect(merge, 0, 0); peak.connect(merge, 0, 1);
      diff.connect(merge, 0, 0); diff.connect(flip); flip.connect(merge, 0, 1);
      node = merge;
    }
    if (s.night) then(compressor(ctx, NIGHT, keep));
    if (s.boost > 1) this.ref.boost = then(gain(s.boost));
    if (limit) { then(compressor(ctx, LIMIT, keep)); then(gain(1 / makeupGain(LIMIT))); }
    if (s.delay > 0) { this.ref.delay = then(keep(ctx.createDelay(1))); this.ref.delay.delayTime.value = s.delay; }
    node.connect(this.out);
  }

  /** Back to pass-through: input wired straight to output. */
  close() { this.apply(OFF); }
}

function compressor(ctx, settings, keep) {
  const c = keep(ctx.createDynamicsCompressor());
  for (const [k, v] of Object.entries(settings)) c[k].value = v;
  return c;
}
