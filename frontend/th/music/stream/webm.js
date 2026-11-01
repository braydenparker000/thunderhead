// @ts-check
// A streaming WebM writer for Music's streaming path (MUSIC.md §5; NEXT-BATCH.md part 2): the same
// Opus packets an Ogg file holds, in the container Media Source Extensions take
// (`audio/webm; codecs="opus"`). Written from the Matroska specification (RFC 9559, EBML RFC 8794)
// and the WebM profile: an initialization segment (EBML header, a Segment of unknown size, Info and
// one Opus track), then one Cluster per append. No re-encoding: packet bytes pass through untouched.
// No DOM; tests/music-stream-webm.test.mjs reads the output back.

import { RATE } from './ogg.js';

/** Element IDs (their marker bits included, as written). */
export const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, Info: 0x1549a966, TimestampScale: 0x2ad7b1, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  CodecID: 0x86, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, Audio: 0xe1,
  SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, DiscardPadding: 0x75a2,
};
/** Matroska ticks of 1 ms (TimestampScale 1,000,000 ns). */
export const TIMESTAMP_SCALE = 1_000_000;
/** Opus needs 80 ms decoded before a seek point to settle (RFC 7845 §4.6; the WebM Opus mapping). */
export const SEEK_PRE_ROLL_NS = 80_000_000;
/** The writer's one track. */
const TRACK = 1;
/** An EBML size with every value bit set: "unknown" (RFC 8794 §6.2), for the Segment that grows. */
const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

/** Samples at 48 kHz as nanoseconds, rounded. @param {number} samples */
export const samplesToNs = (samples) => Math.round((samples * 1e9) / RATE);

/** An element ID's bytes. @param {number} id */
function idBytes(id) {
  const n = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  const out = new Uint8Array(n);
  for (let i = n - 1, v = id; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
}

/** An EBML variable-size integer in its shortest form (RFC 8794 §4); all-ones stays reserved. @param {number} v */
export function vint(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError('bad EBML size');
  for (let n = 1; n <= 8; n++) {
    if (v < 2 ** (7 * n) - 1) {
      const out = new Uint8Array(n);
      let x = v;
      for (let i = n - 1; i >= 0; i--) {
        out[i] = x % 256;
        x = Math.floor(x / 256);
      }
      out[0] |= 0x80 >> (n - 1);
      return out;
    }
  }
  throw new RangeError('EBML size too large');
}

/** An unsigned integer, big-endian, in as few bytes as it needs (at least one). @param {number} v */
function uintBytes(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError('bad unsigned integer');
  const bytes = [];
  do {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(bytes);
}

/** A signed integer, big-endian two's complement, in as few bytes as it needs. @param {number} v */
function intBytes(v) {
  if (!Number.isSafeInteger(v)) throw new RangeError('bad signed integer');
  let n = 1;
  while (n < 8 && !(v >= -(2 ** (8 * n - 1)) && v < 2 ** (8 * n - 1))) n++;
  const out = new Uint8Array(n);
  let x = BigInt.asUintN(8 * n, BigInt(v));
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** One element: its ID, its size, its body. @param {number} id @param {Uint8Array[]} body */
const el = (id, ...body) => {
  const data = concat(body);
  return concat([idBytes(id), vint(data.length), data]);
};
const uint = (/** @type {number} */ id, /** @type {number} */ v) => el(id, uintBytes(v));
const int = (/** @type {number} */ id, /** @type {number} */ v) => el(id, intBytes(v));
const str = (/** @type {number} */ id, /** @type {string} */ s) => el(id, new TextEncoder().encode(s));
const float = (/** @type {number} */ id, /** @type {number} */ v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
};

/**
 * The initialization segment for one Opus stream: EBML header (DocType webm), a Segment of unknown
 * size, Info (TimestampScale 1 ms) and Tracks with one audio track (A_OPUS; CodecPrivate is the
 * OpusHead as the Ogg file has it; CodecDelay its pre-skip in ns; SeekPreRoll 80 ms).
 * @param {{ opusHead: Uint8Array | { bytes: Uint8Array }, channels?: number }} o
 */
export function init({ opusHead, channels }) {
  const head = opusHead instanceof Uint8Array ? opusHead : opusHead.bytes;
  if (head.length < 19) throw new RangeError('OpusHead too short');
  const preSkip = head[10] | (head[11] << 8);
  const header = el(ID.EBML,
    uint(ID.EBMLVersion, 1), uint(ID.EBMLReadVersion, 1), uint(ID.EBMLMaxIDLength, 4), uint(ID.EBMLMaxSizeLength, 8),
    str(ID.DocType, 'webm'), uint(ID.DocTypeVersion, 4), uint(ID.DocTypeReadVersion, 2));
  const info = el(ID.Info, uint(ID.TimestampScale, TIMESTAMP_SCALE), str(ID.MuxingApp, 'th-stream'), str(ID.WritingApp, 'th-stream'));
  const track = el(ID.TrackEntry,
    uint(ID.TrackNumber, TRACK), uint(ID.TrackUID, TRACK), uint(ID.TrackType, 2), uint(ID.FlagLacing, 0),
    str(ID.CodecID, 'A_OPUS'), el(ID.CodecPrivate, head),
    uint(ID.CodecDelay, samplesToNs(preSkip)), uint(ID.SeekPreRoll, SEEK_PRE_ROLL_NS),
    el(ID.Audio, float(ID.SamplingFrequency, RATE), uint(ID.Channels, channels ?? head[9])));
  return concat([header, idBytes(ID.Segment), UNKNOWN_SIZE, info, el(ID.Tracks, track)]);
}

/**
 * One Cluster of consecutive packets, the first at `startNs`, each block timed by the samples
 * before it. A packet with `discard` samples to drop at its end (the stream's end padding) goes in a
 * BlockGroup with its DiscardPadding; the others are SimpleBlocks (keyframes: every Opus packet
 * decodes on its own).
 * @param {{ data: Uint8Array, samples: number, discard?: number }[]} packets
 * @param {number} startNs
 */
export function cluster(packets, startNs) {
  const base = Math.round(startNs / TIMESTAMP_SCALE);
  /** @type {Uint8Array[]} */
  const blocks = [];
  let samples = 0;
  for (const p of packets) {
    const rel = Math.round((startNs + samplesToNs(samples)) / TIMESTAMP_SCALE) - base;
    if (rel > 32767) throw new RangeError('cluster too long');
    const head = new Uint8Array(4);
    head[0] = 0x80 | TRACK; // the track number as a one-byte vint
    new DataView(head.buffer).setInt16(1, rel);
    if (p.discard) {
      blocks.push(el(ID.BlockGroup, el(ID.Block, head, p.data), int(ID.DiscardPadding, samplesToNs(p.discard))));
    } else {
      head[3] = 0x80; // keyframe
      blocks.push(el(ID.SimpleBlock, head, p.data));
    }
    samples += p.samples;
  }
  return el(ID.Cluster, uint(ID.Timestamp, base), ...blocks);
}
