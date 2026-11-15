// The sound chain itself, on any AudioContext: louder (boost through a
// limiter), night mode (a gentle compressor), clearer speech (a lifted centre
// channel, or a lifted speech band in stereo), sound later than the picture,
// even loudness from film to film (leveller.js) and 5.1 placed around the head
// for headphones (headphone.js).
//
// In order: the mix to stereo (plain, with the centre lifted, or placed for
// headphones), the even-loudness gain, night mode, boost, the limiter, the
// delay. The loudness gain comes first so night mode's threshold meets every
// film at the same level and works the same on each; boost is the owner's own
// "louder" on top of the evened level; the limiter comes after both, so
// neither a lift nor a boost can clip.
//
// It runs from its own input gain to its own output gain, so the same chain can
// sit after a <video> element (sound.js) or inside the software decoder's own
// audio graph. With every feature off the input reaches the output through one
// gain at exactly 1: nothing changes a sample.
//
// Switching a feature on or off builds the new path beside the old one and
// crossfades: the new path runs silent for WARM seconds first (a limiter or a
// compressor just made, and the HRTF panners, need about 150 ms to reach their
// steady level, and a delay needs its own length to fill), then the two swap
// with a linear 50 ms ramp, whose weights add up to 1, so the level never goes
// above the louder of the two and nothing clicks. The old path is then let go.

import {Leveller} from './leveller.js';
import {placeSpeakers, placeable, hrtfReady} from './headphone.js';

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

/** A switch: the new path runs silent this long (seconds), then the paths swap over FADE. */
export const WARM = 0.2, FADE = 0.05;

const H = Math.SQRT1_2;
const clamp = (x, lo, hi, d) => Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : d;
const step = s => Math.round(clamp(s, 0, 2, 0));

/**
 * The settings as the chain uses them: boost 1 to 3, night on or off, dialogue 0 to 2 steps, delay 0 to 1 s,
 * and the two later switches, loudness (even loudness) and headphones (headphone surround), present only while on.
 */
