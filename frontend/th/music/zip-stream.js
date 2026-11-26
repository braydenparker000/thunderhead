// A zip written as a stream (Music's downloads, th/music/downloads.js): stored entries only (Opus does not
// compress), each written as its bytes pass, without knowing its size or CRC-32 first. Each entry is a local
// header with general-purpose bit 3 (sizes and CRC in a data descriptor after the data) and bit 11 (UTF-8
// names), its data, then that descriptor; the central directory and the end record come last. ZIP64 records
// are written when they are needed: an entry's offset or the directory past 4 GiB, more than 65,535 entries,
// or an entry of 4 GiB or more (its descriptor then has 8-byte sizes). Nothing is held but the entries' names
// and numbers. Classic script with no imports: Music's worker loads it with importScripts; the tests import it.
(() => {
  const g = /** @type {any} */ (globalThis);
  if (g.thZipStream) return;
  const MAX16 = 0xffff;
  const MAX32 = 0xffffffff;

  /** CRC-32 (IEEE 802.3, reflected 0xEDB88320), by table. */
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  /** The CRC-32 of `bytes` continued from `crc` (0 to start). @param {Uint8Array} bytes @param {number} [crc] */
  function crc32(bytes, crc = 0) {
    let c = ~crc >>> 0;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  }

  /** A moment as MS-DOS time and date (local, two-second steps; 1980 at the earliest). @param {Date} d */
  function dos(d) {
    const y = Math.max(1980, d.getFullYear());
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  /** Little-endian fields into a new array: [[size in bytes, value], ...]; 8-byte values may pass 2^32. */
  function record(fields, tail = null) {
    const n = fields.reduce((s, [w]) => s + w, 0);
    const out = new Uint8Array(n + (tail?.length ?? 0));
    const v = new DataView(out.buffer);
    let p = 0;
    for (const [w, x] of fields) {
      if (w === 2) v.setUint16(p, x, true);
      else if (w === 4) v.setUint32(p, x >>> 0, true);
      else { v.setUint32(p, x % 2 ** 32, true); v.setUint32(p + 4, Math.floor(x / 2 ** 32), true); }
      p += w;
    }
    if (tail) out.set(tail, p);
    return out;
  }

  const FLAGS = 0x0808; // bit 3: data descriptor; bit 11: UTF-8 names
  const enc = new TextEncoder();

  /**
   * A writer: begin(name) gives an entry's local header, data(chunk) passes its bytes on (counting them),
   * end() gives its data descriptor, finish() the central directory and end records. Write every array
   * returned, in order: the offsets are counted from them.
   */
  class ZipWriter {
    constructor({ now = () => new Date() } = {}) {
      this.now = now;
      /** Bytes written so far (the next record's offset). */
      this.offset = 0;
      /** @type {{ name: Uint8Array, crc: number, size: number, offset: number, time: number, date: number }[]} */
      this.entries = [];
      this.current = null;
    }

    /** @param {string} name */
    begin(name) {
      if (this.current) throw new Error('zip: an entry is open');
      const bytes = enc.encode(name);
      if (bytes.length > MAX16) throw new Error('zip: name too long');
      const { time, date } = dos(this.now());
      this.current = { name: bytes, crc: 0, size: 0, offset: this.offset, time, date };
      // Version 2.0; sizes and CRC are zero here and follow in the descriptor.
      const head = record([[4, 0x04034b50], [2, 20], [2, FLAGS], [2, 0], [2, time], [2, date], [4, 0], [4, 0], [4, 0], [2, bytes.length], [2, 0]], bytes);
      this.offset += head.length;
      return head;
    }

    /** @param {Uint8Array} chunk */
    data(chunk) {
      const e = this.current;
      if (!e) throw new Error('zip: no entry open');
      e.crc = crc32(chunk, e.crc);
      e.size += chunk.length;
      this.offset += chunk.length;
      return chunk;
    }

    end() {
      const e = this.current;
      if (!e) throw new Error('zip: no entry open');
      this.current = null;
      this.entries.push(e);
      const big = e.size >= MAX32;
      const desc = record([[4, 0x08074b50], [4, e.crc], [big ? 8 : 4, e.size], [big ? 8 : 4, e.size]]);
      this.offset += desc.length;
      return desc;
    }

    finish() {
      if (this.current) throw new Error('zip: an entry is open');
      const parts = [];
      const start = this.offset;
      let size = 0;
      for (const e of this.entries) {
        // ZIP64 extra (0x0001): only the fields whose 32-bit slots say 0xFFFFFFFF, in this order.
        const big = e.size >= MAX32, far = e.offset >= MAX32;
        const extra = big || far ? record([[2, 0x0001], [2, (big ? 16 : 0) + (far ? 8 : 0)], ...(big ? [[8, e.size], [8, e.size]] : []), ...(far ? [[8, e.offset]] : [])]) : new Uint8Array(0);
        const need = extra.length ? 45 : 20;
        const head = record([
          [4, 0x02014b50], [2, need], [2, need], [2, FLAGS], [2, 0], [2, e.time], [2, e.date], [4, e.crc],
          [4, big ? MAX32 : e.size], [4, big ? MAX32 : e.size], [2, e.name.length], [2, extra.length], [2, 0], [2, 0], [2, 0], [4, 0],
          [4, far ? MAX32 : e.offset],
        ]);
        const all = new Uint8Array(head.length + e.name.length + extra.length);
        all.set(head);
        all.set(e.name, head.length);
        all.set(extra, head.length + e.name.length);
        parts.push(all);
        size += all.length;
      }
      const count = this.entries.length;
      const end = start + size;
      const zip64 = count > MAX16 || start >= MAX32 || size >= MAX32 || end >= MAX32;
      if (zip64) {
        // The ZIP64 end of central directory record, then its locator.
        parts.push(record([[4, 0x06064b50], [8, 44], [2, 45], [2, 45], [4, 0], [4, 0], [8, count], [8, count], [8, size], [8, start]]));
        parts.push(record([[4, 0x07064b50], [4, 0], [8, end], [4, 1]]));
      }
      parts.push(record([[4, 0x06054b50], [2, 0], [2, 0], [2, Math.min(count, MAX16)], [2, Math.min(count, MAX16)], [4, zip64 && size >= MAX32 ? MAX32 : size], [4, zip64 && start >= MAX32 ? MAX32 : start], [2, 0]]));
      const n = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(n);
      let p = 0;
      for (const x of parts) { out.set(x, p); p += x.length; }
      this.offset += n;
      return out;
    }
  }

  g.thZipStream = { crc32, ZipWriter };
})();
