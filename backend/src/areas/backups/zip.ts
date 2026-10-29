// A ZIP streamed from parts already deflated in the bucket (APPNOTE 6.3.10: local headers, the
// central directory, the end record; method 8, UTF-8 names, no ZIP64: an export stays far below
// 4 GB and 65,535 files). Each file's CRC-32 and both sizes are known before the download starts,
// so the bytes go straight from R2 to the phone and nothing is built in memory.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ZIP's) of some bytes. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Raw deflate (ZIP method 8) of some bytes. */
export async function deflate(bytes: Uint8Array): Promise<ArrayBuffer> {
  return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
}

export interface ZipEntry {
  name: string;
  crc: number;
  size: number;
  csize: number;
  /** The deflated bytes, read when the stream reaches this entry. */
  open(): Promise<ReadableStream<Uint8Array> | null>;
}

/** MS-DOS time and date of an instant (UTC). */
function dos(at: number): [number, number] {
  const d = new Date(at);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(d.getUTCFullYear(), 1980) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return [time, date];
}

const enc = new TextEncoder();

function header(sig: number, e: ZipEntry, name: Uint8Array, at: number, central: number | null): Uint8Array {
  const [time, date] = dos(at);
  const b = new Uint8Array((central === null ? 30 : 46) + name.length);
  const v = new DataView(b.buffer);
  let o = 0;
  const u32 = (x: number) => {
    v.setUint32(o, x >>> 0, true);
    o += 4;
  };
  const u16 = (x: number) => {
    v.setUint16(o, x, true);
    o += 2;
  };
  u32(sig);
  if (central !== null) u16(20); // made by
  u16(20); // needed to extract
  u16(0x0800); // UTF-8 names
  u16(8); // deflate
  u16(time);
  u16(date);
  u32(e.crc);
  u32(e.csize);
  u32(e.size);
  u16(name.length);
  u16(0); // extra
  if (central !== null) {
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(central); // where its local header is
  }
  b.set(name, o);
  return b;
}

/** The ZIP's length in bytes, for Content-Length. */
export const zipLength = (entries: ZipEntry[]) =>
  entries.reduce((n, e) => n + 30 + 46 + 2 * enc.encode(e.name).length + e.csize, 22);

/** The ZIP as a stream. A missing part ends the stream with an error, so the download fails
 * rather than saving a broken file. */
export function zipStream(entries: ZipEntry[], at: number): ReadableStream<Uint8Array> {
  const offsets: number[] = [];
  let i = 0;
  let offset = 0;
  let central = false;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (i < entries.length) {
        const e = entries[i++];
        const name = enc.encode(e.name);
        offsets.push(offset);
        const head = header(0x04034b50, e, name, at, null);
        c.enqueue(head);
        offset += head.length;
        const body = await e.open();
        if (!body) {
          c.error(new Error('missing part'));
          return;
        }
        const reader = body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          c.enqueue(value);
        }
        if (got !== e.csize) c.error(new Error('part size'));
        offset += got;
        return;
      }
      if (central) {
        c.close();
        return;
      }
      central = true;
      const start = offset;
      let size = 0;
      for (const [n, e] of entries.entries()) {
        const h = header(0x02014b50, e, enc.encode(e.name), at, offsets[n]);
        size += h.length;
        c.enqueue(h);
      }
      const end = new Uint8Array(22);
      const v = new DataView(end.buffer);
      v.setUint32(0, 0x06054b50, true);
      v.setUint16(8, entries.length, true);
      v.setUint16(10, entries.length, true);
      v.setUint32(12, size, true);
      v.setUint32(16, start, true);
      c.enqueue(end);
    },
  });
}
