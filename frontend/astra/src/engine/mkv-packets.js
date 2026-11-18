// Astra's own Matroska packet reader, for the picture and the sound passed
// through untouched when a film is re-wrapped (remux.js, remux-audio.js).
// Mediabunny loads a cluster whole (up to 5 MB or 5 s) before it hands out its
// first packet; here each block is handed out as soon as its bytes have arrived
// (mkv-blocks.js), so a start or a far seek waits for the first frames, not for
// the cluster. A seek goes by the cue index (read once with the header,
// mkv.js), straight to the key frame's block when the cue says where it sits.
//
// Each track's sink offers what the pipelines use of Mediabunny's
// EncodedPacketSink (getFirstPacket, getNextPacket, getKeyPacket, getPacket,
// getFirstTimestamp) and hands out real MB.EncodedPacket objects with the
// timestamps, durations and key flags Mediabunny gives, so the writer side is
// untouched. The picture and sound sinks share the clusters they read: a
// cluster is read and parsed once, and only a few are held.

import * as MB from '../../vendor/mediabunny.js';
import {clusterBlocks, unlace, MkvFallback} from './mkv-blocks.js';
import {header} from './mkv.js';
import {TrackSink} from './mkv-sink.js';

export {MkvFallback};
const KEEP = 3; // parsed clusters held for the sinks to share
// A frame lasts until the next one shown, which can come several blocks later (B-frames): a block is handed out once
// the gap to the nearest later time is no more than a frame lasts (none can be nearer), or this many blocks later.
const HOLD = {video: 16, audio: 1};
const TOP = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770, 0xec, 0xbf]);
const TRUEHD_SYNC = 0xf8726fba;

/** The reader for a probed Matroska or WebM film (probe.js info) read through `read(start, end)`, or null when Mediabunny should read it. */
export function mkvPackets(info, read) {
  const layout = info?.layout;
  if (!layout || layout.unknownClusterSizes || layout.firstCluster == null || !layout.trackCues?.size) return null;
  return new MkvPackets(layout, read);
}

class MkvPackets {
  constructor(layout, read) {
    Object.assign(this, {layout, read, end: layout.segmentEnd});
    this.factor = 1e9 / layout.timestampScale; // ticks in a second, as Mediabunny counts them
    this.wanted = new Set();
    this.tracks = new Map(); // track number -> what reading it needs
    this.clusters = new Map(); // position -> Cluster, oldest first
    this.after = new Map(); // a cluster's position -> the next cluster's (null at the end)
    this.where = new WeakMap(); // packet -> {cluster, track, index}
    this.sinks = new Map(); // track id -> its sink (or null)
    this.epoch = 0; // playback's jumps so far (jumped)
  }

  /** Playback jumped elsewhere (remux.js restartAt): a cluster taken before is the dropped pipelines', never read again. */
  jumped() { this.epoch++; }

  /** The sink for a probed track ({id, type, codec, ref}), or null when this reader leaves it to Mediabunny. */
  sink(track) {
    if (!track || !['video', 'audio'].includes(track.type)) return null;
    if (this.sinks.has(track.id)) return this.sinks.get(track.id);
    const t = this.layout.tracks.find(x => x.number === track.id && x.type === (track.type === 'video' ? 1 : 2));
    const c = t?.compression;
    // Compression other than header stripping (zlib), encryption or several encodings: Mediabunny reads the film.
    const usable = t && (!c || (!c.encrypted && c.algo === 3 && c.settings && t.encodings === 1));
    // Its own cues, else the picture's, else the longest list: [track number, points].
    const index = this.layout.trackCues, video = this.layout.tracks.find(x => x.type === 1)?.number;
    const [cueTrack, cues] = [t?.number, video].filter(n => index.has(n)).map(n => [n, index.get(n)])[0] || [...index].sort((a, b) => b[1].length - a[1].length)[0] || [];
    let sink = null; // none: Mediabunny reads the track
    if (usable && cues?.length) {
      this.tracks.set(t.number, {
        number: t.number, kind: track.type, codec: track.codec, cues, cueTrack, own: cueTrack === t.number, strip: c ? c.settings : null,
        delay: Math.round(this.factor * (t.codecDelay || 0) / 1e9),
        defaultTicks: t.defaultDuration != null ? this.factor * t.defaultDuration / 1e9 : null,
      });
      this.wanted.add(t.number);
      sink = new TrackSink(this, t.number, track.ref);
    }
    this.sinks.set(track.id, sink);
    return sink;
  }

  /**
   * True when the film plainly starts at 0:00: its picture's first cue is within 0.05 s of zero, so nothing starts later
   * (no shift is needed) and the first cluster need not be read to find out: a resume's download stays where it is.
   */
  startsAtZero() {
    const video = this.layout.tracks.find(t => t.type === 1), first = video && this.layout.trackCues.get(video.number)?.[0];
    return !!first && first.ticks / this.factor <= 0.05;
  }