export function settle(s = {}) {
  return {boost: clamp(s.boost, 1, 3, 1), night: !!s.night, dialogue: step(s.dialogue), delay: clamp(s.delay, 0, 1, 0), ...(s.loudness ? {loudness: true} : {}), ...(s.headphones ? {headphones: true} : {})};
}
export const OFF = Object.freeze(settle());
export const isOff = s => s.boost === 1 && !s.night && !s.dialogue && !s.delay && !s.loudness && !s.headphones;

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
  /**
   * @param {BaseAudioContext} ctx
   * @param {{volume?: () => number, onSettle?: (id: string, db: number) => void}} [options] for even loudness (leveller.js)
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = options;
    this.level = null; // the even-loudness meter and gain, while on
    this.start = {id: null, db: 0, known: false}; // the film playing, and where its loudness gain starts
    this.in = ctx.createGain();
    this.out = ctx.createGain();
    this.paths = []; // the path playing, last; those before it fading out
    this.path({nodes: [], from: this.in, level: null}, 0);
    this.key = 'off';
    this.ref = {};
    this.settings = OFF;
    this.channels = 0;
  }

  /** The film playing (its id) and where its loudness gain starts ({db, known}: startLevel in loudness.js). */
  film(id, {db = 0, known = false} = {}) {
    this.start = {id, db, known};
    this.level?.film(id, this.start);
  }

  /** Sets the features; `channels` is what the input really carries (0 while unknown). */
  apply(settings, channels = this.channels) {
    const s = this.settings = settle(settings);
    this.channels = channels;
    // Chromium loads its HRTF data the first time a panner is made and pans plainly until then: placed only once it is in.
    const hrtf = !!s.headphones && hrtfReady(this.ctx, () => this.apply(this.settings, this.channels));
    const phones = hrtf && placeable(channels);
    const centre = !phones && s.dialogue > 0 && hasCentre(channels), mid = s.dialogue > 0 && channels > 0 && !hasCentre(channels);
    const limit = s.boost > 1 || s.dialogue > 0 || !!s.loudness || phones;
    if (s.loudness && !this.level) { this.level = new Leveller(this.ctx, this.options); this.level.film(this.start.id, this.start); this.level.listen(this.in); this.in.connect(this.level.gain); this.key = ''; }
    if (!s.loudness && this.level) { this.level = null; this.key = ''; } // closed with the path it feeds, once that has faded out
    const key = isOff(s) ? 'off' : [(centre || phones) && channels, phones, mid, s.loudness, s.night, limit, s.delay > 0].join();
    if (key !== this.key) this.build(s, {centre, mid, limit, phones}, key);
    const {boost, peak, lifts, delay} = this.ref, t = this.ctx.currentTime, to = (p, v) => p.setTargetAtTime(v, t, 0.015);
    if (boost) to(boost.gain, s.boost);
    if (peak) to(peak.gain, STEP_DB * s.dialogue);
    if (lifts) for (const g of lifts) to(g.gain, H * centreGain(s.dialogue));
    if (delay) delay.delayTime.setTargetAtTime(s.delay, t, 0.03);
  }

  build(s, {centre, mid, limit, phones}, key) {
    const ctx = this.ctx, nodes = [], from = this.level?.gain || this.in;
    this.ref = {}; this.key = key;
    // The even-loudness gain sits before the mix (both are plain gains, so the order makes no difference) and feeds both paths.
    if (key === 'off') return this.path({nodes, from: this.in, level: null}, WARM);
    const keep = n => (nodes.push(n), n);
    const gain = (v = 1, channels = 0, interpretation = 'speakers') => {
      const g = keep(ctx.createGain());
      g.gain.value = v;
      if (channels) Object.assign(g, {channelCount: channels, channelCountMode: 'explicit', channelInterpretation: interpretation});
      return g;
    };
    let node = null, first = null;
    const then = n => { if (node) node.connect(n); else first = n; node = n; return n; };
    if (phones) {
      // Headphones: each speaker placed around the head instead of the plain mix, the centre still lifted for dialogue.
      const n = this.channels, split = keep(ctx.createChannelSplitter(n));
      then(gain(1, n, 'discrete')).connect(split);
      const placed = placeSpeakers(ctx, split, n, keep, centreGain(s.dialogue));
      this.ref.lifts = placed.lifts;
      node = placed.out;
    } else if (centre) {
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
    this.path({nodes, from, level: this.level, first, last: node}, WARM + (s.delay > 0 ? s.delay : 0));
  }

  /**
   * Puts a path in: its first node (or its fade alone) fed by `from`, its last into a fade gain into the output.
   * The fade opens after `warm` seconds as those of the paths before it close; they are let go once closed.
   */
  path(p, warm) {
    const ctx = this.ctx, t = ctx.currentTime, start = t + warm, end = start + (warm ? FADE : 0);
    p.fade = ctx.createGain();
    (p.last || p.from).connect(p.fade); p.fade.connect(this.out);
    if (p.first) p.from.connect(p.first);
    p.ramp = warm ? [start, 0, end, 1] : [0, 1, 0, 1];
    if (warm) { p.fade.gain.setValueAtTime(0, t); p.fade.gain.setValueAtTime(0, start); p.fade.gain.linearRampToValueAtTime(1, end); }
    for (const old of this.paths) {
      // Each fade is one straight ramp [t0, v0, t1, v1]: written again as it was up to the new fade's start, then down to 0 with it.
      const g = old.fade.gain, [t0, , t1] = old.ramp, at = x => rampAt(old.ramp, x);
      g.cancelScheduledValues(t); g.setValueAtTime(at(t), t);
      for (const b of [t0, t1]) if (b > t && b < start) g.linearRampToValueAtTime(at(b), b);
      g.linearRampToValueAtTime(at(start), start); g.linearRampToValueAtTime(0, end);
      old.ramp = [start, at(start), end, 0]; old.end = end;
      if (!warm) this.drop(old);
      else if (!old.timer) old.timer = this.later(old);
    }
    this.paths = [...this.paths.filter(o => warm && !o.gone), p];
  }

  // Lets an old path go once its fade has closed (by the sound's own clock, which stops while the context is suspended).
  later(old) {
    return setTimeout(() => {
      old.timer = 0;
      if (this.ctx.state !== 'closed' && this.ctx.currentTime < old.end + 0.02) { old.timer = this.later(old); return; }
      this.drop(old);
      this.paths = this.paths.filter(o => o !== old);
    }, this.ctx.state === 'running' ? Math.max(20, (old.end - this.ctx.currentTime) * 1000 + 40) : 500);
  }

  drop(old) {
    old.gone = true; clearTimeout(old.timer);
    const cut = (a, b) => { try { a.disconnect(b); } catch {} }; // a pair never joined throws
    cut(old.from, old.first || old.fade);
    for (const n of old.nodes) n.disconnect();
    old.fade.disconnect();
    if (old.level && old.level !== this.level && !this.paths.some(o => o !== old && !o.gone && o.level === old.level)) { cut(this.in, old.level.gain); old.level.close(); }
  }

  /** Back to pass-through: input to output through a gain at 1. */
  close() { this.apply(OFF); }
}

/** A fade's gain at time x on its ramp [t0, v0, t1, v1]: v0 until t0, v1 from t1, a straight line between. */
const rampAt = ([t0, v0, t1, v1], x) => x <= t0 ? v0 : x >= t1 ? v1 : v0 + (v1 - v0) * (x - t0) / (t1 - t0);

function compressor(ctx, settings, keep) {
  const c = keep(ctx.createDynamicsCompressor());
  for (const [k, v] of Object.entries(settings)) c[k].value = v;
  return c;
}
