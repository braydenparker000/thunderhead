// @ts-check
// A pack of looks as one `.zip` file, the way preset packs are passed around: the names of the files inside it and
// each one's bytes, read with what the browser has (DecompressionStream) and nothing else. Only what a pack needs:
// files stored as they are or deflated; no encryption, no zip64, no archive split in parts. Sizes are held to
// what the file itself says and to a limit, so a pack cannot fill the phone's memory.

/** The most files a pack may hold, and the most bytes one of them may open to. */
export const PACK_MAX_FILES = 2000, PACK_MAX_BYTES = 16 << 20;
const u16 = (/** @type {DataView} */ v, /** @type {number} */ o) => v.getUint16(o, true), u32 = (/** @type {DataView} */ v, /** @type {number} */ o) => v.getUint32(o, true);

/** @typedef {{ name: string, path: string, size: number, bytes: () => Promise<Uint8Array>, text: () => Promise<string> }} Packed */
/** The files in a zip, in its own order (folders and the hidden files a Mac adds left out). Throws with the reason
 * when it is not a zip this reads. @param {Blob} file @returns {Promise<Packed[]>} */
export async function unpack(file) {
  // the end record is in the last 64 KB + 22 bytes
  const tailAt = Math.max(0, file.size - 65_558), tail = new DataView(await file.slice(tailAt).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip file');
  const count = u16(tail, end + 10), size = u32(tail, end + 12), at = u32(tail, end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('too large a zip for this (zip64)');
  if (count > PACK_MAX_FILES) throw new Error(`more than ${PACK_MAX_FILES} files`);
  if (at + size > file.size) throw new Error('a zip cut short');
  const dir = new DataView(await file.slice(at, at + size).arrayBuffer()), out = /** @type {Packed[]} */ ([]), text = new TextDecoder();
  for (let o = 0, n = 0; n < count && o + 46 <= dir.byteLength && u32(dir, o) === 0x02014b50; n++) {
    const flags = u16(dir, o + 8), how = u16(dir, o + 10), packed = u32(dir, o + 20), full = u32(dir, o + 24), nameLen = u16(dir, o + 28), local = u32(dir, o + 42);
    const path = text.decode(new Uint8Array(dir.buffer, o + 46, nameLen));
    o += 46 + nameLen + u16(dir, o + 30) + u16(dir, o + 32);
    if (path.endsWith('/') || /(^|\/)(__MACOSX\/|\.)/.test(path)) continue;
    const bytes = async () => {
      if (flags & 1) throw new Error('locked with a password');
      if (how !== 0 && how !== 8) throw new Error('packed in a way this does not read');
      if (full > PACK_MAX_BYTES) throw new Error('too large');
      const head = new DataView(await file.slice(local, local + 30).arrayBuffer());
      if (head.byteLength < 30 || u32(head, 0) !== 0x04034b50) throw new Error('a zip cut short');
      const from = local + 30 + u16(head, 26) + u16(head, 28), raw = file.slice(from, from + packed);
      if (how === 0) return new Uint8Array(await raw.arrayBuffer());
      // read no further than the size the pack states: a file that opens to more is refused, not held
      const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), got = new Uint8Array(full);
      for (let have = 0; ;) {
        const { done, value } = await reader.read();
        if (done) { if (have !== full) throw new Error('a zip cut short'); return got; }
        if (have + value.length > full) { await reader.cancel(); throw new Error('larger than the pack says'); }
        got.set(value, have); have += value.length;
      }
    };
    out.push({ name: path.slice(path.lastIndexOf('/') + 1), path, size: full, bytes, text: async () => text.decode(await bytes()) });
  }
  return out;
}
