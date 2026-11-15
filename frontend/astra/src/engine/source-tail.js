// Both ends of a film at once, for Astra's range reader (http-source.js). Describing a film reads its start,
// then usually its end: Matroska's Cues, an MP4's moov at the back, and the last 64 KiB the subtitle hash
// needs. On a film's first open that is one more round trip after the header has been read. So as soon as
// the first answer has given the size, and the film is not remembered (film-memory.js), the last 256 KiB are
// asked for beside it (side-read.js); the bytes are laid where reads find them, and a read of the end waits
// for them instead of starting a download of its own. A film whose index lies outside that tail costs what it
// did before; a tail that fails changes nothing.

import {BLOCK, PROBE_AHEAD} from './source-stream.js';
import {sideRead} from './side-read.js';
import {recall, HEAD} from './film-memory.js';

export const TAIL = 256 << 10;

/** Records, as film-memory.js lays them, holding `bytes` from byte `start` of the file. */
export function records(start, bytes) {
  const recs = [];
  for (let at = start, end = start + bytes.length; at < end;) {
    const index = Math.floor(at / BLOCK), off = at - index * BLOCK, n = Math.min(BLOCK - off, end - at);
    recs.push({index, bytes: bytes.subarray(at - start, at - start + n), skew: off, from: off, filled: off + n});
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
  const start = size - TAIL;
  source.tailStart = start;
  source.tail = (async () => {
    await source.recall;
    if (source.closed || source.keptRanges) return; // remembered: its index comes from memory
    const bytes = await sideRead(source, start, size);
    if (source.closed) return;
    source.kept = [...(source.kept || []), ...records(start, bytes)];
    source.arrived(); // reads that came meanwhile by another way are answered
  })().catch(() => {}).finally(() => { source.tail = null; });
}

/** Before a read past the first 64 KiB: what memory holds is laid out, and a read of the end waits for the tail. */
export async function settled(source, start, end) {
  if (source.recall) await source.recall;
  if (source.tail && end > source.tailStart) await source.tail;
}
