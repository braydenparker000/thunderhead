// Collects the subtitles inside a file while it plays (Matroska and MP4).
//
// Subtitle samples are scattered through the file between audio and video,
// so they are read from bytes the video pipeline has already downloaded: the
// scanners only peek() at what is in the shared block cache, so they never ask
// the network for anything, never let a paused download read further, and
// leave the cache's order alone. Each block is looked at as it arrives, so
// seeking (with or without a cue index) needs nothing special: the new
// position's data arrives and its subtitles come with it. The scan gives the
// page a turn every 8 ms, as unpacking does.

import {BLOCK} from './http-source.js';
import {header, MKV_ID} from './mkv.js';
import {walkCluster, decodeBlock} from './mkv-cluster.js';
import {sampleText} from './mp4.js';
import {srtBlockCue, assBlockCue, parseAssHeader} from '../subtitles/parse.js';
import {PgsDecoder, PgsTimeline} from '../subtitles/pgs.js';
import {VobSubDecoder} from '../subtitles/vobsub.js';

const DEFAULT_DURATION = 5;
const MAX_UNKNOWN_CLUSTER = 48 << 20;
const SLICE_MS = 8;
const text = new TextDecoder();
const pageTurn = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));

/** Shared plumbing: listens for cached blocks and processes them in batches. */
class BlockScanner {
  constructor(source, onCues, onChange) {
    this.source = source;
    this.onCues = onCues;
    this.onChange = onChange;
    this.pending = new Set();
    this.timer = 0;
    this.running = false;
    this.stopped = false;
    this.unlisten = () => {};
    this.blockSize = source.blockSize || BLOCK;
    this.sliceStart = 0;
  }

  start() {
    if (!this.active) return;
    this.unlisten = this.source.onBlock(i => this.enqueue(i));
    for (const i of this.source.cachedBlocks()) this.enqueue(i);
  }

  /** Kept for callers that report seeks; arriving data drives the scan. */
  seek() {}

  enqueue(index) {
    this.pending.add(index);
    if (!this.timer && !this.running && !this.stopped) this.timer = setTimeout(() => { this.timer = 0; this.run(); }, 30);
  }

  /** Lets a tap or a frame through once the scan has held the page for 8 ms. */
  async breathe() {
    if (performance.now() - this.sliceStart < SLICE_MS) return;
    await pageTurn();
    this.sliceStart = performance.now();
  }

  /** Processes pending blocks until none are left; blocks that land meanwhile join the next pass. */
  async run() {
    if (this.running) return;
    this.running = true;
    this.sliceStart = performance.now();
    try {
      while (this.pending.size && !this.stopped) {
        const batch = [...this.pending].sort((a, b) => a - b);
        this.pending.clear();
        await this.process(batch).catch(() => {});
      }
    } finally { this.running = false; }
  }

  stop() { this.stopped = true; clearTimeout(this.timer); this.unlisten(); }
}

export class MkvSubtitleScanner extends BlockScanner {
  /**
   * @param {import('./http-source.js').HttpSource} source
   * @param {object} layout  from readLayout()
   * @param {Array} tracks   subtitleTracks(layout) entries (the player passes text tracks, and a picture track only once it is chosen)
   * @param {(trackId: string, cues: Array) => void} onCues
   * @param {() => void} [onChange]  cue end times changed (picture subtitles)
   */
  constructor(source, layout, tracks, onCues, onChange = () => {}) {
    super(source, onCues, onChange);
    this.layout = layout;
    this.tracks = new Map(tracks.filter(t => t.format && !t.encrypted).map(t => [t.number, t]));
    this.raw = new Map(layout.tracks.map(t => [t.number, t]));
    this.wanted = new Set(this.tracks.keys());
    this.headers = new Map();
    this.pictures = new Map();
    for (const t of this.tracks.values()) {
      if (t.format === 'ass') this.headers.set(t.number, parseAssHeader(t.header));
      if (t.format === 'pgs') this.pictures.set(t.number, {decoder: new PgsDecoder(t.id), timeline: new PgsTimeline()});
      if (t.format === 'vobsub') this.pictures.set(t.number, {decoder: new VobSubDecoder(t.header, t.id)});
    }
    this.known = new Set(); // every cluster position seen
    this.waiting = []; // positions not read or rejected yet, kept sorted
    this.searched = new Set();
    this.parsed = []; // sorted [start, end) of clusters already read, to drop matches inside them
    for (const c of layout.cues || []) this.add(c.position);
    if (layout.firstCluster != null) this.add(layout.firstCluster);
    this.clustersScanned = 0;
  }

  get active() { return this.tracks.size > 0; }
  get clustersRead() { return this.clustersScanned; }

  async process(batch) {
    for (const i of batch) { this.discover(i); await this.breathe(); if (this.stopped) return; }
    await this.readReady();
  }

  /** Finds cluster headers inside a newly cached block, looking at the cache in place. */
  discover(index) {
    const {source} = this;
    const from = index * this.blockSize, to = Math.min(source.size, from + this.blockSize);
    if (this.searched.has(index)) return;
    const bytes = source.peek(from, to);
    if (!bytes) return;
    this.searched.add(index);
    const first = this.layout.firstCluster ?? 0;
    const found = pos => { if (pos >= first && !this.inside(pos)) this.add(pos); };
    for (let p = bytes.indexOf(0x1f); p >= 0 && p + 4 <= bytes.length; p = bytes.indexOf(0x1f, p + 1)) {
      if (bytes[p + 1] === 0x43 && bytes[p + 2] === 0xb6 && bytes[p + 3] === 0x75) found(from + p);
    }
    // A header that straddles the edge with the block before: a few bytes either side, copied.
    const edge = from >= 3 ? source.peek(from - 3, Math.min(to, from + 3)) : null;
    if (edge) for (let p = 0; p < 3 && p + 4 <= edge.length; p++) {
      if (edge[p] === 0x1f && edge[p + 1] === 0x43 && edge[p + 2] === 0xb6 && edge[p + 3] === 0x75) found(from - 3 + p);
    }
  }

