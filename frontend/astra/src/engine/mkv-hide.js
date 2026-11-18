// What Mediabunny and libmedia are not shown of a Matroska file (probe.js and software-loader.js hand it to them
// through this). Mediabunny walks the top-level elements before the first cluster and reads the Attachments and Tags
// elements whole, for attached files and the film's tags, which Astra takes from neither: the fonts of a styled
// subtitle track are read when such a track is shown (mkv-attachments.js). A film with an 8 MB font attached started
// 12.2 s after one without on a 5.4 Mbit/s link, having read 7.8 MB more (scripts/astra/real.mjs, 2026-11-18). Here, in
// the bytes handed over, those two elements' headers are written as Void elements of the same length, which Mediabunny
// skips by their size, so the next header is asked for past them (a request of its own). libmedia steps over a Void by
// reading through it, so for it (`fill`) the body of each, and of each Void, is zeros, never fetched; and since it
// goes back, after the first cluster, to each element its seek head names that it has not met, the seek head names
// the Info element (met) in place of the two, or it went back to them for ever. The file's bytes
// in the reader's cache, and what every other reader gets, are left as they are. Elements after the first cluster are
// left alone.

import {MKV_ID as ID, header} from './mkv.js';

const HIDDEN = new Set([ID.Attachments, 0x1254c367 /* Tags */]);
const VOID = 0xec;
const BIG = 64 << 10; // a body this large is zeros to libmedia; a smaller one is read through
const SEEK_ID = [0x53, 0xab, 0x84], INFO = [0x15, 0x49, 0xa9, 0x66]; // a seek entry's 4-byte id, and the Info element's
const ids = [...HIDDEN].map(id => [24, 16, 8, 0].map(shift => (id >>> shift) & 255));

/**
 * A Void element header, or empty Voids and then one, exactly `length` bytes long (an element's own id and size field,
 * 5 to 12 bytes), saying that `size` bytes follow it.
 */
export function voidHeader(length, size) {
  const out = new Uint8Array(length);
  let at = 0;
  // An empty Void (EC 80) is two bytes; the last one's size field is at most 8 bytes long.
  while (length - at - 1 > 8) { out[at++] = VOID; out[at++] = 0x80; }
  const n = length - at - 1;
  out[at++] = VOID;
  for (let i = n - 1, v = size; i >= 0; i--, v = Math.floor(v / 256)) out[at + i] = v % 256;
  out[at] |= 0x80 >> (n - 1);
  return out;
}

/**
 * Wraps `read(start, end)` (bytes [start, end) of the file, `size` bytes long) so that the Attachments and Tags
 * elements before the first cluster read as Void; `onHide(from, to)` is told the body of each, and of each Void, that
 * is passed over, and with `fill` those bodies are zeros, not read. The top-level headers are walked as far as each read reaches, a header at a time, so nothing is
 * asked for that Mediabunny would not ask for itself; `cluster` is where the first cluster lies once it is reached. A
 * file that is not Matroska, or one the walk cannot follow, is passed through untouched.
 */
export function hideElements(read, size, {onHide = () => {}, fill = false} = {}) {
  const marks = [], bodies = [], heads = []; // {at, bytes}: the header bytes rewritten; [from, to): the bodies passed over, the seek heads
  let next = null, done = false, walking = Promise.resolve();
  const headAt = async pos => header(await read(pos, Math.min(size, pos + 16)), 0);
  const walk = async end => {
    if (next == null) {
      const ebml = await headAt(0);
      if (!ebml || ebml.id !== ID.EBML || ebml.size == null) { done = true; return; }
      const at = ebml.dataStart + ebml.size, segment = await headAt(at);
      if (!segment || segment.id !== ID.Segment) { done = true; return; }
      next = at + segment.dataStart;
    }
    // A damaged file can hold endless tiny elements: the walk stops after a fair number.
    for (let guard = 0; !done && next < Math.min(end, size) && guard < 4096; guard++) {
      const h = await headAt(next);
      if (h?.id === ID.Cluster) view.cluster = [next, h.size == null ? Infinity : next + h.dataStart + h.size];
      if (!h || h.size == null || h.id === ID.Cluster) { done = true; return; }
      const from = next + h.dataStart, to = from + h.size;
      if (HIDDEN.has(h.id)) marks.push({at: next, bytes: voidHeader(h.dataStart, h.size)});
      if (HIDDEN.has(h.id) || h.id === VOID) { bodies.push([from, to]); onHide(from, to); } // a Void is passed over by its size as it is
      if (h.id === ID.SeekHead) heads.push([from, to]);
      next = to;
    }
  };
  // With `fill`, a read asks only for what lies outside the bodies passed over (those under 64 KiB are read through).
  const around = async (start, end) => {
    const over = bodies.filter(([from, to]) => to - from >= BIG && start < to && end > from);
    if (!over.length) return read(start, end);
    const out = new Uint8Array(end - start);
    let at = start;
    for (const [from, to] of [...over, [end, end]]) {
      if (from > at) out.set(await read(at, from), at - start);
      at = Math.max(at, to);
    }
    return out;
  };
  const view = async (start, end) => {
    if (!done) walking = walking.then(() => walk(end)).catch(() => { done = true; });
    const bytes = fill ? (await walking, await around(start, end)) : (await Promise.all([read(start, end), walking]))[0];
    let out = bytes;
    for (const {at, bytes: v} of marks) {
      const from = Math.max(start, at), to = Math.min(end, at + v.length);
      if (from >= to) continue;
      if (out === bytes) out = bytes.slice(); // the reader's own block is not written to
      out.set(v.subarray(from - at, to - at), from - start);
    }
    // For libmedia, a seek entry naming a hidden element (read whole by this read) names the Info element instead.
    if (fill) for (const [from, to] of heads) for (let i = Math.max(start, from); i + 7 <= Math.min(end, to); i++) {
      const at = i - start;
      if (SEEK_ID.every((b, k) => out[at + k] === b) && ids.some(id => id.every((b, k) => out[at + 3 + k] === b))) {
        if (out === bytes) out = bytes.slice();
        out.set(INFO, at + 3);
      }
    }
    return out;
  };
  view.cluster = null; // [start, end) of the first cluster, once the walk reaches it
  /** With `fill`: whether byte `at` lies in a body that is zeros (not read). */
  view.zeros = at => fill && bodies.some(([from, to]) => to - from >= BIG && at >= from && at < to);
  return view;
}