  /** The parsed cluster at `pos` holding `track`, read from `from` (a cue's relative position, its block `check`) or earlier. */
  cluster(pos, from, track, check = null) {
    const held = this.clusters.get(pos);
    if (held && held.wanted.has(track) && held.from <= from && !held.error) { this.clusters.delete(pos); this.clusters.set(pos, held); held.epoch = this.epoch; return held; }
    return this.replace(pos, from, check);
  }

  /** A fresh read of the cluster at `pos`, from `from`, held in place of any before it. */
  replace(pos, from, check = null) {
    const c = new Cluster(this, pos, from, check);
    this.clusters.delete(pos);
    this.clusters.set(pos, c);
    while (this.clusters.size > KEEP) this.clusters.delete(this.clusters.keys().next().value);
    return c;
  }

  /** Frame `i` of `track` in cluster `c` (read on until it is there), or null when the cluster has no more. */
  async frame(c, track, i) {
    while (c.successor) c = c.successor;
    for (let again = true; ; again = false) {
      try {
        const list = c.list(track);
        while (list.length <= i && !c.done) await c.more();
        return list[i] || null;
      } catch (e) {
        // A read refused because playback moved (the range reader's jumped()) was asked for by the pipelines being
        // dropped; a new pipeline that took the same cluster meanwhile reads it afresh (the same frames, in order). One
        // taken only before the jump is not: read again for a pipeline on its way out, it began a download at the place
        // left that took half the link from the new one (a far seek on a 25 Mbit/s film at 20 Mbit/s: 8.7 s, 21 MB).
        if (!again || e?.kind !== 'closed' || c.epoch !== this.epoch) throw e;
        const held = this.clusters.get(c.pos);
        c = c.successor ??= held && held !== c && !held.error && held.from === c.from && held.wanted.has(track) ? held : this.replace(c.pos, c.from);
      }
    }
  }

  /** Where the cluster after `c` begins, or null at the end of the film. */
  async next(c) {
    while (c.successor) c = c.successor;
    if (this.after.has(c.pos)) return this.after.get(c.pos);
    let at = c.cut ? null : c.endPos;
    for (let guard = 0; at != null; guard++) {
      if (at + 2 > this.end) { at = null; break; }
      const bytes = await this.read(at, Math.min(this.end, at + 12));
      const id = bytes.length >= 4 ? (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0 : 0;
      if (id === 0x1f43b675) break;
      if (id === 0x1a45dfa3 || bytes.length < 2) { at = null; break; } // another segment chained on: not read here
      const h = header(bytes, 0);
      if (!h || h.size == null || guard > 32 || !(TOP.has(h.id))) throw new MkvFallback('something unexpected between clusters');
      at += h.dataStart + h.size;
    }
    this.after.set(c.pos, at);
    return at;
  }

  /**
   * The frame of `track` at or before `ticks` that passes `test`, found by the cue index; `stop` ends a scan early.
   * `cued`: the track's own key frames are what its cues point at, so the cued one is the answer when the next cue is
   * past the place, or after the last cue once frames half a second past the place show no key frame can still come
   * (a key frame the index leaves out is passed over: the start is then a little earlier).
   * `near`: when the cued cluster's first frame is later than the place by no more than two of its own lengths, it is
   * the answer rather than the one before it, which sits at the end of the cluster before (unknown without reading
   * from the cue before, perhaps many clusters back): the sound at a key frame that begins a cluster.
   */
  async find(track, ticks, test, stop, cued = false, near = false) {
    const {cues, cueTrack} = this.tracks.get(track);
    let i = -1;
    for (let lo = 0, hi = cues.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (cues[m].ticks <= ticks) { i = m; lo = m + 1; } else hi = m - 1; }
    let jump = true; // first straight to the cued block; when that finds nothing, the whole cluster, then the cue before
    for (let guard = 0; guard < 64; guard++) {
      const cue = i >= 0 ? cues[i] : null, nextCue = cues[i + 1];
      const relative = jump && cue?.relative ? cue.relative : 0;
      let pos = cue ? cue.position : this.layout.firstCluster, from = relative, best = null, first = null;
      try {
        scan: for (; pos != null; from = 0) {
          const c = this.cluster(pos, from, track, from ? {track: cueTrack, ticks: cue.ticks} : null);
          for (let k = 0; ; k++) {
            const f = await this.frame(c, track, k);
            if (!f) break;
            first ??= f;
            if (f.ticks <= ticks && test(f) && (!best || f.ticks >= best.ticks)) best = f;
            // Past the place, or at the cued frame when the next cue is past it: nothing later can be a better answer.
            if (stop(f) || (cued && best && cue && best.ticks >= cue.ticks && (nextCue ? nextCue.ticks > ticks : f.ticks > ticks + this.factor / 2))) break scan;
          }
          pos = await this.next(c);
        }
      } catch (e) { // a cue whose relative position lands on no element: the cluster is read from its start instead
        if (!(relative && from === relative && e?.kind === 'mkv-fallback')) throw e;
        best = null;
      }
      if (best) return best;
      if (near && !relative && first && first.ticks - ticks <= 2 * first.packet.duration * this.factor) return first;
      if (relative) jump = false;
      else if (i < 0) return null;
      else { i--; jump = true; }
    }
    return null;
  }
}

// One cluster as it is read: each wanted track's frames, handed out in the file's order once their duration is known.
class Cluster {
  constructor(reader, pos, from, check) {
    Object.assign(this, {reader, pos, from, wanted: new Set(reader.wanted), frames: new Map(), pending: new Map(), seen: new Map(), epoch: reader.epoch});
    this.done = false; this.busy = null; this.error = null; this.dataStart = pos; this.endPos = null; this.cut = false;
    this.blocks = clusterBlocks(reader.read, pos, reader.end, this.wanted, from, check);
  }

