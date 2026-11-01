// @ts-check
// An incremental Ogg Opus demuxer for Music's streaming path (MUSIC.md §5; NEXT-BATCH.md part 2),
// written from RFC 3533 (Ogg), RFC 7845 (Ogg Opus) and RFC 6716 §3.1 (the TOC byte). Bytes go in
// in any split; out come the OpusHead and each Opus packet with its length in 48 kHz samples and
// its granule position. Every page's capture pattern and CRC are checked; corrupt input throws an
// OggError with a code (the feeder falls back to the plain element path on it).
//
// A page's packets leave as soon as the page is whole; the stream's last page (its end-of-stream
// flag, or the caller saying these are the file's final bytes) carries the end trimming of RFC 7845
// §4.5 on its packets. No DOM; tests/music-stream-ogg.test.mjs checks it.

/** RFC 3533's largest page: 27 header bytes, 255 lacing values, 255 × 255 body bytes. */
export const MAX_PAGE = 27 + 255 + 255 * 255;
/** Opus always counts in 48 kHz samples (RFC 7845 §4). */
export const RATE = 48000;

/** @typedef {{ version: number, channels: number, preSkip: number, inputRate: number, outputGain: number,
 *   mapping: number, bytes: Uint8Array }} OpusHead */
/** One Opus packet. `start` is its granule position at its first sample (pre-skip included);
 * `discard` is how many samples at its end the stream's end trimming drops (0 but on the last);
 * `eos` marks the stream's last packet.
 * @typedef {{ data: Uint8Array, samples: number, start: number, discard: number, eos: boolean }} OpusPacket */
/** A page's header as read from the bytes (`size` is the whole page, header included).
 * @typedef {{ flags: number, granule: number, serial: number, seq: number, size: number, lacing: Uint8Array,
 *   body: Uint8Array }} OggPage */

export class OggError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'OggError';
    this.code = code;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg's CRC-32 (polynomial 0x04c11db7, not reflected, initial 0) of a page whose own CRC field
 * (bytes 22–25) counts as zero. @param {Uint8Array} b @param {number} at @param {number} size */
