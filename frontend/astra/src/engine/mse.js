// A serial append queue for one SourceBuffer: appends never overlap, a
// generation number drops bytes from a pipeline that has been replaced, and a
// full buffer is answered by evicting played media and retrying.

import {behindSeconds} from './hold.js';

const BEHIND = 20; // seconds of played media kept for short rewinds (fewer of a fast film: hold.js)

export class AppendQueue {
  /** `source`: the film's range reader, whose bitrate (once known) holds what is kept behind the playhead to bytes. */
  constructor(buffer, video, onFatal, source = null) {
    this.buffer = buffer;
    this.source = source;
    this.video = video;
    this.onFatal = onFatal;
    this.items = [];
    this.bytes = 0;
    this.busy = false;
    this.idleWaiters = [];
    this.generation = 0;
    this.held = false; // fragments wait here instead of going to the buffer (rebuffer.js), until it is let go and pumped
    this.reach = -Infinity; // where the latest fragment queued begins (the file's time), when its writer says
  }

  /** Queues bytes for the current generation (`at`: where their fragment begins); older generations are dropped. */
  append(bytes, generation, at = null) {
    if (generation !== this.generation) return;
    if (at != null && at > this.reach) this.reach = at;
    this.items.push({bytes, generation});
    this.bytes += bytes.byteLength;
    this.pump();
  }

  pending() { return this.bytes; }

  idle() { return this.busy || this.items.length ? new Promise(r => this.idleWaiters.push(r)) : Promise.resolve(); }

  /** Nothing appending and nothing queued: whoever waited for that hears it. */
  settle() { if (!this.busy && !this.items.length) for (const r of this.idleWaiters.splice(0)) r(); }

  async pump() {
    if (this.busy || this.held) return;
    this.busy = true;
    try {
      while (this.items.length && !this.held) {
        const item = this.items[0];
        if (item.generation !== this.generation) { this.items.shift(); this.bytes -= item.bytes.byteLength; continue; }
        try {
          await this.run(() => this.buffer.appendBuffer(item.bytes));
          this.items.shift(); this.bytes -= item.bytes.byteLength;
          if (this.onFirst && this.buffer.buffered.length) { this.onFirst(); this.onFirst = null; } // the first fragment is in (player-report.js mark)
        } catch (error) {
          if (error?.name === 'QuotaExceededError') {
            const freed = await this.evict(this.behind() / 2);
            if (!freed) await new Promise(r => setTimeout(r, 1000)); // wait for playback to use some up
            continue;
          }
          if (item.generation !== this.generation || error?.name === 'AbortError') { this.items.shift(); this.bytes -= item.bytes.byteLength; continue; }
          this.items.length = 0; this.bytes = 0;
          this.onFatal?.(error);
          break;
        }
        await this.evict(this.behind());
      }
    } finally {
      this.busy = false;
      this.settle();
    }
  }

  /** Seconds of played media kept for short rewinds. */
  behind() { return behindSeconds(BEHIND, this.source); }

  /** Runs one SourceBuffer operation and waits for it to finish. */
  run(operation) {
    return new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(Object.assign(new Error('The browser could not decode this media data.'), {name: 'MediaDataError'})); };
      const aborted = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => { this.buffer.removeEventListener('updateend', done); this.buffer.removeEventListener('error', fail); this.buffer.removeEventListener('abort', aborted); };
      this.buffer.addEventListener('updateend', done);
      this.buffer.addEventListener('error', fail);
      this.buffer.addEventListener('abort', aborted);
      try { operation(); } catch (error) { cleanup(); reject(error); }
    });
  }

  /** Removes media more than `keep` seconds behind the playhead. */
  async evict(keep) {
    const before = this.video.currentTime - keep;
    const ranges = rangesOf(this.buffer);
    if (!ranges.length || ranges.start(0) >= before - 1) return false;
    try { await this.run(() => this.buffer.remove(0, before)); return true; } catch { return false; }
  }

  /** Drops everything queued and buffered, and starts a new generation. */
  async reset({clear = true, mime = null} = {}) {
    this.generation++;
    this.items.length = 0; this.bytes = 0; this.held = false; this.reach = -Infinity;
    if (this.busy) await this.idle(); else this.settle();
    // Always: a fragment's moof and mdat are appended one after the other, and a reset between the two left the buffer
    // inside a segment, where setting its timestampOffset throws (more often with quarter-second sound fragments).
    try { this.buffer.abort(); } catch {}
    if (clear && this.buffer.buffered.length) { try { await this.run(() => this.buffer.remove(0, Infinity)); } catch {} }
    if (mime && this.buffer.changeType) this.buffer.changeType(mime);
    return this.generation;
  }

  /** Removes every buffered range that starts after `time` (media left from an earlier place, ahead of a new one). */
  async dropAfter(time) {
    const ranges = rangesOf(this.buffer);
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= time) continue;
      try { await this.run(() => this.buffer.remove(ranges.start(i), Infinity)); } catch {}
      return;
    }
  }

  /** Starts a new generation without clearing buffered media (used on seek). */
  async restart() {
    this.generation++;
    this.items.length = 0; this.bytes = 0; this.held = false; this.reach = -Infinity;
    if (this.busy) await this.idle(); else this.settle();
    try { this.buffer.abort(); } catch {} // a fresh init segment follows
    return this.generation;
  }
}

/** A SourceBuffer's ranges; none once it has been taken off its media source (reading them then throws). */
function rangesOf(buffer) {
  try { return buffer.buffered; } catch { return {length: 0}; }
}

/** True when `time` (and `ahead` seconds after it, or the end) is buffered. */
export function bufferedAt(buffer, time, ahead = 0.5, duration = Infinity) {
  const r = rangesOf(buffer);
  for (let i = 0; i < r.length; i++) {
    if (r.start(i) <= time + 0.1 && (r.end(i) >= Math.min(time + ahead, duration - 0.2))) return true;
  }
  return false;
}

/** Seconds buffered ahead of `time` in one contiguous range. */
export function bufferedAhead(buffer, time) {
  const r = rangesOf(buffer);
  for (let i = 0; i < r.length; i++) if (r.start(i) <= time + 0.1 && r.end(i) > time) return r.end(i) - time;
  return 0;
}

/** The end of the buffered range that holds `time` (`time` itself when none does). */
export function bufferedEnd(buffer, time) {
  const r = rangesOf(buffer);
  for (let i = 0; i < r.length; i++) if (r.start(i) <= time + 0.1 && r.end(i) > time) return r.end(i);
  return time;
}
