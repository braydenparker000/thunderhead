// Rebuilt surround sound kept whole for Headphone surround (enhance/headphone.js), instead of mixed to stereo Opus.
//
// The browser will not encode more than two channels here (AudioEncoder: no to 6-channel Opus, to AAC, to FLAC)
// and its media source will not take uncompressed PCM in MP4 ('ipcm', 'fpcm', 'lpcm': all no), but it plays FLAC in
// MP4 with every channel, and FLAC lets a frame carry its samples as they are ("verbatim" subframes): no encoder is
// needed, only the frame's few header bytes and two checksums. So with Headphone surround on, a rebuilt track of 5 to
// 8 channels is written as such FLAC (16-bit) into an audio buffer of that type, and its channels reach the page's
// sound chain (from a session's start only: see soundMime). It is large (5.1 at 48 kHz: 576 kB a second, ten times the Opus), so it is used only while the owner
// has Headphone surround on, and the sound reads at most AHEAD seconds past the playhead. The centre is still raised
// here (the dialogue lift: the chain leaves rebuilt sound's centre to the engine) before it is placed.

import * as MB from '../../vendor/mediabunny.js';
import {placeable} from '../enhance/headphone.js';
import {mediaSourceClass} from './capabilities.js';
import {audioMime} from './plan.js';

export const FLAC = 'audio/mp4; codecs="flac"';
export const AHEAD = 15; // seconds of whole surround sound read past the playhead
let plays = null;

/** True when this browser's media source plays FLAC in MP4. */
export const flacPlays = () => plays ??= !!mediaSourceClass()?.isTypeSupported?.(FLAC);

/** True when the rebuilt `choice` would be written whole: Headphone surround is on and its layout can be placed. */
export const keepsSurround = (session, choice) => choice?.delivery === 'rebuilt' && !!session.surround && placeable(choice.track?.channels) && flacPlays();

/**
 * The audio buffer's type for `choice`: passed through as it is, rebuilt whole (FLAC) or rebuilt as stereo Opus. Whole
 * sound is chosen only as a session starts: Chrome keeps the channel layout its audio began with and converts what
 * comes later to it, so a buffer refilled (`was`: another track, the dialogue lift) keeps its kind, and the player
 * opens a fresh session to change it (player-sound.js setSurround).
 */
export function soundMime(session, choice, was = null) {
  if (choice.delivery !== 'rebuilt') return audioMime(choice.track);
  if (was) return was === FLAC ? FLAC : OPUS;
  return keepsSurround(session, choice) ? FLAC : OPUS;
}
const OPUS = 'audio/mp4; codecs="opus"';

const table = (poly, bits) => Array.from({length: 256}, (_, n) => {
  let c = n << (bits - 8);
  for (let i = 0; i < 8; i++) c = c & (1 << (bits - 1)) ? (c << 1) ^ poly : c << 1;
  return c & ((1 << bits) - 1);
});
const CRC8 = table(0x07, 8), CRC16 = table(0x8005, 16);
const crc8 = (bytes, end) => { let c = 0; for (let i = 0; i < end; i++) c = CRC8[c ^ bytes[i]]; return c; };
const crc16 = (bytes, end) => { let c = 0; for (let i = 0; i < end; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ bytes[i]]; return c; };
const RATES = {88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11};
const MAX_BLOCK = 65535;

/** FLAC's UTF-8-like coding of a frame's first sample number (up to 36 bits). */
export function codedNumber(n) {
  if (n < 0x80) return [n];
  let bytes = 2;
  while (n >= 2 ** (5 * bytes + 1)) bytes++;
  const out = [];
  for (let i = bytes - 1; i > 0; i--) { out.unshift(0x80 | (n % 64)); n = Math.floor(n / 64); }
  out.unshift(((0xff00 >> bytes) & 0xff) | n);
  return out;
}

/** Writes decoded samples as FLAC frames of `channels` channels at `sampleRate`, each a Mediabunny EncodedPacket. */
export class FlacFrames {
  constructor(channels, sampleRate) {
    this.channels = channels; this.rate = sampleRate;
    const info = new Uint8Array(42); // 'fLaC', then the STREAMINFO block (the last metadata block)
    info.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34, 0, 16, MAX_BLOCK >> 8, MAX_BLOCK & 255]);
    info[18] = sampleRate >> 12; info[19] = (sampleRate >> 4) & 255;
    info[20] = ((sampleRate & 15) << 4) | ((channels - 1) << 1); // 16 bits a sample: (16 - 1) >> 4 is 0 here
    info[21] = 15 << 4;
    this.config = {codec: 'flac', numberOfChannels: channels, sampleRate, description: info};
  }

  /** The packets for one decoded AudioSample, its centre channel multiplied by `centre`. */
  packets(sample, centre = 1) {
    const n = sample.numberOfFrames, planes = [];
    for (let c = 0; c < this.channels; c++) {
      const plane = new Float32Array(n);
      if (c < sample.numberOfChannels) sample.copyTo(plane, {planeIndex: c, format: 'f32-planar'});
      planes.push(plane);
    }
    if (centre !== 1) for (let i = 0; i < n; i++) planes[2][i] *= centre;
    const out = [], first = Math.round(sample.timestamp * this.rate);
    for (let at = 0; at < n; at += MAX_BLOCK) {
      const size = Math.min(MAX_BLOCK, n - at);
      out.push(new MB.EncodedPacket(this.frame(planes, at, size, first + at), 'key', (first + at) / this.rate, size / this.rate));
    }
    return out;
  }

  /** One frame: variable block size (so any sample length goes), sample number coded, verbatim 16-bit subframes. */
  frame(planes, at, size, number) {
    const rate = RATES[this.rate] ?? 0; // 0: the rate is the STREAMINFO's
    const head = [0xff, 0xf9, 0x70 | rate, ((this.channels - 1) << 4) | 0x08, ...codedNumber(number), (size - 1) >> 8, (size - 1) & 255];
    const bytes = new Uint8Array(head.length + 1 + this.channels * (1 + 2 * size) + 2);
    bytes.set(head);
    let o = head.length;
    bytes[o] = crc8(bytes, o); o++;
    for (const plane of planes) {
      bytes[o++] = 0x02; // a verbatim subframe, no wasted bits
      for (let i = at, end = at + size; i < end; i++) {
        const v = Math.max(-32768, Math.min(32767, Math.round(plane[i] * 32767)));
        bytes[o++] = (v >> 8) & 255; bytes[o++] = v & 255;
      }
    }
    const crc = crc16(bytes, o);
    bytes[o++] = crc >> 8; bytes[o++] = crc & 255;
    return bytes;
  }
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

/** Waits while whole surround sound read is more than AHEAD seconds past the playhead (on top of session.room). */
export async function sixRoom(session, timestamp, live) {
  while (live() && timestamp - session.offset - session.video.currentTime > AHEAD) await new Promise(resolve => setTimeout(resolve, 250));
  return live();
}
