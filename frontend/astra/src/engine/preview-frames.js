// Where a seek preview's key frame is, and its bytes, for player-preview.js. Everything here reads with side
// requests (side-read.js: bounded ranges that never touch playback's downloads or cache) and gives up on a key
// frame larger than PREVIEW.maxFrame rather than download it.
//   Matroska / WebM: the picture track's cue index, read with the header, says which cluster holds the key frame
//   and where in it; the block's header gives its size: a small first piece, then the rest (mkv-blocks.js).
//   MP4: Mediabunny's sample table (in memory) names the key frame without reading it (metadataOnly); its place
//   in the file comes from the movie box's sample tables, looked at in the reader's cache or fetched once.

import {clusterBlocks, unlace} from './mkv-blocks.js';
import {boxes} from './mp4.js';
import {cueAt, PREVIEW} from './preview.js';

export class TooLarge extends Error { constructor() { super('The key frame is too large to preview.'); this.kind = 'too-large'; } }

/**
 * A read through `side(start, end)` that refuses to pass `cap` bytes in all or `most` requests: a preview that
 * would cost more than a key frame gives up.
 */
export function bounded(side, cap = PREVIEW.maxFrame + (64 << 10), most = 6) {
  let spent = 0, asked = 0;
  return async (start, end) => {
    spent += end - start;
    if (spent > cap || ++asked > most) throw new TooLarge();
    return side(start, end);
  };
}

/** The Matroska picture track's places: locate(time) → {key, cue} for PreviewCache, and its reading facts; null without its own cues. */
export function mkvPlaces(layout, offset = 0) {
  const track = layout?.tracks?.find(t => t.type === 1), cues = track && layout.trackCues?.get(track.number);
  if (!cues?.length || layout.unknownClusterSizes) return null;
  const c = track.compression;
  if (c && (c.encrypted || c.algo !== 3 || track.encodings !== 1)) return null; // only header stripping is undone here
  const factor = 1e9 / layout.timestampScale;
  return {track: track.number, strip: c?.settings || null, end: layout.segmentEnd,
    locate: time => { const cue = cueAt(cues, Math.max(0, time + offset) * factor); return cue && {key: cue.ticks / factor - offset, cue}; }};
}

/** The bytes of the key frame a cue points at, read through `read` (bounded side requests). */
export async function mkvKeyFrame(places, cue, read) {
  const check = cue.relative ? {track: places.track, ticks: cue.ticks} : null;
  for (const from of cue.relative ? [cue.relative, 0] : [0]) {
    try {
      for await (const b of clusterBlocks(read, cue.position, places.end, new Set([places.track]), from, from ? check : null)) {
        if (b.head) continue;
        if (b.end) break;
        if (!b.key) continue; // a cluster read from its start: the key frame is the first key block of the track
        let data = unlace(b.payload, b.lacing)[0];
        if (places.strip) { const d = new Uint8Array(places.strip.length + data.length); d.set(places.strip); d.set(data, places.strip.length); data = d; }
        return data;
      }
      return null;
    } catch (e) { if (!(from && e?.kind === 'mkv-fallback')) throw e; } // a cue that misses its block: the cluster from its start
  }
  return null;
}

const u32 = (b, p) => (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
const kid = (bytes, box, type) => { for (const b of boxes(bytes, box.start, box.end)) if (b.type === type) return b; return null; };
const path = (bytes, box, ...types) => types.reduce((b, t) => b && kid(bytes, b, t), box);

/** Where the movie box is: {start, end}, found by stepping over the top-level boxes with `head(pos)` (16 bytes there). */
export async function findMoov(head, size) {
  for (let pos = 0, guard = 0; pos + 8 <= size && guard < 64; guard++) {
    const h = await head(pos);
    let length = u32(h, 0);
    if (length === 1) length = u32(h, 8) * 2 ** 32 + u32(h, 12); else if (length === 0) length = size - pos;
    if (length < 8) return null;
    if (String.fromCharCode(h[4], h[5], h[6], h[7]) === 'moov') return {start: pos, end: pos + length};
    pos += length;
  }
  return null;
}

/**
 * The picture track's sample table in a movie box: sampleAt(index) → {offset, size}, or null for a fragmented
 * film (its samples are in fragments, which only reading the film would find) or one with no such track.
 */
export function mp4Samples(moov, trackId) {
  const root = boxes(moov).next().value;
  if (!root || root.type !== 'moov' || kid(moov, root, 'mvex')) return null;
  let stbl = null;
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(moov, trak, 'mdia', 'hdlr'), tkhd = kid(moov, trak, 'tkhd');
    if (!hdlr || !tkhd || String.fromCharCode(...moov.subarray(hdlr.start + 8, hdlr.start + 12)) !== 'vide') continue;
    const id = u32(moov, tkhd.start + (moov[tkhd.start] === 1 ? 20 : 12)), here = path(moov, trak, 'mdia', 'minf', 'stbl');
    if (here && (id === trackId || !stbl)) stbl = here;
  }
  const stsz = stbl && kid(moov, stbl, 'stsz'), stsc = stbl && kid(moov, stbl, 'stsc'), stco = stbl && (kid(moov, stbl, 'stco') || kid(moov, stbl, 'co64'));
  if (!stsz || !stsc || !stco) return null;
  const wide = stco.type === 'co64', uniform = u32(moov, stsz.start + 4), count = u32(moov, stsz.start + 8);
  const chunks = Math.min(u32(moov, stco.start + 4), Math.floor((stco.end - stco.start - 8) / (wide ? 8 : 4)));
  const runs = Math.min(u32(moov, stsc.start + 4), Math.floor((stsc.end - stsc.start - 8) / 12));
  if (!count || !chunks || !runs || (!uniform && stsz.end - stsz.start - 12 < count * 4)) return null;
  const size = i => uniform || u32(moov, stsz.start + 12 + i * 4);
  const chunkAt = c => wide ? u32(moov, stco.start + 8 + c * 8) * 2 ** 32 + u32(moov, stco.start + 12 + c * 8) : u32(moov, stco.start + 8 + c * 4);
  return {count, sampleAt(index) {
    if (!(index >= 0 && index < count)) return null;
    // Runs of chunks with the same number of samples each: walk them to the chunk holding the sample.
    let first = 0;
    for (let r = 0; r < runs; r++) {
      const p = stsc.start + 8 + r * 12, chunk = u32(moov, p) - 1, per = u32(moov, p + 4);
      const last = r + 1 < runs ? u32(moov, p + 12) - 1 : chunks;
      if (!per || last <= chunk) continue;
      const inRun = (last - chunk) * per;
      if (index < first + inRun) {
        const c = chunk + Math.floor((index - first) / per), start = first + (c - chunk) * per;
        if (c >= chunks) return null;
        let offset = chunkAt(c);
        for (let i = start; i < index; i++) offset += size(i);
        return {offset, size: size(index)};
      }
      first += inRun;
    }
    return null;
  }};
}
