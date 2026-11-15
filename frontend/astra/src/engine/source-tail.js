// Both ends of a film at once, for Astra's range reader (http-source.js). Describing a film reads its start,
// then usually its end: Matroska's Cues, an MP4's moov at the back, and the last 64 KiB the subtitle hash
// needs. On a film's first open that is one more round trip, and the hash's own request, after the header has
// been read. So as soon as the first answer has given the size, and the film is not remembered
// (film-memory.js), the file's last bytes are asked for beside it (side-read.js). They are laid where reads
// find them as they arrive, and a read of the end waits for them instead of starting a download of its own.
// A film whose index lies outside the tail costs what it did before; a tail that fails changes nothing.

import {BLOCK, PROBE_AHEAD} from './source-stream.js';
import {missing} from './source-blocks.js';
import {sideRead} from './side-read.js';
import {recall, HEAD} from './film-memory.js';

// The hash's 64 KiB, which also holds a small or short film's index. Measured on a paced host (80 ms a request,
// 375 kB/s), a 256 KiB tail took longer to arrive than the index read it saved; 64 KiB costs no byte the hash
// would not have fetched anyway.
export const TAIL = 64 << 10;

/** Records, as film-memory.js lays them, for `bytes` from byte `start` of the file; `at` is each one's place in `bytes`. */
export function records(start, bytes, filled = bytes.length) {
  const recs = [];
  for (let at = start, end = start + bytes.length; at < end;) {
    const index = Math.floor(at / BLOCK), off = at - index * BLOCK, n = Math.min(BLOCK - off, end - at);
    recs.push({index, bytes: bytes.subarray(at - start, at - start + n), skew: off, from: off, filled: off + Math.max(0, Math.min(n, filled - (at - start))), at: at - start});
    at += n;
  }
  return recs;
}

/** The first answer gave the size: the film is looked up in memory and, while it is described, its tail asked for. */
export function opened(source) {
  const size = source.size;
  if (source.memory && size >= 2 * HEAD) source.recall = recall(source).finally(() => { source.recall = null; });
  // A small film's first download reaches its end anyway; one opened again for playback needs no describing.
  if (!source.probing || !(size > PROBE_AHEAD + TAIL)) return;
  const tail = source.tail = {start: size - TAIL, waits: new Set(), done: null};
  const hear = () => { for (const w of [...tail.waits]) if (w.ok()) { tail.waits.delete(w); w.resolve(); } };
  tail.done = (async () => {
    await source.recall;
    if (source.closed || source.keptRanges) return; // remembered: its index comes from memory
    const out = new Uint8Array(TAIL), recs = records(tail.start, out, 0);
    source.kept = [...(source.kept || []), ...recs];
    await sideRead(source, tail.start, size, undefined, {into: out, onBytes: filled => {
      for (const r of recs) r.filled = r.from + Math.max(0, Math.min(r.bytes.length, filled - r.at));
      source.arrived(); hear(); // reads waiting by another way, and those waiting for the tail, are answered
    }});
  })().catch(() => {}).finally(() => { if (source.tail === tail) source.tail = null; for (const w of tail.waits) w.resolve(); tail.waits.clear(); });
}

/** Before a read past the first 64 KiB: what memory holds is laid out, and a read of the tail waits for its bytes to arrive. */
export async function settled(source, start, end) {
  if (source.recall) await source.recall;
  const tail = source.tail;
  if (!tail || !(end > tail.start)) return;
  // Inside the tail: answered as soon as its bytes are here. Across its start: the whole tail first, then the rest as usual.
  const ok = start >= tail.start ? () => missing(source, start, end) >= end : () => false;
  if (ok()) return;
  await new Promise(resolve => tail.waits.add({ok, resolve}));
}
