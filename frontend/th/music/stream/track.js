// @ts-check
// One song's bytes for the streaming feeder (feed.js): Range requests on its link, read as they
// arrive and demuxed (ogg.js) into Opus packets that wait here until the feeder takes them. Seeking
// bisects the file on granule positions, as Ogg seeking works (RFC 3533 §6, RFC 7845 §4.6): probe a
// byte offset guessed from the granules either side, find the next page, keep the half that holds
// the target, then read pages in order. A link refused as expired (401, 403, 410) is asked for again
// once; network failures, 408, 429 and 5xx are tried again after growing waits; anything else is a
// StreamError, which sends the player back to its plain element path.
// No DOM; tests/music-stream-track.test.mjs runs it against a fake fetch.

import { MAX_PAGE, OggError, OggOpusDemuxer, RATE, findPage, readPage } from './ogg.js';

/** @typedef {import('./ogg.js').OpusHead} OpusHead */
/** @typedef {import('./ogg.js').OpusPacket} OpusPacket */
/** A song in the feeder's queue. `url(fresh)` gives a link that answers Range requests (`fresh`:
 * the last one was refused, sign again); `bytes` and `durationMs` from the catalog help size the
 * requests and guess where a seek lands.
 * @typedef {{ url: (fresh?: boolean) => string | Promise<string>, bytes?: number, durationMs?: number, id?: string }} StreamTrack */

/** 80 ms decoded ahead of a seek point so Opus settles (RFC 7845 §4.6). */
export const PREROLL = 3840;
/** Waits before each new try after a failure that may pass. */
export const RETRY_MS = [500, 1000, 2000, 4000];
/** Bytes read at a guessed offset while seeking (Opus pages are a few KB). */
const PROBE = 16 * 1024;

export class StreamError extends Error {
  /** @param {string} code @param {string} [message] */
  constructor(code, message = code) {
    super(message);
    this.name = 'StreamError';
    this.code = code;
  }
}

/** A failure that may pass if tried again. */
class Transient extends Error {}

