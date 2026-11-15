// One Matroska cluster read as its bytes arrive (for mkv-packets.js): the range
// reader is asked for a few kilobytes at a time, in order, and each block of a
// wanted track is handed out as soon as all of it is here, never waiting for the
// cluster's end. Sizes from the file are never trusted: every length is held to
// the element around it, and anything the reader cannot be sure of ends the
// film's use of this reader (MkvFallback) so Mediabunny's path takes over.

import {MKV_ID as ID, header, vint, uint, children} from './mkv.js';

const CHUNK = 16 << 10; // bytes asked for at a time when no element says how much it needs
const MAX_BLOCK = 64 << 20; // a block (or block group) larger than this is not one
const MAX_CLUSTER = 1 << 30;
const SKIP = new Set([0xec, 0xbf, 0xa7, 0xab, 0x5854]); // Void, CRC-32, Position, PrevSize, SilentTracks

/** Something this reader will not guess at: the film goes back to Mediabunny's reader. */
export class MkvFallback extends Error {
  constructor(why) { super(`Astra's Matroska reader stepped aside: ${why}`); this.kind = 'mkv-fallback'; }
}

/**
 * The cluster at `pos`, read in place. Yields {head: true, dataStart, end, base} once, then each wanted block as
 * {track, ticks (cluster time + its own), key, lacing, duration (BlockDuration or null), payload, at (its file
 * position)}, and finally {end: true, at (the cluster's end), cut (true when the file ends in it, or nothing more could be read)}. `from` (relative to the cluster's data) starts the walk at a block instead
 * of the first child (a cue's relative position); the cluster's timestamp is read first all the same.
 * `size` is the file's (or the segment's) end: a cluster cut off by it ends cleanly there.
 */
