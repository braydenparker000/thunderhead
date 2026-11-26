// A cover embedded into an Ogg Opus file as it streams (Music's downloads, th/music/downloads.js; owner,
// 2026-11-26): the song's own bytes with a METADATA_BLOCK_PICTURE comment (a FLAC picture block in base64,
// type 3, front cover) in its OpusTags header, so other players show the artwork. Written from RFC 3533
// (Ogg), RFC 7845 (Ogg Opus) and the FLAC format's PICTURE block.
// - Only the header is held: bytes are kept until the OpusTags packet has ended (at most HEAD_LIMIT; past it,
//   or anything that is not one Ogg Opus stream's head, the song passes through as it came). The tags packet
//   is written again (its vendor string, every comment, and any trailing data kept; a front-cover picture
//   already there replaced, other pictures kept), laced onto as many pages as it needs, granule 0, ending
//   its page.
// - After it, each page of that stream has its sequence number moved on by the pages added and its CRC made
//   again; nothing else changes, so the audio is bit-identical. A page split across chunks waits for its
//   end (one page at most). The tags fitting on as many pages as before, the rest passes as it is.
// - A page of another stream (a chained file's next link), a page whose CRC is wrong or bytes that are not
//   a page: from there on everything passes as it came.
// Classic script with no imports: Music's worker loads it with importScripts; the tests import it.
(() => {
  const g = /** @type {any} */ (globalThis);
  if (g.thOggCover) return;
  /** The head must end within this, or the song passes through as it is. */
  const HEAD_LIMIT = 1024 * 1024;
  /** Stored covers up to this are embedded as they are; larger ones are made smaller where the worker can. */
  const COVER_LIMIT = 1024 * 1024;
  const COVER_PX = 1200;
  const enc = new TextEncoder();
  const KEY = enc.encode('METADATA_BLOCK_PICTURE=');

  /** Ogg's CRC-32: polynomial 0x04c11db7, not reflected, initial 0, no final xor. */
  const TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    TABLE[i] = r >>> 0;
  }
  /** A page's CRC, its own CRC field (bytes 22-25) counted as zero. @param {Uint8Array} b @param {number} at @param {number} size */
  function pageCrc(b, at, size) {
    let c = 0;
    for (let i = 0; i < size; i++) c = ((c << 8) ^ TABLE[((c >>> 24) ^ (i >= 22 && i < 26 ? 0 : b[at + i])) & 0xff]) >>> 0;
    return c;
  }

  const u32le = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  const u32be = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const u16be = (b, p) => (b[p] << 8) | b[p + 1];
  const setLe = (b, p, x) => { b[p] = x; b[p + 1] = x >>> 8; b[p + 2] = x >>> 16; b[p + 3] = x >>> 24; };
  const setBe = (b, p, x) => { b[p] = x >>> 24; b[p + 1] = x >>> 16; b[p + 2] = x >>> 8; b[p + 3] = x; };
  const isCapture = (b, p) => b[p] === 0x4f && b[p + 1] === 0x67 && b[p + 2] === 0x67 && b[p + 3] === 0x53;
  const same = (b, p, word) => word.every((c, i) => b[p + i] === c);
  const OPUS_HEAD = [...enc.encode('OpusHead')];
  const OPUS_TAGS = [...enc.encode('OpusTags')];
  const OGGS = [0x4f, 0x67, 0x67, 0x53];

  /** An image's type and size from its first bytes (JPEG's frame header, PNG's IHDR), else what is known; 0 where unread. @param {Uint8Array} b */
  function imageInfo(b, mime = '') {
    if (b.length >= 26 && same(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && same(b, 12, [0x49, 0x48, 0x44, 0x52])) {
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[b[25]] ?? 0;
      return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20), depth: b[24] * channels };
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      // The markers after SOI, by their lengths, to the first frame header (SOF0-SOF15 but DHT, JPG and DAC).
      for (let p = 2; p + 9 < b.length; ) {
        if (b[p] !== 0xff) break;
        const m = b[p + 1];
        if (m === 0xff) { p++; continue; }
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { p += 2; continue; }
        if (m === 0xd9 || m === 0xda) break;
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', width: u16be(b, p + 7), height: u16be(b, p + 5), depth: b[p + 4] * b[p + 9] };
        p += 2 + u16be(b, p + 2);
      }
      return { mime: 'image/jpeg', width: 0, height: 0, depth: 0 };
    }
    return { mime: mime || 'image/jpeg', width: 0, height: 0, depth: 0 };
  }

  /** A FLAC PICTURE block (big-endian): type 3 (front cover), its mime type, no description, its size, no palette, its bytes. */
  function pictureBlock({ bytes, mime, width = 0, height = 0, depth = 0 }) {
    const m = enc.encode(mime || 'image/jpeg');
    const out = new Uint8Array(32 + m.length + bytes.length);
    let p = 0;
    const put = (x) => { setBe(out, p, x >>> 0); p += 4; };
    put(3);
    put(m.length);
    out.set(m, p);
    p += m.length;
    put(0); // description
    put(width);
    put(height);
    put(depth);
    put(0); // colours: not indexed
    put(bytes.length);
    out.set(bytes, p);
    return out;
  }

  const B64 = enc.encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
  /** Base64 as ASCII bytes, written into `out` at `at`. @param {Uint8Array} b */
  function base64Into(b, out, at) {
    let p = at, i = 0;
    for (; i + 2 < b.length; i += 3) {
      const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out[p++] = B64[n >> 18]; out[p++] = B64[(n >> 12) & 63]; out[p++] = B64[(n >> 6) & 63]; out[p++] = B64[n & 63];
    }
    if (i < b.length) {
      const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
      out[p++] = B64[n >> 18]; out[p++] = B64[(n >> 12) & 63];
      out[p++] = i + 1 < b.length ? B64[(n >> 6) & 63] : 61;
      out[p++] = 61;
    }
    return p;
  }
  const b64len = (n) => Math.ceil(n / 3) * 4;
  /** The picture type of a METADATA_BLOCK_PICTURE value: its first four bytes, from its first eight base64 characters (-1: unreadable). */
  function pictureType(b, at, end) {
    if (end - at < 8) return -1;
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const c = b[at + i];
      const v = c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c === 43 ? 62 : c === 47 ? 63 : -1;
      if (v < 0) return -1;
      n = n * 64 + v; // 36 bits: the type is the top 32
    }
    return Math.floor(n / 16);
  }
  /** Whether a comment is METADATA_BLOCK_PICTURE= (the name in any letter case) with a front cover. */
  function frontCover(b, at, end) {
    if (end - at < KEY.length) return false;
    for (let i = 0; i < KEY.length; i++) {
      const c = b[at + i];
      if ((c >= 97 && c <= 122 ? c - 32 : c) !== KEY[i]) return false;
    }
    return pictureType(b, at + KEY.length, end) === 3;
  }

  /** The OpusTags packet again with `block` as its front cover; null when the packet is not one. @param {Uint8Array} t @param {Uint8Array} block */
  function withPicture(t, block) {
    if (t.length < 16 || !same(t, 0, OPUS_TAGS)) return null;
    const vendor = u32le(t, 8);
    if (12 + vendor + 4 > t.length) return null;
    let p = 12 + vendor;
    const count = u32le(t, p);
    p += 4;
    if (count > (t.length - p) / 4) return null;
    const keep = [];
    for (let i = 0; i < count; i++) {
      if (p + 4 > t.length) return null;
      const n = u32le(t, p);
      if (p + 4 + n > t.length) return null;
      if (!frontCover(t, p + 4, p + 4 + n)) keep.push([p, p + 4 + n]);
      p += 4 + n;
    }
    const comment = KEY.length + b64len(block.length);
    const kept = keep.reduce((s, [a, z]) => s + z - a, 0);
    const out = new Uint8Array(12 + vendor + 4 + kept + 4 + comment + (t.length - p));
    out.set(t.subarray(0, 12 + vendor));
    let o = 12 + vendor;
    setLe(out, o, keep.length + 1);
    o += 4;
    for (const [a, z] of keep) { out.set(t.subarray(a, z), o); o += z - a; }
    setLe(out, o, comment);
    o += 4;
    out.set(KEY, o);
    o = base64Into(block, out, o + KEY.length);
    // Whatever follows the comments (padding, or data kept by RFC 7845 §5.2) stays.
    out.set(t.subarray(p), o);
    return out;
  }

  /** A packet laced onto pages of its own: 255 lacing values a page, continued after the first, granule 0. */
  function pagesOf(packet, serial, seq) {
    const segs = Math.floor(packet.length / 255) + 1;
    const pages = Math.ceil(segs / 255);
    const out = new Uint8Array(pages * 27 + segs + packet.length);
    let o = 0, body = 0;
    for (let i = 0; i < pages; i++) {
      const n = Math.min(255, segs - i * 255);
      const at = o;
      out.set(OGGS, o);
      out[o + 4] = 0;
      out[o + 5] = i ? 1 : 0;
      // granule (6-13): 0, as a header page's must be
      setLe(out, o + 14, serial);
      setLe(out, o + 18, seq + i);
      out[o + 26] = n;
      o += 27;
      let size = 0;
      for (let k = 0; k < n; k++) {
        const left = packet.length - body - size;
        const v = left >= 255 ? 255 : left;
        out[o++] = v;
        size += v;
      }
      out.set(packet.subarray(body, body + size), o);
      o += size;
      body += size;
      setLe(out, at + 22, pageCrc(out, at, o - at));
    }
    return { bytes: out, count: pages };
  }

  /** A page's header read at `p` of `b[0..len)`: null while it is not all there; false when it is not a page. */
  function header(b, p, len) {
    if (len - p < 27) return isCapture(b, p) || len - p < 4 ? null : false;
    if (!isCapture(b, p) || b[p + 4] !== 0) return false;
    const n = b[p + 26];
    if (len - p < 27 + n) return null;
    let body = 0;
    for (let i = 0; i < n; i++) body += b[p + 27 + i];
    return { flags: b[p + 5], serial: u32le(b, p + 14), seq: u32le(b, p + 18), crc: u32le(b, p + 22), segs: n, size: 27 + n + body };
  }

  /**
   * The embedder: push(chunk) gives the bytes to write so far, end() the rest, in order. `added` is the
   * bytes the file grows by (known once the head is written: before then 0); `embedded` whether it did.
   */
  class Embedder {
    /** @param {Uint8Array | null} block a FLAC picture block (pictureBlock); none: everything as it came */
    constructor(block) {
      this.block = block;
      this.added = 0;
      this.embedded = false;
      /** 'head' (holding), 'pages' (renumbering), 'pass' (as it came) */
      this.state = block?.length ? 'head' : 'pass';
      this.buf = new Uint8Array(8192);
      this.len = 0;
      this.pos = 0;
      this.step = 0;
      this.serial = 0;
      this.tagsAt = 0;
      this.tagsSeq = 0;
      this.tagsPages = 0;
      /** The tags packet's pieces in `buf`: [start, end]. */
      this.parts = [];
      this.delta = 0;
      this.carry = null;
    }

    /** @param {Uint8Array} chunk @returns {Uint8Array[]} */
    push(chunk) {
      if (!chunk?.length) return [];
      if (this.state === 'pass') return [chunk];
      if (this.state === 'pages') return this.pages(chunk);
      if (this.len + chunk.length > this.buf.length) {
        const grown = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length));
        grown.set(this.buf.subarray(0, this.len));
        this.buf = grown;
      }
      this.buf.set(chunk, this.len);
      this.len += chunk.length;
      const r = this.readHead();
      if (r === 'wait') return this.len > HEAD_LIMIT ? this.giveUp() : [];
      // (The head must end within HEAD_LIMIT: a chunk can bring its end past it, as well as the bytes to wait for.)
      if (r === 'no' || this.pos > HEAD_LIMIT) return this.giveUp();
      return this.writeHead();
    }

    /** @returns {Uint8Array[]} */
    end() {
      if (this.state === 'head') return this.giveUp();
      if (this.state === 'pages' && this.carry) {
        const c = this.carry;
        this.carry = null;
        this.state = 'pass';
        return [c];
      }
      return [];
    }

    giveUp() {
      this.state = 'pass';
      const all = this.buf.subarray(0, this.len);
      this.buf = new Uint8Array(0);
      this.len = 0;
      return all.length ? [all] : [];
    }

    /** Reads the head's pages held so far: 'wait' for more, 'no' (not one Ogg Opus stream's head), 'done'. */
    readHead() {
      const b = this.buf;
      for (;;) {
        const h = header(b, this.pos, this.len);
        if (h === false) return 'no';
        if (!h || this.len - this.pos < h.size) return 'wait';
        const p = this.pos;
        if (pageCrc(b, p, h.size) !== h.crc || h.flags & 4) return 'no';
        const lace = p + 27, body = lace + h.segs;
        if (this.step === 0) {
          // OpusHead, alone on the stream's first page.
          if (h.flags !== 2 || !h.segs || b[lace + h.segs - 1] === 255 || h.size - 27 - h.segs < 19 || !same(b, body, OPUS_HEAD) || b[body + 8] >= 16) return 'no';
          for (let i = 0; i < h.segs - 1; i++) if (b[lace + i] !== 255) return 'no';
          this.serial = h.serial;
          this.step = 1;
          this.pos += h.size;
          this.tagsAt = this.pos;
          continue;
        }
        // OpusTags, from the next page on, on pages of its own; another stream's page here: not one stream.
        if (h.serial !== this.serial || h.flags & 2 || (h.flags & 1) !== (this.tagsPages ? 1 : 0)) return 'no';
        if (!this.tagsPages) this.tagsSeq = h.seq;
        this.tagsPages++;
        let at = body;
        for (let i = 0; i < h.segs; i++) {
          const v = b[lace + i];
          if (v) this.parts.push([at, at + v]);
          at += v;
          if (v < 255) {
            // The packet ends: it must end its page too.
            if (i !== h.segs - 1) return 'no';
            this.pos += h.size;
            return 'done';
          }
        }
        this.pos += h.size;
      }
    }

    /** The head written again with the picture, and the bytes after it passed on. */
    writeHead() {
      const b = this.buf;
      const size = this.parts.reduce((n, [a, z]) => n + z - a, 0);
      const tags = new Uint8Array(size);
      let o = 0;
      for (const [a, z] of this.parts) { tags.set(b.subarray(a, z), o); o += z - a; }
      const next = withPicture(tags, this.block);
      if (!next) return this.giveUp();
      const pages = pagesOf(next, this.serial, this.tagsSeq);
      this.delta = pages.count - this.tagsPages;
      this.added = pages.bytes.length - (this.pos - this.tagsAt);
      this.embedded = true;
      const out = [b.slice(0, this.tagsAt), pages.bytes];
      const rest = b.slice(this.pos, this.len);
      this.buf = new Uint8Array(0);
      this.len = 0;
      this.parts = [];
      this.state = this.delta ? 'pages' : 'pass';
      if (rest.length) out.push(...this.push(rest));
      return out;
    }

    /** Pages after the head: this stream's renumbered by `delta`, their CRCs made again. */
    pages(chunk) {
      const out = [];
      let data = chunk;
      // A page begun in the last chunk: completed from this one.
      while (this.carry && data.length) {
        const c = this.carry;
        const h = header(c, 0, c.length);
        if (h === false) return this.pass(out, c, data);
        const want = h ? h.size : c.length < 27 ? 27 : 27 + c[26];
        const take = Math.min(want - c.length, data.length);
        const grown = new Uint8Array(c.length + take);
        grown.set(c);
        grown.set(data.subarray(0, take), c.length);
        data = data.subarray(take);
        this.carry = grown;
        if (h && grown.length === h.size) {
          this.carry = null;
          if (!this.fix(grown, 0, h)) return this.pass(out, grown, data);
          out.push(grown);
          if (this.state === 'pass') { if (data.length) out.push(data); return out; }
        }
      }
      if (!data.length) return out;
      const copy = data.slice();
      let p = 0;
      while (p < copy.length) {
        const h = header(copy, p, copy.length);
        if (h === false) return this.pass(out, copy.subarray(0, p), copy.subarray(p));
        if (!h || copy.length - p < h.size) { this.carry = copy.slice(p); break; }
        if (!this.fix(copy, p, h)) return this.pass(out, copy.subarray(0, p), copy.subarray(p));
        p += h.size;
        if (this.state === 'pass') break;
      }
      if (p) out.push(copy.subarray(0, p));
      if (this.state === 'pass' && p < copy.length) out.push(copy.subarray(p));
      return out;
    }

    /** One page renumbered in place (another stream's left as it is); false when its CRC is wrong. */
    fix(b, p, h) {
      if (h.serial !== this.serial) return true;
      if (pageCrc(b, p, h.size) !== h.crc) return false;
      setLe(b, p + 18, (h.seq + this.delta) >>> 0);
      setLe(b, p + 22, pageCrc(b, p, h.size));
      // The stream's last page: whatever follows is not this stream's.
      if (h.flags & 4) this.state = 'pass';
      return true;
    }

    /** From here on, everything as it came. */
    pass(out, ...parts) {
      this.state = 'pass';
      this.carry = null;
      for (const x of parts) if (x.length) out.push(x);
      return out;
    }
  }

  /**
   * The cover to embed: the stored bytes as they are up to COVER_LIMIT; a larger one as a JPEG at most
   * COVER_PX on its long side (quality 0.9) where the worker can draw (OffscreenCanvas, createImageBitmap),
   * else as it is. @param {Uint8Array} bytes @param {string} [mime]
   */
  async function fitCover(bytes, mime = '') {
    const info = imageInfo(bytes, mime);
    if (bytes.length > COVER_LIMIT && typeof g.OffscreenCanvas === 'function' && typeof g.createImageBitmap === 'function') {
      try {
        const bmp = await g.createImageBitmap(new Blob([bytes], { type: info.mime }));
        const s = Math.min(1, COVER_PX / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
        const canvas = new g.OffscreenCanvas(w, h);
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
        bmp.close?.();
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: h, depth: 24 };
      } catch {}
    }
    return { bytes, ...info };
  }

  /** A stream's chunks with the cover embedded. @param {AsyncIterable<Uint8Array>} source @param {Uint8Array} block */
  async function* embed(source, block, e = new Embedder(block)) {
    for await (const c of source) for (const o of e.push(c)) if (o.length) yield o;
    for (const o of e.end()) if (o.length) yield o;
  }

  g.thOggCover = { Embedder, embed, pictureBlock, imageInfo, fitCover, pageCrc, HEAD_LIMIT, COVER_LIMIT };
})();
