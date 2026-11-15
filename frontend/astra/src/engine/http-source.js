// Reads a remote file in byte ranges for the remux engine.
//
// One open-ended range request ("bytes=N-") streams sequentially into 1 MiB
// blocks, the way a native player reads; a jump elsewhere starts another
// stream (source-stream.js holds one download and its retries). Reads are
// served from an LRU block cache shared by every consumer: Mediabunny's
// demuxer and the software decoder read(), which keeps a download going; the
// subtitle scanners peek(), which only looks at what playback already
// fetched, so they cost no network and never pull the download along.
//
// open() also answers the question the planner needs first: can a web page
// read this file at all (CORS) and does the host honour ranges?

import {BLOCK, READ_AHEAD, REUSE_WINDOW, TIMING, SourceError, parseContentRange, ask, runStream, streamFailed} from './source-stream.js';

export {BLOCK, TIMING, SourceError, parseContentRange};
const MAX_STREAMS = 2;

export class HttpSource {
  /** @param {string} url @param {{headers?: Record<string,string>, maxBytes?: number, fetchFn?: typeof fetch}} [options] */
  constructor(url, {headers = {}, maxBytes = 96 * BLOCK, fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
    this.url = url;
    this.given = url; // the address as it was handed over, before any redirect
    this.headers = headers;
    this.maxBlocks = Math.max(8, Math.floor(maxBytes / BLOCK));
    this.fetchFn = fetchFn;
    this.size = null;
    this.contentType = '';
    this.blocks = new Map(); // index -> Uint8Array, in LRU order
    this.waiters = new Map(); // index -> [{resolve, reject}]
    this.streams = new Set();
    this.listeners = new Set();
    this.closed = false;
    this.failures = 0;
    this.failingSince = 0;
    this.progressAt = 0; // when a download last brought a fair part of the file
    this.partials = new Map(); // index -> {bytes, filled}: the first part of a block a download broke off in
    this.stateListeners = new Set();
    this.bytesFetched = 0; // body bytes received, kept or not: what the film has cost
    this.readAhead = READ_AHEAD; // how far a download runs past the furthest block read (setReadAhead)
    this.probing = false;
    // Back online: waiting retries go now instead of at the end of their back-off.
    this.retries = new Set();
    this.onOnline = () => { for (const go of [...this.retries]) go(); };
    if (typeof addEventListener === 'function') addEventListener('online', this.onOnline);
  }

  /** Calls fn('reconnecting' | 'connected' | 'lost') when the connection to the host is lost and found again. */
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    for (const fn of this.stateListeners) fn(state);
  }

  /** Data arrived, or nothing waits for any: the failures counted so far are over. */
  calm() {
    this.failures = 0; this.failingSince = 0; this.progressAt = Date.now();
    if (this.state === 'reconnecting' || this.state === 'lost') this.setState('connected');
  }

  /** The pause before a retry; it ends at once when the phone is back online or the file is closed. */
  backOff(ms) {
    return new Promise(resolve => {
      const go = () => { clearTimeout(timer); this.retries.delete(go); resolve(); };
      const timer = setTimeout(go, ms);
      this.retries.add(go);
    });
  }