/** @param {number} ms @param {AbortSignal} [signal] @returns {Promise<void>} */
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class TrackReader {
  /**
   * @param {StreamTrack} track
   * @param {{ fetch?: typeof fetch, sleep?: typeof wait, onRetry?: (code: string, attempt: number) => void }} [o]
   */
  constructor(track, o = {}) {
    this.track = track;
    this.fetch = o.fetch ?? ((/** @type {RequestInfo} */ u, /** @type {RequestInit} */ i) => fetch(u, i));
    this.sleep = o.sleep ?? wait;
    this.onRetry = o.onRetry ?? (() => {});
    this.demux = new OggOpusDemuxer();
    /** @type {OpusHead | null} */
    this.head = null;
    /** The file's length in bytes (0 until known). */
    this.size = track.bytes ?? 0;
    /** The next byte to read. */
    this.pos = 0;
    /** The granule where the audio starts, and the byte offset of its first page. */
    this.origin = -1;
    this.audioStart = -1;
    /** @type {OpusPacket[]} Read and waiting for the feeder. */
    this.packets = [];
    /** Every packet of the stream has been read. */
    this.done = false;
    /** Where the audio ends (a granule position), once its last packet is read. */
    this.endGranule = -1;
    this.lastEnd = -1;
    this.audioBytes = 0;
    this.audioSamples = 0;
  }

  /** Samples waiting for the feeder. */
  get queued() {
    return this.packets.reduce((n, p) => n + p.samples - p.discard, 0);
  }

  /** Bytes per second of audio: the catalog's figures, else what has been read, else a guess (192 kb/s). */
  bytesPerSecond() {
    const { bytes, durationMs } = this.track;
    if (bytes && durationMs) return (bytes * 1000) / durationMs;
    if (this.audioSamples > RATE) return (this.audioBytes * RATE) / this.audioSamples;
    return 24_000;
  }

  /** Waiting packets, oldest first, up to `max` samples (whole packets only). @param {number} max */
  take(max) {
    let n = 0;
    let i = 0;
    while (i < this.packets.length && n + this.packets[i].samples <= max) n += this.packets[i++].samples;
    return this.packets.splice(0, i);
  }

  /**
   * Reads up to `n` more bytes, handing each piece to the demuxer as it arrives; `onData` runs after
   * each piece that gave packets. Ends the stream at the file's end.
   * @param {number} n @param {() => void} onData @param {AbortSignal} signal
   */
  async fill(n, onData, signal) {
    for (let attempt = 0; !this.done; ) {
      if (this.size && this.pos >= this.size) return this.finish();
      const from = this.pos;
      const to = (this.size ? Math.min(this.size, from + n) : from + n) - 1;
      try {
        const res = await this.request(from, to, signal);
        if (!res) return this.finish();
        if (!res.body) throw new StreamError('no-body');
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (this.consume(value)) onData();
          if (this.done) {
            reader.cancel().catch(() => {});
            break;
          }
        }
        if (!this.done && (this.size ? this.pos >= this.size : this.pos - from < to - from + 1)) this.finish();
        return;
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof StreamError || e instanceof OggError) throw e;
        // A network failure, before or during the body: try again from the byte reached.
        if (this.pos > from) attempt = 0;
        if (attempt >= RETRY_MS.length) throw new StreamError(e instanceof Transient ? e.message : 'network');
        this.onRetry(e instanceof Transient ? e.message : 'network', attempt + 1);
        await this.sleep(RETRY_MS[attempt++], signal);
      }
    }
  }

  /** @param {Uint8Array} bytes @returns {boolean} whether packets came out */
  consume(bytes) {
    const last = this.size > 0 && this.pos + bytes.length >= this.size;
    const r = this.demux.push(last ? bytes.subarray(0, this.size - this.pos) : bytes, { last });
    this.pos += bytes.length;
    if (r.head) this.head = r.head;
    if (this.audioStart < 0 && this.demux.audioStart >= 0) this.audioStart = this.demux.audioStart;
    if (this.origin < 0 && this.demux.origin >= 0) this.origin = this.demux.origin;
    for (const p of r.packets) {
      this.packets.push(p);
      this.lastEnd = p.start + p.samples - p.discard;
      if (p.eos) this.endGranule = this.lastEnd;
      this.audioSamples += p.samples;
      this.audioBytes += p.data.length + 1;
    }
    if (this.demux.eos) this.finish();
    return r.packets.length > 0;
  }

  finish() {
    if (this.done) return;
    this.demux.end();
    this.done = true;
    if (this.endGranule < 0) this.endGranule = this.lastEnd;
  }

  /**
   * One Range request: the Response (206; or 200 for a request from byte 0 to a server without
   * ranges), or null past the end (416).
   * @param {number} from @param {number} to @param {AbortSignal} signal @returns {Promise<Response | null>}
   */
  async request(from, to, signal) {
    for (let fresh = false; ; fresh = true) {
      let url;
      try {
        url = await this.track.url(fresh);
      } catch {
        throw new StreamError('sign');
      }
      let res;
      try {
        res = await this.fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal, credentials: 'omit', mode: 'cors' });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new Transient('network');
      }
      if (res.status === 206) {
        const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(res.headers.get('content-range') ?? '');
        if (m && Number(m[1]) !== from) throw new StreamError('bad-range');
        if (m && m[3] !== '*') this.size = Number(m[3]);
        return res;
      }
      if (res.status === 200) {
        if (from > 0) throw new StreamError('no-range');
        const len = Number(res.headers.get('content-length'));
        if (len > 0) this.size = len;
        return res;
      }
      res.body?.cancel().catch(() => {});
      if (res.status === 416) return null;
      if ((res.status === 401 || res.status === 403 || res.status === 410) && !fresh) continue;
      if (res.status === 408 || res.status === 429 || res.status >= 500) throw new Transient(`http-${res.status}`);
      throw new StreamError(`http-${res.status}`);
    }
  }

  /** The bytes `from`…`to` whole, tried again like `fill`. @param {number} from @param {number} to @param {AbortSignal} signal */
  async bytes(from, to, signal) {
    for (let attempt = 0; ; ) {
      try {
        const res = await this.request(from, to, signal);
        if (!res) return new Uint8Array(0);
        if (res.status === 200) throw new StreamError('no-range');
        return new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        if (signal.aborted || e instanceof StreamError) throw e;
        if (attempt >= RETRY_MS.length) throw new StreamError(e instanceof Transient ? e.message : 'network');
        this.onRetry(e instanceof Transient ? e.message : 'network', attempt + 1);
        await this.sleep(RETRY_MS[attempt++], signal);
      }
    }
  }

  /**
   * Moves the reader to the last page that ends at or before `granule` less the pre-roll, so the next
   * `fill` reads from there; waiting packets are dropped. The file's start must have been read.
   * @param {number} granule @param {AbortSignal} signal
   */
  async seek(granule, signal) {
    if (!this.head || this.audioStart < 0) throw new StreamError('seek-early');
    const want = granule - PREROLL;
    const at = want > this.origin ? await this.bisect(want, signal) : this.audioStart;
    this.demux = new OggOpusDemuxer({ head: this.head, serial: this.demux.serial, resync: true });
    this.pos = at;
    this.packets = [];
    this.done = false;
    this.endGranule = -1;
    this.lastEnd = -1;
  }

  /** The byte offset of the last page whose granule is at most `want`. @param {number} want @param {AbortSignal} signal */
  async bisect(want, signal) {
    if (!this.size) await this.bytes(0, 0, signal);
    if (!this.size) throw new StreamError('no-size');
    let best = this.audioStart;
    let lo = this.audioStart;
    let loG = this.origin;
    let hi = this.size;
    const pre = this.head?.preSkip ?? 0;
    let hiG = this.track.durationMs ? this.origin + pre + this.track.durationMs * 48 : loG + ((hi - lo) * RATE) / this.bytesPerSecond();
    for (let i = 0; i < 40 && hi - lo > 2 * PROBE; i++) {
      // Interpolate on granules (Opus is close to a constant rate); every third probe halves instead.
      const frac = i % 3 === 2 || hiG <= loG ? 0.5 : Math.min(0.9, Math.max(0.1, (want - loG) / (hiG - loG)));
      const guess = Math.max(lo, Math.min(hi - PROBE, Math.floor(lo + frac * (hi - lo))));
      let found = granuleAfter(await this.bytes(guess, Math.min(this.size, guess + PROBE) - 1, signal));
      if (!found && guess + PROBE < hi) found = granuleAfter(await this.bytes(guess, Math.min(this.size, guess + MAX_PAGE + PROBE) - 1, signal));
      if (!found || guess + found.at >= hi) {
        hi = guess;
        continue;
      }
      if (found.page.granule <= want) {
        best = guess + found.at;
        lo = best + found.page.size;
        loG = found.page.granule;
      } else {
        hi = guess + found.at;
        hiG = found.page.granule;
      }
    }
    // Then page by page from `lo` (a page boundary) up to `hi`.
    let cursor = lo;
    let span = 2 * PROBE;
    while (cursor < hi) {
      const chunk = await this.bytes(cursor, Math.min(this.size, cursor + Math.max(span, hi - cursor + 4096)) - 1, signal);
      let at = 0;
      let page = null;
      while ((page = readPage(chunk, at))) {
        if (page.granule > want) return best;
        if (page.granule >= 0) best = cursor + at;
        at += page.size;
        if (cursor + at >= hi) return best;
      }
      if (!at) {
        // A page longer than the read: once more with room for the largest page.
        if (cursor + chunk.length >= this.size || span >= MAX_PAGE) return best;
        span = MAX_PAGE;
        continue;
      }
      cursor += at;
    }
    return best;
  }
}

/** The first whole page that ends a packet (granule ≥ 0). @param {Uint8Array} b */
function granuleAfter(b) {
  for (let found = findPage(b, 0); found; found = findPage(b, found.at + found.page.size)) {
    if (found.page.granule >= 0) return found;
  }
  return null;
}