  add(pos) {
    if (this.known.has(pos)) return;
    this.known.add(pos);
    let lo = 0, hi = this.waiting.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.waiting[mid] < pos) lo = mid + 1; else hi = mid; }
    this.waiting.splice(lo, 0, pos);
  }

  /** True when pos falls strictly inside a cluster already read. */
  inside(pos) {
    let lo = 0, hi = this.parsed.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.parsed[mid][0] < pos) lo = mid + 1; else hi = mid; }
    const before = this.parsed[lo - 1];
    return !!before && pos < before[1];
  }

  markParsed(start, end) {
    let i = this.parsed.length;
    while (i > 0 && this.parsed[i - 1][0] > start) i--;
    this.parsed.splice(i, 0, [start, end]);
  }

  /** Reads every known cluster whose bytes are all cached. */
  async readReady() {
    const {source} = this;
    const scale = this.layout.timestampScale, peek = (s, e) => source.peek(s, e);
    const keep = [];
    for (const pos of this.waiting) {
      if (this.stopped) { keep.push(pos); continue; }
      if (this.inside(pos) || pos + 12 > source.size) continue;
      if (!source.has(pos, pos + 12)) { keep.push(pos); continue; }
      const h = header(source.peek(pos, pos + 12), 0);
      if (!h || h.id !== MKV_ID.Cluster) continue;
      // A cluster of known size is read once all of it is here; one of unknown size as far as the cache goes.
      if (h.size != null && !source.has(pos, pos + h.dataStart + h.size)) { keep.push(pos); continue; }
      const found = walkCluster(peek, pos, source.size, this.wanted, scale, MAX_UNKNOWN_CLUSTER);
      if (found.state === 'wait') { keep.push(pos); continue; }
      if (found.state === 'drop') continue;
      this.markParsed(pos, pos + found.length);
      this.clustersScanned++;
      await this.emit(found.blocks);
      await this.breathe();
    }
    this.waiting = keep; // nothing adds positions meanwhile: discover() runs only between passes
  }

  async emit(blocks) {
    const found = new Map();
    let changed = false;
    for (const block of blocks) {
      const track = this.tracks.get(block.track);
      let payload;
      try { payload = await decodeBlock(this.raw.get(block.track), block.data); } catch { continue; } // a damaged or oversized block is skipped
      let cue = null;
      const picture = this.pictures.get(block.track);
      if (picture?.timeline) {
        const result = picture.decoder.decode(payload, block.start);
        if (picture.timeline.add(result, block.duration)) changed = true;
        cue = result?.image ? result : null;
      } else if (picture) {
        cue = picture.decoder.decode(payload, block.start, block.duration);
      } else {
        const body = text.decode(payload);
        const end = block.start + (block.duration ?? DEFAULT_DURATION);
        cue = track.format === 'ass' ? assBlockCue(body, block.start, end, this.headers.get(block.track)) : srtBlockCue(body, block.start, end);
      }
      if (!cue) continue;
      if (!found.has(track.id)) found.set(track.id, []);
      found.get(track.id).push(cue);
    }
    for (const [id, cues] of found) this.onCues(id, cues);
    if (changed) this.onChange();
  }
}

export class Mp4SubtitleScanner extends BlockScanner {
  /**
   * @param {import('./http-source.js').HttpSource} source
   * @param {Array} tracks  readMp4Subtitles() entries (with samples)
   */
  constructor(source, tracks, onCues, onChange = () => {}) {
    super(source, onCues, onChange);
    this.tracks = tracks.filter(t => t.format && t.samples?.length);
    this.byBlock = new Map(); // block index -> [{track, sample}]
    for (const track of this.tracks) for (const sample of track.samples) {
      if (!sample.size) continue;
      for (let i = Math.floor(sample.offset / this.blockSize); i <= Math.floor((sample.offset + sample.size - 1) / this.blockSize); i++) {
        if (!this.byBlock.has(i)) this.byBlock.set(i, []);
        this.byBlock.get(i).push({track, sample});
      }
    }
    this.clustersScanned = 0;
  }

  get active() { return this.tracks.length > 0; }
  get clustersRead() { return this.clustersScanned; }

  async process(batch) {
    const found = new Map();
    for (const i of batch) {
      for (const entry of this.byBlock.get(i) || []) {
        const {track, sample} = entry;
        if (sample.done) continue;
        const bytes = this.source.peek(sample.offset, sample.offset + sample.size);
        if (!bytes) continue;
        sample.done = true;
        const body = sampleText(track.format, bytes);
        const cue = body.trim() ? srtBlockCue(body, sample.start, sample.end) : null;
        if (!cue) continue;
        if (!found.has(track.id)) found.set(track.id, []);
        found.get(track.id).push(cue);
      }
      this.clustersScanned++;
      await this.breathe();
    }
    for (const [id, cues] of found) this.onCues(id, cues);
  }
}
