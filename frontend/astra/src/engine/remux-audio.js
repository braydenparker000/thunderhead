// The sound side of a re-wrapped film (remux.js): reads the chosen track from
// `from` (file time) and writes it to the audio SourceBuffer, either re-wrapped
// as it is ('direct') or decoded, mixed to stereo (downmix.js, with the
// centre raised for clearer dialogue) and encoded to Opus ('rebuilt'), or with
// Headphone surround on kept whole as uncompressed FLAC (sound-six.js). The
// sound tap (sound-tap.js) is handed what passes, when one is set.
// Rebuilt sound read by Astra's own Matroska reader is decoded and encoded in
// the sound worker (sound-apart.js), off the page's thread; if that cannot be
// done, on the page from Astra's reader (sound-stream.js), and failing that,
// read and decoded by Mediabunny.

import * as MB from '../../vendor/mediabunny.js';
import {decodersHere} from './audio-decoders.js';
import {ownSampleSink, SOUND} from './sound-stream.js';
import {FLAC, sixRoom} from './sound-six.js';
import {stereoWriter, wholeWriter} from './sound-write.js';
import {apartUsable, convertApart} from './sound-apart.js';

/**
 * Runs one audio pipeline for `session` (a RemuxSession) until it ends, is replaced (a newer generation, another
 * track) or the session closes.
 */
export async function pumpAudio(session, generation, from, inOrder) {
  const choice = session.audio, track = choice.track.ref;
  const output = session.output('audio', generation);
  const live = () => session.audio === choice && session.queues.audio.generation === generation;
  if (choice.delivery === 'rebuilt') {
    const packets = session.ownSound !== false ? session.sink?.(choice.track) : null;
    if (packets && SOUND.own && session.soundApart !== false && apartUsable()) {
      session.stats.ownSound = session.stats.soundApart = true;
      const whole = session.audioMime === FLAC;
      const gate = async timestamp => await session.room('audio', timestamp, generation) && await settled(session, timestamp, live) && (!whole || await sixRoom(session, timestamp, live));
      try {
        if (!await convertApart(session, {generation, from, sink: packets, track, channels: choice.track.channels, whole, gate, live})) return;
      } catch (error) {
        // The worker failed (not the reader, the host or the decoder's download): the page converts from here on.
        if (error?.kind || error?.name === 'InputDisposedError' || !live()) throw error;
        session.soundApart = false;
        session.stats.soundApart = false;
        session.stats.soundFallback = String(error?.message || error).slice(0, 120);
        return session.serial('refill', () => session.refillAudio());
      }
      return ended(session, generation, live);
    }
    await decodersHere(track.codec);
    if (!live()) return;
    // Decoded from Astra's own Matroska reader's packets (sound-stream.js), block by block; else Mediabunny reads it.
    const own = session.ownSound !== false && ownSampleSink(track, session.sink?.(choice.track));
    const sink = own || new MB.AudioSampleSink(track);
    session.stats.ownSound = !!own;
    const write = session.audioMime === FLAC ? wholeWriter(output, choice.track.channels, track.sampleRate) : stereoWriter(output, track.sampleRate);
    await output.start();
    try {
      for await (const sample of sink.samples(from)) {
        if (session.audio !== choice || !await session.room('audio', sample.timestamp, generation) || !await settled(session, sample.timestamp, live) || (write.whole && !await sixRoom(session, sample.timestamp, live))) { sample.close(); await output.cancel(); return; }
        session.tap?.samples(sample, session.offset);
        // An MP4's first sample can start a few milliseconds before zero, which the writer refuses.
        if (sample.timestamp >= 0) await write(sample, session.centre ?? 1);
        sample.close();
      }
    } catch (error) {
      // Anything unexpected on Astra's own path (not a closed film, a lost host or the reader's own step aside, which
      // remux.js handles for picture and sound together): Mediabunny's sink reads this film's sound from here on.
      if (!own || error?.kind || error?.name === 'InputDisposedError' || !live()) throw error;
      session.ownSound = false;
      session.stats.soundFallback = String(error?.message || error).slice(0, 120);
      await output.cancel().catch(() => {});
      return session.serial('refill', () => session.refillAudio());
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
      if (session.audio !== choice || !await session.room('audio', packet.timestamp, generation) || !await settled(session, packet.timestamp, live)) { await output.cancel(); return; }
      if (packet.timestamp < 0) continue;
      await source.add(packet, first ? {decoderConfig: choice.track.decoderConfig} : undefined);
      first = false;
      session.tap?.packet(packet, choice.track, session.offset, `${choice.track.id}:${generation}`);
    }
  }
  await output.finalize();
  return ended(session, generation, live);
}

/**
 * Until the film plays at its place (a start, a seek, a refill), sound is read at most HEAD seconds past the playhead,
 * and the picture, which reads no more than a few seconds past the sound (remux.js room), with it. Read on to its full
 * read-ahead at once, on a fast host the picture's reading filled the page's thread and held back the very frames the
 * film waited for: on a 25 Mbit/s film with the page's thread six times slower, a far seek took about 3.2 s to show its
 * place with the sound converted in the worker or passed through, and about 2.6 s with this (README, Converted sound).
 */
const HEAD = 4;
async function settled(session, timestamp, live) {
  const v = session.video;
  while (live() && timestamp - session.offset - v.currentTime > HEAD && (v.seeking || v.readyState < 3)) await new Promise(resolve => setTimeout(resolve, 100));
  return live();
}

/** The track is all written: a pending flush of the old track's sound is done, and the session may end its stream. */
async function ended(session, generation, live) {
  if (!live()) return;
  if (session.flushAudio === generation) { await session.queues.audio.idle(); session.room('audio', session.video.currentTime, generation); }
  session.ended.audio = true;
  session.finish();
}
