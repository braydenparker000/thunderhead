// Converted sound whose converter is not here (remux-audio.js). The decoder downloads only when a film needs it; when
// it was refused (three tries) the film stopped with "The audio converter could not be downloaded." about 3 s in, and
// when it was slow the first picture waited for it, since the browser plays only where every track has data
// (measured 2026-11-18: held back 8 s, the first picture came after 9 to 12 s). Now the picture waits for it at most
// GRACE seconds once its own first second is buffered; then silence is written in the sound's place, so the film plays,
// and the player is told ('converter': another track that needs no converter, or a notice, player-start.js). A
// failed download is tried again every AGAIN seconds meanwhile; when the converter arrives the sound is written over
// the silence from a second past the playhead (remux-switch.js), and the picture does not stop.

import * as MB from '../../vendor/mediabunny.js';
import {loadDecoders} from './audio-decoders.js';
import {bufferedAt} from './mse.js';
import {FLAC} from './sound-six.js';
import {stereoWriter, wholeWriter} from './sound-write.js';

export const CONVERTER = {grace: 2, again: 15}; // seconds (tests shorten them)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits for the converter `session.audio` needs. True once it is here; false when the pipeline was replaced, or when
 * silence was written in its place instead (the sound then comes by a refill once the converter arrives).
 */
export async function converterHere(session, generation, from, live) {
  const choice = session.audio, codec = choice.track.codec, v = session.queues.video;
  const watch = {state: 'loading', silent: false, told: null, loading: null};
  const load = () => watch.loading = loadDecoders(codec).then(() => {
    watch.state = 'ready';
    if (!watch.silent || !live()) return;
    session.emit('converter', {codec, ready: true});
    session.serial('refill', () => live() && session.refillAudio(choice, {join: true}));
  }, () => {
    watch.state = 'failed';
    if (watch.silent && live()) tell(); // told once more when a late converter turns out refused; then quietly tried again
    setTimeout(() => { if (live() && watch.state === 'failed') { watch.state = 'loading'; load(); } }, CONVERTER.again * 1000);
  });
  const tell = () => {
    const failed = watch.state === 'failed';
    if (watch.told === null || (failed && !watch.told)) session.emit('converter', {codec, failed});
    watch.told = watch.told || failed;
  };
  load();
  // The picture's first second at the place (the start of a film without one), then GRACE seconds more at most.
  let since = null;
  for (;;) {
    if (!live()) return false;
    if (watch.state === 'ready') return true;
    const placed = !v || bufferedAt(v.buffer, from - session.offset - session.advance, 1, session.ms?.duration || Infinity);
    if (placed) since ??= performance.now();
    if (watch.state === 'failed' || (since != null && performance.now() - since > CONVERTER.grace * 1000)) break;
    await Promise.race([watch.loading, sleep(100)]); // a converter already here answers at once
  }
  watch.silent = true;
  tell();
  await silence(session, generation, from, choice, live);
  return false;
}

/** Silent sound of the buffer's own kind, from `from` (file time), held to the read-ahead like any sound, until replaced. */
async function silence(session, generation, from, choice, live) {
  const output = session.output('audio', generation), whole = session.audioMime === FLAC;
  const channels = whole ? choice.track.channels : 2, rate = 48000, step = Math.round(rate / 10);
  const write = whole ? wholeWriter(output, channels, rate) : stereoWriter(output, rate);
  await output.start();
  for (let t = Math.max(0, from); live(); t += step / rate) {
    if (!await session.room('audio', t, generation)) break;
    const sample = new MB.AudioSample({data: new Float32Array(step * channels), format: 'f32', numberOfChannels: channels, sampleRate: rate, timestamp: t});
    await write(sample, 1);
    sample.close();
  }
  await output.cancel().catch(() => {});
}