export function pageCrc(b, at, size) {
  let c = 0;
  for (let i = 0; i < size; i++) {
    const byte = i >= 22 && i < 26 ? 0 : b[at + i];
    c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return c;
}

const isCapture = (/** @type {Uint8Array} */ b, /** @type {number} */ i) => b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53;

/** A granule position as a number (-1: no packet ends on the page). @param {DataView} v @param {number} at */
function granuleAt(v, at) {
  const lo = v.getUint32(at, true);
  const hi = v.getInt32(at + 4, true);
  if (hi === -1 && lo === 0xffffffff) return -1;
  if (hi < 0) throw new OggError('ogg-granule', 'negative granule position');
  return hi * 0x100000000 + lo;
}

/**
 * The page at `at`, or null when the bytes end before it does. Throws OggError when the bytes there
 * are not a page (no capture pattern, a version other than 0, a CRC that doesn't match).
 * @param {Uint8Array} b @param {number} at @returns {OggPage | null}
 */
export function readPage(b, at) {
  if (b.length - at < 27) {
    if (b.length - at >= 4 && !isCapture(b, at)) throw new OggError('ogg-capture', 'no OggS capture pattern');
    return null;
  }
  if (!isCapture(b, at)) throw new OggError('ogg-capture', 'no OggS capture pattern');
  if (b[at + 4] !== 0) throw new OggError('ogg-version', 'unknown Ogg version');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b[at + 26];
  if (b.length - at < 27 + n) return null;
  const lacing = b.subarray(at + 27, at + 27 + n);
  let bodySize = 0;
  for (const l of lacing) bodySize += l;
  const size = 27 + n + bodySize;
  if (b.length - at < size) return null;
  if (pageCrc(b, at, size) !== v.getUint32(at + 22, true)) throw new OggError('ogg-crc', 'page CRC mismatch');
  return { flags: b[at + 5], granule: granuleAt(v, at + 6), serial: v.getUint32(at + 14, true), seq: v.getUint32(at + 18, true), size, lacing, body: b.subarray(at + 27 + n, at + size) };
}

/**
 * The first whole, valid page at or after `from` (a resync after a jump: RFC 3533 §6, capture
 * pattern then CRC). `null` when none starts before the bytes run out.
 * @param {Uint8Array} b @param {number} from @returns {{ at: number, page: OggPage } | null}
 */
export function findPage(b, from) {
  for (let i = from; i + 4 <= b.length; i++) {
    if (!isCapture(b, i)) continue;
    try {
      const page = readPage(b, i);
      if (page) return { at: i, page };
      return null;
    } catch {}
  }
  return null;
}

const FRAME_SAMPLES = [480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960];

/** A packet's length in 48 kHz samples from its TOC byte (RFC 6716 §3.1): the configuration's frame
 * size times the frame count (code 3 reads it from the second byte). @param {Uint8Array} p */
export function packetSamples(p) {
  if (!p.length) throw new OggError('opus-packet', 'empty Opus packet');
  const toc = p[0];
  const frame = FRAME_SAMPLES[toc >> 3];
  const code = toc & 3;
  let frames = code === 0 ? 1 : code === 3 ? 0 : 2;
  if (code === 3) {
    if (p.length < 2) throw new OggError('opus-toc', 'code 3 packet without a frame count');
    frames = p[1] & 0x3f;
    if (!frames) throw new OggError('opus-toc', 'code 3 packet with no frames');
  }
  const samples = frame * frames;
  if (samples > 5760) throw new OggError('opus-toc', 'Opus packet longer than 120 ms');
  return samples;
}

/** The OpusHead (RFC 7845 §5.1). Mapping family 0 (mono, stereo) and 1 (up to 8 channels, Vorbis
 * order) are what WebM carries; anything else throws. @param {Uint8Array} p @returns {OpusHead} */
export function opusHead(p) {
  const magic = 'OpusHead';
  if (p.length < 19 || [...magic].some((c, i) => p[i] !== c.charCodeAt(0))) throw new OggError('opus-head', 'no OpusHead');
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const version = p[8];
  if (version >> 4 !== 0) throw new OggError('opus-head', 'unsupported OpusHead version');
  const channels = p[9];
  const mapping = p[18];
  if (!channels) throw new OggError('opus-head', 'no channels');
  if (mapping === 0 ? channels > 2 : mapping === 1 ? channels > 8 || p.length < 21 + channels : true) throw new OggError('opus-mapping', 'unsupported channel mapping');
  return { version, channels, preSkip: v.getUint16(10, true), inputRate: v.getUint32(12, true), outputGain: v.getInt16(16, true), mapping, bytes: p.slice() };
}

/**
 * The end padding to drop from the stream's last packets (RFC 7845 §4.5): the last page's granule
 * position says where the audio ends; whatever the packets hold past it is padding.
 * @param {number} lastGranule the last page's granule position
 * @param {number} totalSamples the granule position at the end of the last packet, untrimmed (the
 *   granule where the stream's first packet starts plus every packet's samples)
 */
export function endTrim(lastGranule, totalSamples) {
  return Math.max(0, totalSamples - Math.max(0, lastGranule));
}

/** Spreads `trim` samples over the stream's last packets, from the end. @param {OpusPacket[]} packets @param {number} trim */
function applyTrim(packets, trim) {
  for (let i = packets.length - 1; i >= 0 && trim > 0; i--) {
    const d = Math.min(trim, packets[i].samples);
    packets[i].discard = d;
    trim -= d;
  }
}

export class OggOpusDemuxer {
  /**
   * @param {{ head?: OpusHead | null, resync?: boolean, serial?: number | null }} [o] `head`: already
   *   known (a seek starts mid-file and expects no header packets); `resync`: the bytes may start
   *   mid-page, so look for the first valid page and drop the packet it continues; `serial`: the
   *   stream's serial number, when known.
   */
  constructor({ head = null, resync = false, serial = null } = {}) {
    /** @type {OpusHead | null} */
    this.head = head;
    this.resync = resync;
    this.buf = new Uint8Array(0);
    this.pos = 0;
    /** Bytes of input read as whole pages (or skipped looking for one). */
    this.consumed = 0;
    /** @type {number | null} */
    this.serial = serial;
    this.seq = -1;
    /** 0: expecting OpusHead; 1: inside OpusTags (skipped, never kept: it may hold cover art); 2: audio. */
    this.headers = head ? 2 : 0;
    /** @type {Uint8Array[]} The pieces of the packet in progress. */
    this.partial = [];
    /** A packet is in progress (its pieces may not be kept, as for OpusTags). */
    this.open = false;
    /** After a resync, until a packet begins: the packet in progress began before the bytes did. */
    this.dropContinued = resync;
    /** The granule position at the end of the last packet placed (-1: unknown, after a resync). */
    this.prevGranule = -1;
    /** @type {OpusPacket[]} The last page's packets, held while the rest of a push may show they end the stream. */
    this.held = [];
    this.heldGranule = -1;
    this.heldPrev = -1;
    this.eos = false;
    /** The granule where the first audio packet starts (0 for a stream cut at its start). */
    this.origin = -1;
    /** The input offset where the audio pages begin, once the headers are read. */
    this.audioStart = -1;
  }

  /**
   * @param {Uint8Array} chunk
   * @param {{ last?: boolean }} [o] `last`: these are the stream's final bytes, so its final page's
   *   granule trims the end even if the page lacks the end-of-stream flag
   * @returns {{ head: OpusHead | null, packets: OpusPacket[] }}
   */
  push(chunk, { last = false } = {}) {
    if (this.eos) return { head: null, packets: [] };
    const rest = this.buf.subarray(this.pos);
    const next = new Uint8Array(rest.length + chunk.length);
    next.set(rest);
    next.set(chunk, rest.length);
    this.buf = next;
    this.pos = 0;
    const hadHead = this.head;
    /** @type {OpusPacket[]} */
    const out = [];
    while (!this.eos) {
      if (this.resync) {
        const found = findPage(this.buf, this.pos);
        if (!found) {
          // Keep the bytes a page starting here could still need; a gap longer than any page is no Ogg.
          const keep = Math.max(this.pos, this.buf.length - MAX_PAGE);
          this.consumed += keep - this.pos;
          this.pos = keep;
          if (this.consumed > 4 * MAX_PAGE) throw new OggError('ogg-capture', 'no Ogg page found');
          break;
        }
        this.consumed += found.at - this.pos;
        this.pos = found.at;
        this.resync = false;
      }
      const page = readPage(this.buf, this.pos);
      if (!page) break;
      this.pos += page.size;
      this.consumed += page.size;
      this.page(page, out);
    }
    if (this.held.length) this.release(out, last && this.pos === this.buf.length);
    if (last && !this.eos && this.pos === this.buf.length && !this.open) this.eos = true;
    return { head: hadHead ? null : this.head, packets: out };
  }

  /** The bytes ended. Throws if they stop mid-page or mid-packet. */
  end() {
    if (this.eos) return;
    if (this.buf.length > this.pos || this.open) throw new OggError('ogg-truncated', 'stream ends mid-page');
    this.eos = true;
  }

  /** @param {OggPage} page @param {OpusPacket[]} out */
  page(page, out) {
    if (this.serial === null) {
      if (!this.head && !(page.flags & 2)) throw new OggError('ogg-bos', 'stream does not begin with its first page');
      this.serial = page.serial;
    } else if (page.serial !== this.serial) return; // another logical stream (RFC 3533 §4): not ours
    if (this.seq >= 0 && page.seq !== ((this.seq + 1) >>> 0)) throw new OggError('ogg-seq', 'a page is missing');
    this.seq = page.seq;
    // Another page of ours: the held packets were not the stream's last.
    if (this.held.length) this.release(out, false);
    const continued = (page.flags & 1) !== 0;
    if (!continued && this.open) throw new OggError('ogg-continued', 'a packet was cut off');
    if (continued && !this.open && !this.dropContinued) throw new OggError('ogg-continued', 'a page continues a packet that never began');
    // Lacing (RFC 3533 §6): a run of 255s ended by a value under 255 is one packet's piece on this
    // page; a page that ends on 255 leaves its packet to go on in the next page.
    let skipping = continued && !this.open;
    /** @type {{ data: Uint8Array, samples: number }[]} */
    const audio = [];
    let at = 0;
    let pieceStart = 0;
    for (const l of page.lacing) {
      at += l;
      if (l === 255) continue;
      const piece = page.body.subarray(pieceStart, at);
      pieceStart = at;
      if (skipping) {
        skipping = false; // the tail of a packet that began before the resync
        continue;
      }
      if (this.headers !== 1) this.partial.push(piece);
      const data = join(this.partial);
      this.partial = [];
      this.open = false;
      if (this.headers === 0) {
        this.head = opusHead(data);
        this.headers = 1;
      } else if (this.headers === 1) {
        this.headers = 2;
        this.prevGranule = 0; // audio starts at granule 0 unless its first page says later
        this.audioStart = this.consumed; // the first audio packet begins on a fresh page (RFC 7845 §3)
      } else audio.push({ data, samples: packetSamples(data) });
    }
    if (pieceStart < at && !skipping) {
      if (this.headers !== 1) this.partial.push(page.body.subarray(pieceStart, at));
      this.open = true;
    }
    this.dropContinued = skipping;
    if (audio.length) this.hold(audio, page);
    if (page.flags & 4) {
      if (this.held.length) this.release(out, true);
      this.eos = true;
    }
  }

  /** Positions a page's packets and holds them. @param {{ data: Uint8Array, samples: number }[]} audio @param {OggPage} page */
  hold(audio, page) {
    const total = audio.reduce((n, p) => n + p.samples, 0);
    // A page's granule is where its last packet ends (RFC 7845 §4), so positions run back from it.
    // The last page is the exception: its packets run on from the page before, and its granule
    // trims the end (§4.5). Counting back to before 0 on any other page is invalid (§4.5).
    const end = page.granule >= 0 ? page.granule : this.prevGranule >= 0 ? this.prevGranule + total : -1;
    if (end < 0) throw new OggError('ogg-granule', 'no granule position to place the packets');
    let first = end - total;
    if (page.flags & 4 && this.prevGranule >= 0) first = this.prevGranule;
    if (first < 0) throw new OggError('ogg-granule', 'packets start before granule 0');
    if (this.origin < 0) this.origin = first;
    this.held = place(audio, first);
    this.heldPrev = this.prevGranule;
    this.heldGranule = end;
    this.prevGranule = end;
  }

  /** @param {OpusPacket[]} out @param {boolean} last */
  release(out, last) {
    if (last) {
      // Counted on from the page before when it is known; otherwise the positions ran back from
      // this page's own granule and there is nothing to trim.
      const first = this.heldPrev >= 0 ? this.heldPrev : this.held[0].start;
      if (first !== this.held[0].start) this.held = place(this.held, first);
      const total = this.held.reduce((n, p) => n + p.samples, 0);
      applyTrim(this.held, endTrim(this.heldGranule, first + total));
      this.held[this.held.length - 1].eos = true;
    }
    out.push(...this.held);
    this.held = [];
  }
}

/** Packets placed one after another from granule `first`.
 * @param {{ data: Uint8Array, samples: number }[]} packets @param {number} first @returns {OpusPacket[]} */
function place(packets, first) {
  let pos = first;
  return packets.map((p) => {
    const pk = { data: p.data, samples: p.samples, start: pos, discard: 0, eos: false };
    pos += p.samples;
    return pk;
  });
}

/** @param {Uint8Array[]} parts */
function join(parts) {
  if (parts.length === 1) return parts[0].slice();
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
