// Reads a remote file in byte ranges for the remux engine.
//
// One open-ended range request ("bytes=N-") streams sequentially into 1 MiB blocks (source-blocks.js), the
// way a native player reads; a jump elsewhere starts another stream from the byte needed (source-stream.js
// holds one download and its retries). A read is answered as soon as its bytes have arrived. Reads are
// served from an LRU block cache shared by every consumer: Mediabunny's demuxer and the software decoder
// read(), which keeps a download going; the subtitle scanners peek(), which only looks at what playback
// already fetched, so they cost no network and never pull the download along. How far downloads read
// ahead and how much is kept follow the film's bitrate (source-tuning.js); what describing a film read is
// remembered for the next time it opens (film-memory.js), and its end is asked for beside its start (source-tail.js).
// Every request waits for one of three connection slots (source-gate.js: a TorBox link allows four), and an
// address that dies while the film plays is renewed through the page's `renew` (source-renew.js).
//
// open() also answers the question the planner needs first: can a web page
// read this file at all (CORS) and does the host honour ranges?

import {BLOCK, READ_AHEAD, REUSE_WINDOW, GAP, TIMING, SourceError, parseContentRange, ask, runStream, streamFailed, soon} from './source-stream.js';
import {missing, assemble, arrived, keepPart, need} from './source-blocks.js';
import {sideRead, fillHole} from './side-read.js';
import {filmStore, remember, HEAD} from './film-memory.js';
import {opened, settled} from './source-tail.js';
import {tuning} from './source-tuning.js';
import {gated} from './source-gate.js';
import {stateMethods} from './source-state.js';

export {BLOCK, TIMING, SourceError, parseContentRange};
const MAX_STREAMS = 2;

export class HttpSource {
  /** @param {string} url @param {{headers?: Record<string,string>, maxBytes?: number, fetchFn?: typeof fetch, memory?: object|null, connection?: EventTarget|null, renew?: (() => Promise<string>)|null}} [options] */
  constructor(url, {headers = {}, maxBytes = 96 * BLOCK, fetchFn = (...a) => globalThis.fetch(...a), memory = filmStore(), connection = globalThis.navigator?.connection, renew = null} = {}) {
    this.url = url;
    this.given = url; // the address as it was handed over, before any redirect (both move to a renewed one)
    this.renew = renew; // the page's way to a fresh address for this film (source-renew.js)
    this.headers = headers;
    this.maxBase = Math.max(8, Math.floor(maxBytes / BLOCK));
    this.maxBlocks = this.maxBase;
    this.fetchFn = fetchFn;
    this.size = null;
    this.contentType = '';
    this.blocks = new Map(); // index -> Uint8Array, whole blocks in LRU order
    this.filling = new Set(); // the blocks downloads are writing now (source-blocks.js)
    this.partials = new Map(); // index -> the part of a block a download broke off in, or began inside
    this.waiters = new Set(); // reads waiting for bytes: {start, end, resolve, reject}
    this.streams = new Set();
    this.listeners = new Set();
    this.closed = false;
    this.failures = 0;
    this.failingSince = 0;
    this.progressAt = 0; // when a download last brought a fair part of the file
    this.stateListeners = new Set();
    this.bytesFetched = 0; // body bytes received, kept or not: what the film has cost
    this.readAhead = READ_AHEAD; // the most a download runs past the furthest byte read (setReadAhead)
    this.seconds = 10; this.keepSeconds = 80; // the reach and the cache in seconds of the film, once its bitrate is known
    this.byteRate = 0; // the film's average bytes a second (learn)
    this.probing = false;
    this.probeReads = []; // what describing the file read, to be remembered (film-memory.js)
    this.memory = memory; this.kept = null; this.recall = null;
    // Back online, or on another network: waiting retries go now, and a download gone quiet is asked again.
    this.retries = new Set();
    this.onOnline = () => { for (const go of [...this.retries]) go(); this.restartQuiet(); };
    if (typeof addEventListener === 'function') addEventListener('online', this.onOnline);
    this.connection = connection;
    connection?.addEventListener?.('change', this.onOnline);
  }

