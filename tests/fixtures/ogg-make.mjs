// Synthetic Ogg Opus streams for the streaming tests (tests/music-stream-*.test.mjs): an Ogg page
// writer (RFC 3533) with control over how packets fall on pages, made-up Opus packets with valid
// TOC bytes, and a longer stream made by repeating tests/fixtures/tone.opus's own packets, so no
// large binary is committed. Synthetic data only.
import { readFileSync } from 'node:fs';
import { OggOpusDemuxer, pageCrc } from '../../frontend/th/music/stream/ogg.js';

export const TONE = new Uint8Array(readFileSync(new URL('./tone.opus', import.meta.url)));

/** An OpusHead (RFC 7845 §5.1). */
export function opusHeadBytes({ channels = 2, preSkip = 312, rate = 48000, gain = 0, mapping = 0, table = /** @type {number[]} */ ([]) } = {}) {
  const b = new Uint8Array(19 + (mapping ? 2 + table.length : 0));
  b.set(new TextEncoder().encode('OpusHead'));
  const v = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, rate, true);
  v.setInt16(16, gain, true);
  b[18] = mapping;
  if (mapping) {
    b[19] = table.length - 1; // streams (a made-up split; the demuxer only checks the length)
    b[20] = 1;
    b.set(table, 21);
  }
  return b;
}

export const TAGS = new Uint8Array([...new TextEncoder().encode('OpusTags'), 4, 0, 0, 0, ...new TextEncoder().encode('test'), 0, 0, 0, 0]);

/** A made-up Opus packet: a CELT fullband TOC for `ms` (2.5, 5, 10 or 20) and code 0, then filler bytes. */
export function packet(ms = 20, bytes = 60, fill = 0x55) {
  const config = 16 + 12 + [2.5, 5, 10, 20].indexOf(ms);
  const p = new Uint8Array(bytes).fill(fill);
  p[0] = (config << 3) | 0x04;
  return p;
}

/** One page with its CRC. */
export function page({ flags = 0, granule = 0, serial = 0x5eed, seq = 0, lacing = /** @type {number[]} */ ([]), body = new Uint8Array(0) }) {
  const out = new Uint8Array(27 + lacing.length + body.length);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]);
  out[5] = flags;
  if (granule < 0) v.setBigInt64(6, -1n, true);
  else v.setBigUint64(6, BigInt(granule), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  out.set(body, 27 + lacing.length);
  v.setUint32(22, pageCrc(out, 0, out.length), true);
  return out;
}

/**
 * A whole stream: OpusHead on its own page, OpusTags on the next, then the audio packets, at most
 * `perPage` packets and `maxSegments` lacing values a page (a packet longer than a page's room goes
 * on across pages, flagged as continued). `endGranule` (optional) is the last page's granule: less
 * than the packets' total means end trimming. `start` is the granule where the audio begins.
 * @param {{ head?: Uint8Array, tags?: Uint8Array, packets: { data: Uint8Array, samples: number }[], perPage?: number,
 *   maxSegments?: number, endGranule?: number, start?: number, serial?: number, eos?: boolean }} o
 */
export function writeOgg({ head = opusHeadBytes(), tags = TAGS, packets, perPage = 50, maxSegments = 255, endGranule, start = 0, serial = 0x5eed, eos = true }) {
  const pages = [page({ flags: 2, granule: 0, serial, seq: 0, lacing: lace(head.length), body: head })];
  pages.push(page({ granule: 0, serial, seq: 1, lacing: lace(tags.length), body: tags }));
  // Every lacing value with the packet it belongs to and whether it ends it.
  const segs = [];
  for (const [i, p] of packets.entries()) {
    const l = lace(p.data.length);
    let off = 0;
    for (const [j, v] of l.entries()) {
      segs.push({ v, i, end: j === l.length - 1, bytes: p.data.subarray(off, off + v) });
      off += v;
    }
  }
  let pos = start;
  let seq = 2;
  let k = 0;
  while (k < segs.length) {
    const continued = k > 0 && !segs[k - 1].end;
    const take = [];
    let ends = 0;
    while (k < segs.length && take.length < maxSegments && ends < perPage) {
      take.push(segs[k]);
      if (segs[k].end) {
        ends++;
        pos += packets[segs[k].i].samples;
      }
      k++;
    }
    const last = k >= segs.length;
    const granule = !ends ? -1 : last && endGranule !== undefined ? endGranule : pos;
    const body = new Uint8Array(take.reduce((n, s) => n + s.v, 0));
    let o = 0;
    for (const s of take) {
      body.set(s.bytes, o);
      o += s.v;
    }
    pages.push(page({ flags: (continued ? 1 : 0) | (last && eos ? 4 : 0), granule, serial, seq: seq++, lacing: take.map((s) => s.v), body }));
  }
  return concat(pages);
}

/** Lacing values for a packet of `n` bytes: 255s, then the rest (a 0 when it divides evenly). */
export function lace(n) {
  const out = Array(Math.floor(n / 255)).fill(255);
  out.push(n % 255);
  return out;
}

/** @param {Uint8Array[]} parts */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The fixture's head and packets. */
export function tonePackets() {
  const d = new OggOpusDemuxer();
  const r = d.push(TONE, { last: true });
  return { head: /** @type {NonNullable<typeof r.head>} */ (r.head), packets: r.packets };
}

/** A longer Ogg Opus: the fixture's packets `copies` times over (3 s each), one stream, end-trimmed like the fixture. */
export function longTone(copies) {
  const { head, packets } = tonePackets();
  const all = [];
  for (let c = 0; c < copies; c++) for (const p of packets) all.push({ data: p.data, samples: p.samples });
  const trim = packets[packets.length - 1].discard;
  const total = all.reduce((n, p) => n + p.samples, 0);
  return writeOgg({ head: head.bytes, packets: all, endGranule: total - trim });
}
