// Matroska clusters: finding the subtitle blocks inside them, and undoing a
// track's compression. parseCluster() reads a cluster held whole in memory;
// walkCluster() reads one in place from the range reader's cache, a few bytes
// at a time, and copies only the subtitle blocks it finds (a cluster is
// megabytes of picture; its subtitles are a few hundred bytes).

import {MKV_ID as ID, header, vint, uint, children} from './mkv.js';

const TOP_LEVEL = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, 0x1254c367, 0x1941a469, 0x1043a770]);

const MAX_INFLATED = 4 << 20; // one subtitle block, unpacked; anything bigger is not a subtitle (or is a zip bomb)
async function inflate(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_INFLATED) { reader.cancel().catch(() => {}); throw Error('A subtitle block unpacks to more than a subtitle can be.'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Elements a cluster may hold. Anything else inside a cluster of known size
// means the "cluster" was a chance byte match inside other data.
export const CLUSTER_CHILDREN = new Set([ID.Timestamp, ID.SimpleBlock, ID.BlockGroup, 0x5854, 0xa7, 0xab, 0xaf, 0xbf, 0xec]);

/**
 * Parses one cluster from bytes that start at its header.
 * Returns {blocks: [{track, start, duration (null if unknown), data}], length,
 * complete, valid}. `complete` is false when the bytes end before the cluster
 * does (more data needed); `valid` is false when the bytes are not a cluster.
 * A cluster of unknown size ends where the next top-level element starts.
 */
export function parseCluster(bytes, wanted, scale) {
  const out = {blocks: [], length: 0, complete: false, valid: false, time: null};
  const top = header(bytes, 0);
  if (!top || top.id !== ID.Cluster || (top.size != null && top.size > (256 << 20))) return out;
  const known = top.size != null, end = known ? top.dataStart + top.size : Infinity;
  if (known && end > bytes.length) { out.valid = true; return out; } // not all here yet
  let base = null, pos = top.dataStart;
  const block = (start, stop, duration) => {
    const track = vint(bytes, start);
    if (!track || !wanted.has(track.value) || base == null) return;
    const at = start + track.length;
    const relative = (bytes[at] << 8 | bytes[at + 1]) << 16 >> 16;
    if (bytes[at + 2] & 0x06) return; // laced subtitle blocks do not occur in practice
    out.blocks.push({track: track.value, start: (base + relative) * scale / 1e9, duration: duration == null ? null : duration * scale / 1e9, data: bytes.slice(at + 3, stop)});
  };
  while (pos < Math.min(end, bytes.length)) {
    if (!known && pos + 12 > bytes.length) return out; // need more bytes to know whether the cluster goes on
    const h = header(bytes, pos);
    if (!h) return out;
    if (!known && (TOP_LEVEL.has(h.id) || h.id === ID.EBML)) { out.length = pos; out.complete = true; break; }
    if (!CLUSTER_CHILDREN.has(h.id) || h.size == null) return out; // not a cluster after all
    const dataEnd = h.dataStart + h.size;
    if (dataEnd > end) return out;
    if (dataEnd > bytes.length) return out; // unknown-size cluster: more bytes needed
    if (h.id === ID.Timestamp) base = uint(bytes, h.dataStart, dataEnd);
    else if (h.id === ID.SimpleBlock) block(h.dataStart, dataEnd, null);
    else if (h.id === ID.BlockGroup) {
      let blockAt = null, duration = null;
      for (const c of children(bytes, h.dataStart, dataEnd)) {
        if (c.id === ID.Block) blockAt = c;
        else if (c.id === ID.BlockDuration) duration = uint(bytes, c.dataStart, c.dataEnd);
      }
      if (blockAt) block(blockAt.dataStart, blockAt.dataEnd, duration);
    }
    pos = dataEnd;
  }
  if (known) { out.length = end; out.complete = pos === end; }
  out.valid = out.complete && base != null;
  if (base != null) out.time = base * scale / 1e9;
  if (!out.valid) out.blocks = [];
  return out;
}

/**
 * Extracts subtitle blocks from one cluster's bytes.
 * Returns [{track, start, duration (null if unknown), data: Uint8Array}].
 */
export function clusterSubtitleBlocks(bytes, wanted, scale) {
  const parsed = parseCluster(bytes, wanted, scale);
  if (parsed.valid) return parsed.blocks;
  // A cluster of unknown size that runs to the end of the bytes given.
  const top = header(bytes, 0);
  if (top?.id === ID.Cluster && top.size == null) return parseCluster(concatEnd(bytes), wanted, scale).blocks;
  return [];
}

// Appends a Void element header so an unknown-size cluster read to the end of
// the file (or of the given bytes) parses as complete.
function concatEnd(bytes) {
  const out = new Uint8Array(bytes.length + 12);
  out.set(bytes);
  out.set([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00], bytes.length); // an empty cluster marks the end
  return out;
}

/** Undoes a track's content compression (zlib or header stripping). */
export async function decodeBlock(track, data) {
  const c = track.compression;
  if (!c || c.encrypted) return data;
  if (c.algo === 0) return inflate(data);
  if (c.algo === 3 && c.settings) { const out = new Uint8Array(c.settings.length + data.length); out.set(c.settings); out.set(data, c.settings.length); return out; }
  return data;
}

/** Reads a cluster's header to learn its total length: {length, unknown}. */
export function clusterLength(bytes) {
  const h = header(bytes, 0);
  if (!h || h.id !== ID.Cluster) return null;
  return h.size == null ? {length: null, dataStart: h.dataStart} : {length: h.dataStart + h.size, dataStart: h.dataStart};
}


const MAX_CLUSTER = 256 << 20;

/**
 * Reads the cluster that starts at `pos` in place. `peek(start, end)` returns cached bytes or null; `size` is the
 * file's. Returns {state: 'wait'} while bytes it needs are not cached, {state: 'drop'} when `pos` holds no cluster
 * (a chance match inside other data) or one too large to read, else {state: 'done', length, blocks} with each
 * wanted block as {track, start, duration (null if unknown), data} (data copied out of the cache).
 * A cluster of unknown size ends where the next top-level element starts, or at `maxUnknown` bytes.
 */
export function walkCluster(peek, pos, size, wanted, scale, maxUnknown = 48 << 20) {
  const WAIT = {state: 'wait'}, DROP = {state: 'drop'};
  const headAt = (at, limit) => { const b = peek(at, Math.min(at + 12, limit)); return b && {h: header(b, 0), short: b.length < 12}; };
  const top = headAt(pos, size);
  if (!top) return WAIT;
  if (!top.h || top.h.id !== ID.Cluster || (top.h.size != null && top.h.size > MAX_CLUSTER)) return DROP;
  const known = top.h.size != null, dataStart = pos + top.h.dataStart;
  const end = known ? dataStart + top.h.size : Math.min(size, pos + maxUnknown);
  if (known && end > size) return DROP;
  const blocks = [];
  let base = null, at = dataStart;
  const block = (start, stop, duration) => {
    const head = peek(start, Math.min(stop, start + 12));
    if (!head) return false;
    const track = vint(head, 0);
    if (!track || !wanted.has(track.value) || base == null || head.length < track.length + 3) return true;
    if (head[track.length + 2] & 0x06) return true; // laced subtitle blocks do not occur in practice
    const relative = (head[track.length] << 8 | head[track.length + 1]) << 16 >> 16;
    const data = peek(start + track.length + 3, stop);
    if (!data) return false;
    blocks.push({track: track.value, start: (base + relative) * scale / 1e9, duration: duration == null ? null : duration * scale / 1e9, data: data.slice()});
    return true;
  };
  while (at < end) {
    const got = headAt(at, end);
    if (!got) return known ? WAIT : at >= size ? done() : WAIT;
    const h = got.h;
    if (!h) return !known && got.short && at + 12 > size ? done() : DROP;
    if (!known && (TOP_LEVEL.has(h.id) || h.id === ID.EBML)) break;
    if (!CLUSTER_CHILDREN.has(h.id) || h.size == null) return DROP; // not a cluster after all
    const childStart = at + h.dataStart, childEnd = childStart + h.size;
    if (childEnd > end) return known ? DROP : childEnd > size ? DROP : WAIT;
    if (h.id === ID.Timestamp) { const b = peek(childStart, childEnd); if (!b) return WAIT; base = uint(b, 0, b.length); }
    else if (h.id === ID.SimpleBlock) { if (!block(childStart, childEnd, null)) return WAIT; }
    else if (h.id === ID.BlockGroup) {
      // A block group holds the block and its duration; a picture's can be large, so its children are read one by one.
      let blockAt = null, duration = null, c = childStart;
      while (c < childEnd) {
        const g = headAt(c, childEnd);
        if (!g) return WAIT;
        if (!g.h || g.h.size == null) return DROP;
        const s = c + g.h.dataStart, e = s + g.h.size;
        if (e > childEnd) return DROP;
        if (g.h.id === ID.Block) blockAt = [s, e];
        else if (g.h.id === ID.BlockDuration) { const b = peek(s, e); if (!b) return WAIT; duration = uint(b, 0, b.length); }
        c = e;
      }
      if (blockAt && !block(blockAt[0], blockAt[1], duration)) return WAIT;
    }
    at = childEnd;
  }
  if (!known && at >= end && end < size) return DROP; // longer than an unknown-size cluster is allowed to be
  return done();
  function done() { return base == null ? DROP : {state: 'done', length: at - pos, blocks, time: base * scale / 1e9}; }
}
