// An Ogg stream read back for the tests (Music's downloads with their covers, frontend/th/music/ogg-cover.js),
// by its pages and not by the code under test: each page's header, lacing and CRC (its own CRC-32, polynomial
// 0x04c11db7, not reflected), the packets put back together across pages, the OpusTags comments, and the
// FLAC picture blocks inside METADATA_BLOCK_PICTURE. Invented data only.
import assert from 'node:assert/strict';

const TABLE = Array.from({ length: 256 }, (_, i) => {
  let r = i << 24;
  for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  return r >>> 0;
});
/** Ogg's CRC of one page with its CRC field as zero. @param {Uint8Array} page */
export function oggCrc(page) {
  let c = 0;
  for (let i = 0; i < page.length; i++) c = ((c << 8) ^ TABLE[((c >>> 24) ^ (i >= 22 && i < 26 ? 0 : page[i])) & 0xff]) >>> 0;
  return c;
}

/**
 * The pages and packets of `bytes`, every page checked (capture pattern, version, CRC); anything after the
 * last whole page is `tail`. Packets: {data, pages: [first, last] page index, granule of the page it ends on}.
 * @param {Uint8Array} bytes
 */
export function readOgg(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = [];
  const packets = [];
  let pending = null;
  let p = 0;
  while (p + 27 <= bytes.length && bytes[p] === 0x4f && bytes[p + 1] === 0x67 && bytes[p + 2] === 0x67 && bytes[p + 3] === 0x53) {
    const n = bytes[p + 26];
    const lacing = [...bytes.subarray(p + 27, p + 27 + n)];
    const size = 27 + n + lacing.reduce((s, x) => s + x, 0);
    if (p + size > bytes.length) break;
    const raw = bytes.subarray(p, p + size);
    assert.equal(raw[4], 0, `page ${pages.length}: version 0`);
    const page = {
      at: p, size, raw, flags: raw[5], granule: v.getBigInt64(p + 6, true), serial: v.getUint32(p + 14, true), seq: v.getUint32(p + 18, true),
      crc: v.getUint32(p + 22, true), lacing,
    };
    assert.equal(page.crc, oggCrc(raw), `page ${pages.length}: its CRC`);
    const index = pages.push(page) - 1;
    assert.equal(Boolean(page.flags & 1), Boolean(pending), `page ${index}: continued exactly when a packet goes on into it`);
    let at = p + 27 + n;
    for (const x of lacing) {
      pending ??= { parts: [], first: index };
      pending.parts.push(bytes.subarray(at, at + x));
      at += x;
      if (x < 255) {
        const data = new Uint8Array(pending.parts.reduce((s, q) => s + q.length, 0));
        let o = 0;
        for (const q of pending.parts) { data.set(q, o); o += q.length; }
        packets.push({ data, pages: [pending.first, index], granule: page.granule, serial: page.serial });
        pending = null;
      }
    }
    p += size;
  }
  return { pages, packets, tail: bytes.subarray(p) };
}

/** An OpusTags packet's vendor, comments (as strings) and the bytes after them. @param {Uint8Array} t */
export function readTags(t) {
  assert.equal(new TextDecoder().decode(t.subarray(0, 8)), 'OpusTags');
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const dec = new TextDecoder();
  let p = 8;
  const vn = v.getUint32(p, true);
  const vendor = dec.decode(t.subarray(12, 12 + vn));
  p = 12 + vn;
  const count = v.getUint32(p, true);
  p += 4;
  const comments = [];
  for (let i = 0; i < count; i++) {
    const n = v.getUint32(p, true);
    comments.push(dec.decode(t.subarray(p + 4, p + 4 + n)));
    p += 4 + n;
  }
  return { vendor, comments, rest: t.subarray(p) };
}

/** A FLAC picture block from a METADATA_BLOCK_PICTURE comment's value (base64). @param {string} value */
export function readPicture(value) {
  const b = new Uint8Array(Buffer.from(value, 'base64'));
  const v = new DataView(b.buffer);
  let p = 0;
  const u = () => { const x = v.getUint32(p); p += 4; return x; };
  const type = u();
  const mime = new TextDecoder().decode(b.subarray(p + 4, p + 4 + v.getUint32(p)));
  p += 4 + mime.length;
  const description = new TextDecoder().decode(b.subarray(p + 4, p + 4 + v.getUint32(p)));
  p += 4 + v.getUint32(p);
  const width = u(), height = u(), depth = u(), colours = u(), n = u();
  const data = b.subarray(p, p + n);
  assert.equal(p + n, b.length, 'the picture block ends with its data');
  return { type, mime, description, width, height, depth, colours, data };
}

/** The pictures in a stream's OpusTags (its second packet). @param {Uint8Array} bytes */
export function picturesOf(bytes) {
  const { packets } = readOgg(bytes);
  const { comments } = readTags(packets[1].data);
  return comments.filter((c) => /^METADATA_BLOCK_PICTURE=/i.test(c)).map((c) => readPicture(c.slice(c.indexOf('=') + 1)));
}

/**
 * A song as saved with its cover against the song as stored: OpusHead's page as it was, the stored comments
 * kept, exactly one front cover whose bytes are `cover`, and every page after the header byte for byte as it
 * was but for its sequence number and CRC (moved on by the pages the header gained, without a gap).
 * @param {Uint8Array} saved @param {Uint8Array} stored @param {Uint8Array} cover @param {string} [what]
 */
export function assertEmbedded(saved, stored, cover, what = 'the song') {
  const a = readOgg(stored), b = readOgg(saved);
  assert.ok(Buffer.from(b.pages[0].raw).equals(Buffer.from(a.pages[0].raw)), `${what}: OpusHead's page as stored`);
  const ta = readTags(a.packets[1].data), tb = readTags(b.packets[1].data);
  assert.equal(tb.vendor, ta.vendor, `${what}: the vendor kept`);
  assert.deepEqual(tb.comments.filter((c) => !/^METADATA_BLOCK_PICTURE=/i.test(c)), ta.comments.filter((c) => !/^METADATA_BLOCK_PICTURE=/i.test(c)), `${what}: the comments kept`);
  const fronts = picturesOf(saved).filter((p) => p.type === 3);
  assert.equal(fronts.length, 1, `${what}: one front cover`);
  assert.ok(Buffer.from(fronts[0].data).equals(Buffer.from(cover)), `${what}: the cover's own bytes`);
  const afterA = a.pages.slice(a.packets[1].pages[1] + 1), afterB = b.pages.slice(b.packets[1].pages[1] + 1);
  assert.equal(afterB.length, afterA.length, `${what}: as many pages after the header`);
  b.pages.forEach((p, i) => assert.equal(p.seq, i, `${what}: page ${i}'s sequence number`));
  const masked = (raw) => { const c = Uint8Array.from(raw); c.fill(0, 18, 26); return Buffer.from(c); };
  afterA.forEach((p, i) => assert.ok(masked(afterB[i].raw).equals(masked(p.raw)), `${what}: audio page ${i} as stored`));
  assert.ok(Buffer.from(b.tail).equals(Buffer.from(a.tail)), `${what}: what follows its pages as stored`);
  assert.equal(saved.length - b.pages[b.packets[1].pages[1]].at - b.pages[b.packets[1].pages[1]].size, stored.length - a.pages[a.packets[1].pages[1]].at - a.pages[a.packets[1].pages[1]].size, `${what}: as long after the header`);
}