  list(track) { if (!this.frames.has(track)) this.frames.set(track, []); return this.frames.get(track); }

  /** Reads on until another frame is handed out or the cluster ends; one read at a time, shared by every sink. */
  more() {
    if (this.error) return Promise.reject(this.error);
    return this.busy ??= this.step().catch(e => {
      // A read that failed (the file closed, the host gone) is the film's error; anything else here means this reader
      // cannot be trusted with the film, and Mediabunny's reader takes over.
      this.error = e?.kind || e?.name === 'InputDisposedError' ? e : new MkvFallback(String(e?.message || e));
      throw this.error;
    }).finally(() => { this.busy = null; });
  }

  async step() {
    for (let handed = false; !handed && !this.done;) {
      const {value, done} = await this.blocks.next();
      if (!done && value.head) { this.dataStart = value.dataStart; this.endPos = value.end; continue; }
      if (done || value.end) {
        this.done = true; this.cut = !!value?.cut;
        for (const track of this.pending.keys()) this.release(track, true);
        break;
      }
      const track = value.track;
      if (!this.pending.has(track)) { this.pending.set(track, []); this.seen.set(track, []); }
      value.index = this.seen.get(track).length;
      this.pending.get(track).push(value);
      this.seen.get(track).push(value.ticks);
      handed = this.release(track, false);
    }
  }

  /**
   * Hands out the track's waiting blocks whose duration is known: as Mediabunny reckons it, the gap to the next time
   * shown in the cluster, or for the last one its BlockDuration or the track's default. Laced blocks are split here.
   */
  release(track, final) {
    const info = this.reader.tracks.get(track), pending = this.pending.get(track), seen = this.seen.get(track);
    const list = this.list(track), factor = this.reader.factor;
    let handed = false;
    while (pending.length) {
      const b = pending[0];
      let gap = null;
      for (let j = Math.max(0, b.index - 64); j < seen.length; j++) {
        if (seen[j] === b.ticks && j > b.index) { gap = 0; break; }
        if (seen[j] > b.ticks && (gap == null || seen[j] - b.ticks < gap)) gap = seen[j] - b.ticks;
      }
      const sure = gap != null && (gap <= Math.ceil(info.defaultTicks ?? 0) || pending.length > HOLD[info.kind]);
      if (!final && !sure && pending.length <= 64) break;
      pending.shift();
      const frames = unlace(b.payload, b.lacing), n = frames.length;
      const span = b.lacing ? (gap ?? b.duration) || Math.round(n * (info.defaultTicks ?? 0))
        : gap ?? b.duration ?? (info.defaultTicks != null ? Math.round(info.defaultTicks) : 0);
      for (let u = 0; u < n; u++) {
        const t0 = b.ticks + Math.floor(span * u / n), t1 = b.ticks + Math.floor(span * (u + 1) / n);
        let data = frames[u];
        if (info.strip) { const d = new Uint8Array(info.strip.length + data.length); d.set(info.strip); d.set(data, info.strip.length); data = d; }
        const key = info.kind === 'audio' ? info.codec !== 'truehd' || (data.length >= 8 && new DataView(data.buffer, data.byteOffset).getUint32(4) === TRUEHD_SYNC) : b.key;
        const packet = new MB.EncodedPacket(data, key ? 'key' : 'delta', (t0 - info.delay) / factor, (t1 - t0) / factor, this.dataStart + list.length);
        this.reader.where.set(packet, {cluster: this, track, index: list.length});
        list.push({packet, ticks: t0, key});
      }
      handed = true;
    }
    return handed;
  }
}
