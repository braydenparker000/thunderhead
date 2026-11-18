// Decoded sound written as FLAC frames whose samples are carried as they are ("verbatim" subframes, 16-bit): no
// encoder is needed, only each frame's few header bytes and two checksums. Used for surround kept whole for Headphone
// surround (sound-six.js); apart from it so the sound worker (sound-worker.js) can load it without the page's modules.

import * as MB from '../../vendor/mediabunny.js';

const table = (poly, bits) => Array.from({length: 256}, (_, n) => {
  let c = n << (bits - 8);
  for (let i = 0; i < 8; i++) c = c & (1 << (bits - 1)) ? (c << 1) ^ poly : c << 1;
  return c & ((1 << bits) - 1);
});
const CRC8 = table(0x07, 8), CRC16 = Uint16Array.from(table(0x8005, 16));
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
