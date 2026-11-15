// Headphone surround for the sound chain (sound-chain.js): a film's 5.1 or
// 7.1, as the browser decodes it, placed around the listener with the
// browser's own binaural rendering (PannerNode with the 'HRTF' model: the
// listener at the origin facing -z, each speaker one metre away at its
// standard angle), instead of the plain stereo mix. No outside data: the
// head-related responses are the browser's own.
//
// Each full-range channel keeps the level it has in the stereo mix (fronts 1,
// surrounds -3 dB, a channel the mix shares between both sides its summed
// power), and the centre is placed at -3 dB, as in the mix where it plays in
// both speakers, so the film is about as loud as before, dialogue keeps its
// balance against the rest, and the dialogue lift still works on the centre
// before it is placed; the bass
// channel goes to both ears equally at -6 dB through a 120 Hz low-pass.

import {stereoMatrix} from './sound-chain.js';

const H = Math.SQRT1_2;
/**
 * The placed mix's trim: Chromium's HRTF gives a speaker's sound about 2 dB more power (both ears
 * together, speech-like noise; measured: +2.1 dB at 30°, +2.0 at 110°, +1.7 at 0°) than the plain mix
 * gives it, so the placed mix is turned down 2 dB to be as loud as the plain one. With the centre's
 * -3 dB that leaves dialogue about 3 dB under the fronts, against level in the plain mix.
 */
export const TRIM = 10 ** (-2 / 20);

/** The standard angle of each channel in degrees (negative: left), in the usual order; null for the bass channel. */
export function speakerAngles(channels) {
  switch (channels) {
    case 5: return [-30, 30, 0, -110, 110];
    case 6: return [-30, 30, 0, null, -110, 110];
    case 7: return [-30, 30, 0, null, 180, -110, 110];
    case 8: return [-30, 30, 0, null, -150, 150, -90, 90];
    default: return null;
  }
}

/** True when headphone surround can place this layout: it has a centre and surrounds. */
export const placeable = channels => !!speakerAngles(channels);

const hrtf = new Map(); // sample rate → true once the browser's HRTF data is in, or the promise of it

/**
 * True when the browser's HRTF data is ready for this context's sample rate. Chromium loads it in the
 * background the first time an HRTF panner is made (about 0.4 s here), and until then its panners pass
 * the sound through unplaced, 5.7 dB louder than placed for a centre tone. An offline render waits for
 * the data, and the data is shared by sample rate, so a tiny one loads it; `then` runs once it is in.
 * Where there is no offline rendering, or it fails, the panners are used as they are.
 */
export function hrtfReady(ctx, then) {
  const rate = ctx.sampleRate, known = hrtf.get(rate);
  if (known === true) return true;
  if (!known) {
    let job;
    try {
      const o = new OfflineAudioContext(2, 256, rate), pan = new PannerNode(o, {panningModel: 'HRTF', positionX: 1});
      const src = new ConstantSourceNode(o); src.connect(pan); pan.connect(o.destination); src.start();
      job = o.startRendering();
    } catch (e) { job = Promise.reject(e); }
    hrtf.set(rate, job.then(() => hrtf.set(rate, true), () => hrtf.set(rate, true)));
  }
  hrtf.get(rate).then(() => then());
  return false;
}

/** Where a speaker at `degrees` sits, one metre from a listener facing -z (Web Audio's default): [x, y, z]. */
export function position(degrees) {
  const r = degrees * Math.PI / 180;
  return [Math.round(Math.sin(r) * 1e9) / 1e9, 0, Math.round(-Math.cos(r) * 1e9) / 1e9];
}

/** The level of each full-range channel before it is placed: its power in the stereo mix; the centre -3 dB times `centre` (the dialogue lift). */
export const speakerGain = (i, channels, centre = 1) => i === 2 ? H * centre : Math.hypot(...stereoMatrix(channels)[i]);

/**
 * Builds the placed mix from a splitter of `channels` outputs. `keep` keeps
 * each node it is handed (so the chain can disconnect it). Returns the stereo
 * node to go on from and the centre's gain nodes (for the dialogue lift).
 * @param {BaseAudioContext} ctx
 * @param {ChannelSplitterNode} split
 * @param {number} channels
 * @param {<T extends AudioNode>(n: T) => T} keep
 */
export function placeSpeakers(ctx, split, channels, keep, centre = 1) {
  const out = keep(ctx.createGain()), lifts = [];
  out.gain.value = TRIM;
  Object.assign(out, {channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
  speakerAngles(channels).forEach((angle, i) => {
    const g = keep(ctx.createGain());
    Object.assign(g, {channelCount: 1, channelCountMode: 'explicit'});
    split.connect(g, i);
    if (angle == null) {
      // The bass channel: low-passed, -6 dB, the same in both ears (a mono node into a stereo 'speakers' input is copied to both).
      g.gain.value = 0.5 / TRIM; // -6 dB after the trim
      const lp = keep(Object.assign(ctx.createBiquadFilter(), {type: 'lowpass'}));
      lp.frequency.value = 120;
      g.connect(lp); lp.connect(out);
      return;
    }
    g.gain.value = speakerGain(i, channels, centre);
    if (i === 2) lifts.push(g);
    const pan = keep(new PannerNode(ctx, {panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1, maxDistance: 10000, rolloffFactor: 0, channelCount: 1, channelCountMode: 'explicit'}));
    const [x, y, z] = position(angle);
    pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
    g.connect(pan); pan.connect(out);
  });
  return {out, lifts};
}
