// The sound side of a re-wrapped film (remux.js): reads the chosen track from
// `from` (file time) and writes it to the audio SourceBuffer, either re-wrapped
// as it is ('direct') or decoded, mixed to stereo here (downmix.js, with the
// centre raised for clearer dialogue) and encoded to Opus ('rebuilt'). The
// sound tap (sound-tap.js) is handed what passes, when one is set.

import * as MB from '../../vendor/mediabunny.js';
import {mixable} from './downmix.js';
import {stereoSample} from './fragments.js';
import {loadDecoders} from './audio-decoders.js';

/**
 * Runs one audio pipeline for `session` (a RemuxSession) until it ends, is replaced (a newer generation, another
 * track) or the session closes.
 */
export async function pumpAudio(session, generation, from, inOrder) {
  const choice = session.audio, track = choice.track.ref;
  const output = session.output('audio', generation);
  const live = () => session.audio === choice && session.queues.audio.generation === generation;
  if (choice.delivery === 'rebuilt') {
    await loadDecoders(track.codec);
    if (!live()) return;
    const sink = new MB.AudioSampleSink(track);
    // Mixed to stereo here, a sample at a time (downmix.js), so the centre can be raised (setCentre) whatever the
    // rate; sound not at 48 kHz then goes through Mediabunny's transform, which only resamples it.
    const own = mixable(track.sampleRate);
    const source = new MB.AudioSampleSource({codec: 'opus', bitrate: 192000, ...(own ? {} : {transform: {numberOfChannels: 2, sampleRate: 48000}})});
    output.addAudioTrack(source);
    await output.start();
    for await (const sample of sink.samples(from)) {
      if (session.audio !== choice || !await session.room('audio', sample.timestamp, generation)) { sample.close(); await output.cancel(); return; }
      session.tap?.samples(sample, session.offset);
      // An MP4's first sample can start a few milliseconds before zero, which the writer refuses.
      if (sample.timestamp >= 0) {
        const mixed = stereoSample(sample, session.centre ?? 1);
        await source.add(mixed);
        mixed.close();
      }
      sample.close();
    }
  } else {
    const sink = session.sink?.(choice.track) || new MB.EncodedPacketSink(track); // Astra's own Matroska reader, when it reads this film
    const start = await sink.getPacket(from) ?? await sink.getFirstPacket();
    if (!start) { session.ended.audio = true; return session.finish(); }
    const source = new MB.EncodedAudioPacketSource(track.codec);
    output.addAudioTrack(source);
    await output.start();
    let first = true;
    for await (const packet of inOrder(sink, start)) {
      if (session.audio !== choice || !await session.room('audio', packet.timestamp, generation)) { await output.cancel(); return; }
      if (packet.timestamp < 0) continue;
      await source.add(packet, first ? {decoderConfig: choice.track.decoderConfig} : undefined);
      first = false;
      session.tap?.packet(packet, choice.track, session.offset, `${choice.track.id}:${generation}`);
    }
  }
  await output.finalize();
  if (!live()) return;
  if (session.flushAudio === generation) { await session.queues.audio.idle(); session.room('audio', session.video.currentTime, generation); }
  session.ended.audio = true;
  session.finish();
}