  request(headers, signal, method = 'GET') {
    return this.fetchFn(this.url, {method, headers: {...this.headers, ...headers}, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
  }

  /** Changes how far downloads read ahead (the data saver), for the downloads running now too. */
  setReadAhead(bytes) {
    this.readAhead = bytes;
    for (const s of this.streams) s.wake?.(); // one paused short of a longer reach reads on; one past a shorter one pauses at its next piece
  }

  /** Reading the header is over: streams read ahead fully again. */
  doneProbing() {
    this.probing = false;
    for (const s of this.streams) s.wake?.();
  }

  // Playback has jumped elsewhere. The reads still waiting belong to pipelines being dropped, and their streams
  // would go on filling their read-ahead, taking bandwidth from the new place: both end here (reads as 'closed').
  jumped() {
    for (const s of [...this.streams]) s.abort();
    const moved = new SourceError('closed', 'Playback moved elsewhere.');
    for (const list of this.waiters.values()) for (const w of list) w.reject(moved);
    this.waiters.clear();
  }

  /** Calls fn(blockIndex) whenever a block lands in the cache. */
  onBlock(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * Opens the file with an open-ended range request, which also becomes the
   * first sequential stream. Resolves {size, contentType, url}; rejects a
   * SourceError of kind 'unreadable' (CORS or network), 'timeout', 'gone', 'status',
   * 'range' or 'size' (the last three carry the answer's `contentType`: a
   * playlist needs no ranges). When `signal` aborts, now or at any time
   * later, the file is closed: every download ends and nothing is retried.
   */
  async open(signal) {
    if (signal?.aborted) { this.close(); throw signal.reason ?? new SourceError('closed', 'The file was closed.'); }
    signal?.addEventListener('abort', () => this.close(), {once: true});
    let response;
    try {
      response = await ask(this, {Range: 'bytes=0-'}, signal, TIMING.open, 'timeout');
    } catch (error) {
      if (signal?.aborted || error instanceof SourceError) throw error;
      throw new SourceError('unreadable', 'This host does not let a web page read the file, or the connection failed.', String(error?.message || error));
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const refuse = (kind, message, detail) => { response.body?.cancel().catch(() => {}); return Object.assign(new SourceError(kind, message, detail), {contentType}); };
    if (response.status === 200) throw refuse('range', 'This host sends the whole file at once instead of in parts.');
    if (response.status === 404 || response.status === 410) throw refuse('gone', `The link has expired or the file was removed (HTTP ${response.status}).`, response.status);
    if (response.status !== 206) throw refuse('status', `The host answered ${response.status}.`, response.status);
    if (response.url) this.url = response.url; // where a redirect led; a later failure goes back to the address given
    this.contentType = contentType;
    // Content-Range is often not exposed to pages; for "bytes=0-" the
    // CORS-safelisted Content-Length is the whole file anyway.
    const range = parseContentRange(response.headers.get('content-range'));
    const length = Number(response.headers.get('content-length'));
    let size = range?.size ?? (range == null && length > 0 ? length : null);
    if (!size) {
      try {
        const head = await ask(this, {}, signal, TIMING.stall, 'stall', 'HEAD');
        const n = Number(head.headers.get('content-length'));
        if (head.ok && n > 0) size = n;
      } catch {}
    }
    if (!size || signal?.aborted || this.closed) throw refuse('size', 'The host does not say how large the file is.');
    this.size = size;
    this.startStream(0, response);
    return {size, contentType, url: this.url};
  }

  blockCount() { return Math.ceil(this.size / BLOCK); }
  blockLength(index) { return Math.min(BLOCK, this.size - index * BLOCK); }

  /** Indexes of the blocks in the cache right now. */
  cachedBlocks() { return [...this.blocks.keys()]; }

  /** The end of the cached run of bytes that starts at `start` (start itself if none). */
  cachedUntil(start) {
    let i = Math.floor(start / BLOCK);
    while (i * BLOCK < this.size && this.blocks.has(i)) i++;
    return Math.max(start, Math.min(this.size, i * BLOCK));
  }

  /** True when [start, end) is fully cached. */
  has(start, end) {
    for (let i = Math.floor(start / BLOCK); i * BLOCK < Math.min(end, this.size); i++) if (!this.blocks.has(i)) return false;
    return true;
  }

  /** Returns bytes [start, end), end exclusive, downloading what is not cached; the download reads on ahead of it. */
  async read(start, end) {
    if (this.closed) throw new SourceError('closed', 'The file was closed.');
    end = Math.min(end, this.size);
    const first = Math.floor(start / BLOCK), last = Math.floor((end - 1) / BLOCK);
    return cut(await Promise.all(Array.from({length: last - first + 1}, (_, k) => this.block(first + k))), first, start, end);
  }

  /**
   * Bytes [start, end) when every one of them is cached, else null. Unlike read() it asks for nothing: it starts
   * no download, does not let a paused one read further, and leaves the cache's order alone. For consumers that
   * only look at what playback already fetched. Inside one block the answer is a view of the cache, not a copy.
   */
  peek(start, end) {
    end = Math.min(end, this.size);
    if (!(end > start)) return new Uint8Array(0);
    const first = Math.floor(start / BLOCK), last = Math.floor((end - 1) / BLOCK), found = [];
    for (let i = first; i <= last; i++) { const b = this.blocks.get(i); if (!b) return null; found.push(b); }
    return cut(found, first, start, end);
  }

  block(index) {
    this.advance(index);
    const hit = this.blocks.get(index);
    if (hit) { this.blocks.delete(index); this.blocks.set(index, hit); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(index) || [];
      list.push({resolve, reject});
      this.waiters.set(index, list);
      if (list.length === 1) this.schedule(index);
    });
  }

  /** Lets a paused stream that is serving `index` read further ahead. */
  advance(index) {
    const at = index * BLOCK;
    for (const s of this.streams) {
      if (at <= s.position + REUSE_WINDOW && s.position - at <= this.readAhead + BLOCK && index > s.want) { s.want = index; s.wake?.(); }
    }
  }

  servedBy(stream, index) { const at = index * BLOCK; return at >= stream.position && at - stream.position < REUSE_WINDOW; }
  /** True when a read is waiting for a block this download will bring. */
  servingWaiter(stream) { for (const i of this.waiters.keys()) if (this.servedBy(stream, i)) return true; return false; }

  /** Starts a download for an awaited block unless one is on its way there. */
  schedule(index) {
    for (const s of this.streams) if (this.servedBy(s, index)) return;
    if (this.streams.size >= MAX_STREAMS) {
      // Every connection is taken: one nobody waits on gives way, else one that has brought something since it
      // began. A third place asked for while two are still awaited takes its turn when a block lands (store()),
      // so the downloads never end each other without any of them getting anywhere.
      const all = [...this.streams], victim = all.find(s => !this.servingWaiter(s)) || all.find(s => s.delivered);
      if (!victim) return;
      victim.abort();
    }
    this.startStream(index * BLOCK);
  }

  startStream(position, response = null, want = Math.floor(position / BLOCK)) {
    // Playing from elsewhere (resuming halfway, a seek): a stream nobody reads from, far from here,
    // is closed rather than paused, since a paused connection still fills its window (megabytes)
    // with data that is not needed, taking the phone's bandwidth from the stream that is.
    if (!this.probing) for (const s of [...this.streams]) {
      if (Math.abs(s.position - position) > this.readAhead + REUSE_WINDOW && !this.servingWaiter(s)) s.abort();
    }
    const stream = {position, want, delivered: 0, received: 0, controller: new AbortController(), wake: null};
    stream.abort = () => { stream.controller.abort(); this.streams.delete(stream); stream.wake?.(); };
    this.streams.add(stream);
    runStream(this, stream, response).then(() => this.reschedule(), error => streamFailed(this, stream, error));
    return stream;
  }

  /** Starts downloads for the awaited blocks that none serves, the earliest first. */
  reschedule() {
    if (this.closed) return;
    for (const i of [...this.waiters.keys()].sort((a, b) => a - b)) if (this.waiters.has(i)) this.schedule(i);
  }

  store(index, bytes) {
    this.blocks.delete(index);
    this.blocks.set(index, bytes);
    while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
    this.partials.delete(index);
    if (this.failures || this.failingSince || this.state === 'lost') this.calm(); // the host is sending again
    const list = this.waiters.get(index);
    if (list) { this.waiters.delete(index); for (const w of list) w.resolve(bytes); }
    for (const fn of this.listeners) fn(index);
    if (this.waiters.size) this.reschedule();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (typeof removeEventListener === 'function') removeEventListener('online', this.onOnline);
    for (const go of [...this.retries]) go();
    for (const s of [...this.streams]) s.abort();
    for (const list of this.waiters.values()) for (const w of list) w.reject(new SourceError('closed', 'The file was closed.'));
    this.waiters.clear();
    this.blocks.clear();
    this.partials.clear();
  }
}

/** Bytes [start, end) out of the blocks that hold them, the first of which is block `first`. */
function cut(blocks, first, start, end) {
  if (blocks.length === 1) return blocks[0].subarray(start - first * BLOCK, end - first * BLOCK);
  const out = new Uint8Array(end - start), last = first + blocks.length - 1;
  let offset = 0;
  blocks.forEach((b, k) => {
    const i = first + k, from = i === first ? start - i * BLOCK : 0, to = i === last ? end - i * BLOCK : b.length;
    out.set(b.subarray(from, to), offset); offset += to - from;
  });
  return out;
}
