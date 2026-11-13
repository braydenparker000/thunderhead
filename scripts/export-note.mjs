#!/usr/bin/env node
// Prints the line an editor export carries on how it was made (frontend/lab/editor/app/export-note.js): a JPEG's
// comment (COM, just after its Exif), a PNG's tEXt Comment or a TIFF's ImageDescription. It sits near the start of
// the file, so a JPEG cut off part way still has it. Prints nothing and exits 1 when the file carries none.
// Usage: node scripts/export-note.mjs <file>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = (/** @type {Uint8Array} */ b) => String.fromCharCode(...b);

/** The note in a file's bytes, or ''. @param {Uint8Array} b */
export function noteIn(b) {
  if (b[0] === 0xff && b[1] === 0xd8) {   // JPEG: its segments up to the scan
    for (let a = 2; a + 4 <= b.length && b[a] === 0xff && b[a + 1] !== 0xda;) {
      const len = (b[a + 2] << 8) | b[a + 3];
      if (b[a + 1] === 0xfe) return text(b.subarray(a + 4, Math.min(b.length, a + 2 + len)));
      a += 2 + len;
    }
    return '';
  }
  if (b[0] === 0x89 && text(b.subarray(1, 4)) === 'PNG') {   // PNG: its chunks
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let a = 8; a + 8 <= b.length;) {
      const len = v.getUint32(a), type = text(b.subarray(a + 4, a + 8)), data = b.subarray(a + 8, Math.min(b.length, a + 8 + len));
      if (type === 'tEXt' && text(data.subarray(0, 8)) === 'Comment\0') return text(data.subarray(8));
      if (type === 'IDAT' || type === 'IEND') return '';
      a += 12 + len;
    }
    return '';
  }
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) {   // TIFF, little-endian (as the editor writes it): ImageDescription in its first directory
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), at = v.getUint32(4, true);
    for (let k = 0, n = v.getUint16(at, true); k < n; k++) {
      const p = at + 2 + k * 12;
      if (v.getUint16(p, true) !== 270) continue;
      const count = v.getUint32(p + 4, true), from = count > 4 ? v.getUint32(p + 8, true) : p + 8;
      return text(b.subarray(from, from + count)).replace(/\0+$/, '');
    }
  }
  return '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/export-note.mjs <file>'); process.exit(2); }
  const note = noteIn(new Uint8Array(readFileSync(file)));
  if (!note) { console.error('No note in this file (exported with metadata off, or not by the editor).'); process.exit(1); }
  console.log(note);
}