export async function* clusterBlocks(read, pos, size, wanted, from = 0) {
  let buf = new Uint8Array(0), bufStart = pos;
  // Makes sure bytes [at, at + n) are held (fewer at the end of the file); returns the offset of `at` in `buf`.
  const need = async (at, n) => {
    const want = Math.min(at + n, size), have = bufStart + buf.length;
    if (at >= bufStart && want <= have) return at - bufStart;
    const from = at >= bufStart && at <= have ? have : at, to = Math.min(size, Math.max(want, from + CHUNK));
    const more = to > from ? await read(from, to) : new Uint8Array(0);
    const keep = at >= bufStart && at <= have ? buf.subarray(at - bufStart) : new Uint8Array(0);
    const next = new Uint8Array(keep.length + more.length);
    next.set(keep); next.set(more, keep.length);
    buf = next; bufStart = at;
    return 0;
  };
  let o = await need(pos, 12);
  const top = header(buf, o);
  if (!top || top.id !== ID.Cluster) throw new MkvFallback('no cluster where one should be');
  if (top.size == null) throw new MkvFallback('a cluster of unknown size');
  if (top.size > MAX_CLUSTER) throw new MkvFallback('a cluster too large to be one');
  const dataStart = pos + top.dataStart;
  const end = Math.min(dataStart + top.size, size); // a damaged file's last cluster ends with the file
  let base = null, at = dataStart;
  const element = async () => {
    if (at >= end) return null;
    o = await need(at, 12);
    const h = header(buf, o);
    if (!h || h.size == null) { if (end - at < 12 && end < dataStart + top.size) return null; throw new MkvFallback('an element that cannot be read'); }
    const start = at + (h.dataStart - o), stop = start + h.size;
    if (stop > end) { if (end < dataStart + top.size) return null; throw new MkvFallback('an element larger than its cluster'); }
    return {id: h.id, start, stop};
  };
  // The cluster's timestamp is its first child in practice: read up to it, then jump to `from` when asked.
  while (base == null) {
    const e = await element();
    if (!e) break;
    if (e.id === ID.Timestamp) { o = await need(e.start, e.stop - e.start); base = uint(buf, o, o + e.stop - e.start); }
    else if (e.id === ID.SimpleBlock || e.id === ID.BlockGroup) throw new MkvFallback('a block before its cluster\'s time');
    at = e.stop;
  }
  const cut = end < dataStart + top.size; // the file ends inside this cluster: nothing follows it
  yield {head: true, dataStart, end, base: base ?? 0};
  if (base == null) { yield {end: true, at: end, cut}; return; }
  if (from > 0 && dataStart + from > at) at = dataStart + from;
  for (;;) {
    const e = await element();
    if (!e) break;
    const length = e.stop - e.start;
    if (e.id === ID.Timestamp) throw new MkvFallback('a second cluster time');
    if (e.id === ID.SimpleBlock || e.id === ID.BlockGroup) {
      if (length > MAX_BLOCK) throw new MkvFallback('a block too large to be one');
      // The track number comes first: blocks of tracks nobody reads are stepped over without being fetched.
      o = await need(e.start, Math.min(length, 32));
      let blockAt = e.start, blockEnd = e.stop;
      if (e.id === ID.BlockGroup) {
        const first = header(buf, o);
        if (first && first.id === ID.Block && first.size != null && e.start + (first.dataStart - o) + first.size <= e.stop) {
          blockAt = e.start + (first.dataStart - o); blockEnd = blockAt + first.size;
        } else blockAt = null; // the block is not first in its group: read the whole group to find it
      }
      if (blockAt != null) {
        const track = vint(buf, o + (blockAt - e.start));
        if (track && !wanted.has(track.value)) { at = e.stop; continue; }
      }
      o = await need(e.start, length);
      let duration = null, reference = false;
      if (e.id === ID.BlockGroup) {
        blockAt = null;
        for (const c of children(buf, o, o + length)) {
          if (c.id === ID.Block) { blockAt = e.start + (c.dataStart - o); blockEnd = e.start + (c.dataEnd - o); }
          else if (c.id === ID.BlockDuration) duration = uint(buf, c.dataStart, c.dataEnd);
          else if (c.id === ID.ReferenceBlock) reference = true;
        }
        if (blockAt == null) { at = e.stop; continue; }
      }
      const b = o + (blockAt - e.start), stop = o + (blockEnd - e.start), track = vint(buf, b);
      if (!track || !wanted.has(track.value) || stop - (b + track.length) < 3) { at = e.stop; continue; }
      const t = b + track.length, flags = buf[t + 2];
      const relative = (buf[t] << 8 | buf[t + 1]) << 16 >> 16;
      yield {track: track.value, ticks: base + relative, key: e.id === ID.SimpleBlock ? !!(flags & 0x80) : !reference,
        lacing: flags >> 1 & 3, duration, payload: buf.slice(t + 3, stop), at: e.start};
    }
    // Void, CRC-32 and anything else of known size inside the cluster are stepped over.
    else if (!SKIP.has(e.id) && length > MAX_BLOCK) throw new MkvFallback('an unknown element too large to step over');
    at = e.stop;
  }
  yield {end: true, at: end, cut: cut || at < end};
}

/** Splits a laced block's payload into its frames (Xiph 1, fixed 2, EBML 3), as Mediabunny does; throws when they do not add up. */
export function unlace(payload, lacing) {
  if (!lacing) return [payload];
  if (!payload.length) throw new MkvFallback('a laced block with nothing in it');
  const count = payload[0] + 1, sizes = [];
  let at = 1;
  if (lacing === 1) {
    let total = 0;
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      while (at < payload.length) { const v = payload[at++]; size += v; if (v < 255) break; }
      sizes.push(size); total += size;
    }
    sizes.push(payload.length - at - total);
  } else if (lacing === 2) {
    const each = Math.floor((payload.length - 1) / count);
    for (let i = 0; i < count; i++) sizes.push(each);
  } else if (count === 1) sizes.push(payload.length - at);
  else {
    let v = vint(payload, at);
    if (!v) throw new MkvFallback('a lace size that cannot be read');
    let size = v.value, total = size;
    at += v.length; sizes.push(size);
    for (let i = 1; i < count - 1; i++) {
      v = vint(payload, at);
      if (!v) throw new MkvFallback('a lace size that cannot be read');
      size += v.value - (2 ** (7 * v.length - 1) - 1); // a signed difference from the frame before
      at += v.length; sizes.push(size); total += size;
    }
    sizes.push(payload.length - at - total);
  }
  if (sizes.length !== count || sizes.some(s => !(s > 0))) throw new MkvFallback('lace sizes that do not match the block');
  const frames = [];
  for (const s of sizes) { if (at + s > payload.length) throw new MkvFallback('lace sizes that do not match the block'); frames.push(payload.subarray(at, at + s)); at += s; }
  return frames;
}
