// The two writers of converted sound into a fragmented MP4 output (fragments.js), wherever the conversion runs: on the
// page's thread (remux-audio.js) or in the sound worker (sound-worker.js). Nothing here touches the page.
//
// stereoWriter: mixed to stereo a sample at a time (downmix.js), so the centre can be raised whatever the rate, and
//   encoded to Opus; sound not at 48 kHz then goes through Mediabunny's transform, which only resamples it.
// wholeWriter: kept whole as FLAC carrying the samples as they are (flac-frames.js), for Headphone surround.

import * as MB from '../../vendor/mediabunny.js';
import {mixable} from './downmix.js';
import {stereoSample} from './fragments.js';
import {FlacFrames} from './flac-frames.js';

/** A writer of decoded samples into `output` as stereo Opus. */
export function stereoWriter(output, sampleRate) {
  const source = new MB.AudioSampleSource({codec: 'opus', bitrate: 192000, ...(mixable(sampleRate) ? {} : {transform: {numberOfChannels: 2, sampleRate: 48000}})});
  output.addAudioTrack(source);
  return async (sample, centre) => { const mixed = stereoSample(sample, centre); await source.add(mixed); mixed.close(); };
}

/** A writer of decoded samples into `output` as whole FLAC (`whole` set, for sixRoom). */
export function wholeWriter(output, channels, sampleRate) {
  const frames = new FlacFrames(channels, sampleRate), source = new MB.EncodedAudioPacketSource('flac');
  output.addAudioTrack(source);
  let first = true;
  const write = async (sample, centre) => {
    for (const packet of frames.packets(sample, centre)) { await source.add(packet, first ? {decoderConfig: frames.config} : undefined); first = false; }
  };
  return Object.assign(write, {whole: true});
}