  /** One request to the film once a connection slot is free (source-gate.js): `kind` 'play', 'side' or 'preview'. */
  request(headers, signal, method = 'GET', kind = 'play') {
    return gated(this, kind, signal, s => this.fetchFn(this.url, {method, headers: {...this.headers, ...headers}, signal: s, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'}));
  }

  /** Reading the header is over: what it needed is remembered, and a download nobody reads from within its reach ends. */
  doneProbing() {
    this.probing = false;
    this.resize();
    if (this.memory && this.filmKey) remember(this);
    for (const s of [...this.streams]) {
      if (s.at - s.want > this.reach() && !this.servingWaiter(s)) s.abort();
      else s.wake?.();
    }
  }

  // Playback has jumped elsewhere. The reads still waiting belong to pipelines being dropped, and their streams
  // would go on filling their read-ahead, taking bandwidth from the new place: both end here (reads as 'closed').
  jumped() {
    for (const s of [...this.streams]) s.abort();
    const moved = new SourceError('closed', 'Playback moved elsewhere.');
    for (const w of this.waiters) w.reject(moved);
    this.waiters.clear();
  }

  /** One bounded range request of its own, outside the downloads and the cache; seek previews pass `kind` 'preview'. */
  sideRead(start, end, {signal, kind = 'side'} = {}) { return sideRead(this, start, end, signal, {kind}); }

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
    // A film opened before is answered from memory once its first 64 KiB are here; one not, has its tail asked for beside (source-tail.js).
    opened(this);
    return {size, contentType, url: this.url};
  }

  blockCount() { return Math.ceil(this.size / BLOCK); }
  blockLength(index) { return Math.min(BLOCK, this.size - index * BLOCK); }

  /** Indexes of the whole blocks in the cache right now. */
  cachedBlocks() { return [...this.blocks.keys()]; }

  /** The end of the run of bytes here that starts at `start` (start itself if none). */
  cachedUntil(start) { return missing(this, start, this.size); }

  /** True when every byte of [start, end) is here. */
  has(start, end) { return missing(this, start, Math.min(end, this.size)) >= Math.min(end, this.size); }

  /** Returns bytes [start, end), end exclusive, as soon as they have arrived; the download reads on ahead of them. */
  async read(start, end) {
    if (this.closed) throw new SourceError('closed', 'The file was closed.');
    end = Math.min(end, this.size);
    if (!(end > start)) return new Uint8Array(0);
    if (this.probing) this.probeReads.push([start, end]);
    if ((this.recall || this.tail) && end > HEAD) await settled(this, start, end);
    if (this.closed) throw new SourceError('closed', 'The file was closed.');
    this.advance(start, end);
    for (let i = Math.floor(start / BLOCK); i * BLOCK < end; i++) { const hit = this.blocks.get(i); if (hit) { this.blocks.delete(i); this.blocks.set(i, hit); } }
    const at = missing(this, start, end);
    if (at >= end) return assemble(this, start, end);
    return new Promise((resolve, reject) => { this.waiters.add({start, end, resolve, reject}); this.schedule(at); });
  }

  /**
   * Bytes [start, end) when every one of them is here, else null. Unlike read() it asks for nothing: it starts
   * no download, does not let a paused one read further, and leaves the cache's order alone. For consumers that
   * only look at what playback already fetched. Bytes that have arrived never change, so the answer may come
   * from a block still arriving; inside one block it is a view, not a copy.
   */
  peek(start, end) {
    end = Math.min(end, this.size);
    if (!(end > start)) return new Uint8Array(0);
    return missing(this, start, end) >= end ? assemble(this, start, end) : null;
  }

  /** Lets a paused download that serves [start, end) read further ahead, and keeps it going past the header. */
  advance(start, end) {
    const reach = this.reach();
    for (const s of this.streams) {
      if (start > s.at + soon(this, s) || s.at - end > reach + BLOCK) continue;
      s.until = Math.max(s.until, end);
      const freed = !this.probing && s.held;
      if (freed) s.held = false;
      if (end > s.want || freed) { s.want = Math.max(s.want, end); s.wake?.(); }
    }
  }

  /** True when the download will bring byte `at` soon by reading on: within about a second at its speed (source-stream.js soon). */
  servedBy(stream, at) { return at >= stream.at && at - stream.at < soon(this, stream); }
  /** True when a read is waiting for bytes this download will bring. */
  servingWaiter(stream) { for (const w of this.waiters) if (this.servedBy(stream, need(this, w))) return true; return false; }

  /** Starts a download for an awaited byte unless one is on its way there. */
  schedule(at) {
    for (const s of this.streams) if (this.servedBy(s, at)) return;
    if (this.streams.size >= MAX_STREAMS) {
      // Every connection is taken: one nobody waits on gives way, else one that has brought something since it
      // began. A third place asked for while two are still awaited takes its turn when a block lands (store()),
      // so the downloads never end each other without any of them getting anywhere.
      const all = [...this.streams], victim = all.find(s => !this.servingWaiter(s)) || all.find(s => s.delivered);
      if (!victim) return;
      victim.abort();
    }
    // From the byte needed, or from a little before it: the start of its block, or the end of a part already here.
    const i = Math.floor(at / BLOCK), off = at - i * BLOCK, part = this.partials.get(i);
    const from = part && part.filled <= off && off - part.filled < GAP ? i * BLOCK + part.filled : !this.probing && off < GAP && !part ? i * BLOCK : at;
    this.startStream(from);
  }

  startStream(position, response = null, want = position) {
    // Playing from elsewhere (resuming halfway, a seek): a stream nobody reads from, far from here or behind
    // a place a read now needs (the bytes a resume skips), is closed rather than left to read on or pause, since
    // a paused connection still fills its window (megabytes), taking the phone's bandwidth from the stream that is.
    if (!this.probing) for (const s of [...this.streams]) {
      if ((Math.abs(s.at - position) > this.reach() + REUSE_WINDOW || (s.at < position && this.waiters.size)) && !this.servingWaiter(s)) s.abort();
    }
    const stream = {at: position, want, until: response ? HEAD : position, held: this.probing, delivered: 0, received: 0, lastAt: Date.now(), since: Date.now(), ran: 0, controller: new AbortController(), wake: null};
    for (const w of this.waiters) if (this.servedBy(stream, need(this, w))) { stream.want = Math.max(stream.want, w.end); stream.until = Math.max(stream.until, w.end); }
    stream.abort = () => { stream.controller.abort(); this.streams.delete(stream); stream.wake?.(); };
    this.streams.add(stream);
    const ended = () => { if (stream.restart && !this.closed) this.startStream(stream.at, null, stream.want); this.reschedule(); };
    runStream(this, stream, response).then(ended, error => stream.restart ? ended() : streamFailed(this, stream, error));
    return stream;
  }

  /** Starts downloads for the awaited bytes that none serves, the earliest first. */
  reschedule() {
    if (this.closed) return;
    const order = [...this.waiters].map(w => [need(this, w), w]).sort((a, b) => a[0] - b[0]);
    for (const [, w] of order) if (this.waiters.has(w)) this.schedule(need(this, w));
  }

  store(index, bytes) {
    this.blocks.delete(index);
    this.blocks.set(index, bytes);
    while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
    this.partials.delete(index);
    if (this.failures || this.failingSince || this.state === 'lost') this.calm(); // the host is sending again
    arrived(this);
    for (const fn of this.listeners) fn(index);
    if (this.waiters.size) this.reschedule();
  }

  /** Answers the reads whose bytes have all arrived (a download calls it as pieces come). */
  arrived() { arrived(this); }

  /** A download finished a block it began inside: kept, and its first part fetched when a scanner wants whole blocks. */
  holed(rec) {
    keepPart(this, rec);
    if (this.listeners.size) fillHole(this, rec);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (typeof removeEventListener === 'function') removeEventListener('online', this.onOnline);
    this.connection?.removeEventListener?.('change', this.onOnline);
    for (const go of [...this.retries]) go();
    for (const s of [...this.streams]) s.abort();
    this.gate?.close();
    for (const w of this.waiters) w.reject(new SourceError('closed', 'The file was closed.'));
    this.waiters.clear();
    this.blocks.clear();
    this.partials.clear();
    this.filling.clear();
    this.kept = null;
  }
}
Object.assign(HttpSource.prototype, tuning, stateMethods);
