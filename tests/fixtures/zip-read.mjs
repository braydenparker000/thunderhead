// A zip read back for the tests (Music's downloads, frontend/th/music/zip-stream.js), by its records and not
// by any library: the end record (and the ZIP64 one when it says so), the central directory's entries with
// their ZIP64 extras, and each entry's local header, data and data descriptor, checked against the directory.
import assert from 'node:assert/strict';

const u64 = (v, p) => v.getUint32(p, true) + v.getUint32(p + 4, true) * 2 ** 32;

/** The archive's entries: [{name, flags, crc, size, offset, data, descriptor}], checked as they are read.
 * @param {Uint8Array} bytes */
export function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  assert.ok(end >= 0, 'an end of central directory record');
  let count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  let zip64 = false;
  if (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50) {
    zip64 = true;
    const at = u64(v, end - 12);
    assert.equal(v.getUint32(at, true), 0x06064b50, 'the ZIP64 end record where its locator says');
    count = u64(v, at + 32);
    size = u64(v, at + 40);
    start = u64(v, at + 48);
  }
  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = [];
  let p = start;
  for (let n = 0; n < count; n++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, `central entry ${n}`);
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    let csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    let offset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // The ZIP64 extra: the 8-byte values of the fields whose slots say 0xFFFFFFFF, in order.
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
      const id = v.getUint16(e, true), len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) { usize = u64(v, q); q += 8; }
        if (csize === 0xffffffff) { csize = u64(v, q); q += 8; }
        if (offset === 0xffffffff) { offset = u64(v, q); q += 8; }
      }
      e += 4 + len;
    }
    assert.equal(method, 0, `${name} is stored`);
    assert.equal(csize, usize, `${name}: stored, so its sizes agree`);
    out.push({ name, flags, crc, size: usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(p - start, size, 'the central directory is as long as the end record says');
  for (const e of out) {
    // Entries whose data the test faked (past the bytes it holds) are checked by their records only.
    if (e.offset + 30 > bytes.length) continue;
    assert.equal(v.getUint32(e.offset, true), 0x04034b50, `${e.name}: a local header where the directory says`);
    assert.equal(v.getUint16(e.offset + 6, true), e.flags, `${e.name}: the same flags`);
    const nameLen = v.getUint16(e.offset + 26, true), extraLen = v.getUint16(e.offset + 28, true);
    assert.equal(dec.decode(bytes.subarray(e.offset + 30, e.offset + 30 + nameLen)), e.name);
    const at = e.offset + 30 + nameLen + extraLen;
    e.data = bytes.subarray(at, at + e.size);
    const d = at + e.size;
    assert.equal(v.getUint32(d, true), 0x08074b50, `${e.name}: a data descriptor after its data`);
    const big = e.size >= 0xffffffff;
    e.descriptor = { crc: v.getUint32(d + 4, true), size: big ? u64(v, d + 8) : v.getUint32(d + 8, true) };
    assert.deepEqual(e.descriptor, { crc: e.crc, size: e.size }, `${e.name}: the descriptor agrees with the directory`);
  }
  return { entries: out, zip64, start, size };
}
