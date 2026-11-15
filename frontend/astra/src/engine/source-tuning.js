// How far Astra's range reader (http-source.js) reads ahead and how much it keeps, by the film's bitrate.
// Mixed into HttpSource's prototype, so `this` is the source. Before the bitrate is known a download runs
// at most `readAhead` past the furthest byte read (2 MiB while the file is being described); once the probe
// has the size and the duration, about `seconds` of the film (10, or 5 with the data saver), never under
// 2 MiB nor over `readAhead`. The cache keeps `keepSeconds` of the film (a back-seek of 30 s plus what the
// pipelines read ahead) and the reach, between 16 MiB and the size it was made with (96 MiB).

import {BLOCK, PROBE_AHEAD} from './source-stream.js';

const MIN_REACH = 2 * BLOCK, MIN_KEEP = 16 * BLOCK;

export const tuning = {
  /**
   * Changes how far downloads read ahead (the data saver), for the downloads running now too: at most `bytes`,
   * and once the film's bitrate is known `seconds` of it; the cache keeps `keep` seconds of the film besides.
   */
  setReadAhead(bytes, {seconds = this.seconds, keep = this.keepSeconds} = {}) {
    Object.assign(this, {readAhead: bytes, seconds, keepSeconds: keep});
    this.resize();
    for (const s of this.streams) s.wake?.(); // one paused short of a longer reach reads on; one past a shorter one pauses at its next piece
  },

  /** The film lasts `duration` seconds: the reach and the cache follow its average bitrate. */
  learn(duration) {
    if (!(duration > 0) || !this.size) return;
    this.byteRate = this.size / duration;
    this.resize();
    for (const s of this.streams) s.wake?.();
  },

  /** How far a download may run past the furthest byte read from it. */
  reach() {
    if (this.probing) return PROBE_AHEAD;
    if (!this.byteRate) return this.readAhead;
    return Math.floor(Math.min(this.readAhead, Math.max(MIN_REACH, this.byteRate * this.seconds)));
  },

  /** The cache holds what a back-seek and the read-ahead need at the film's bitrate, 16 to 96 MiB. */
  resize() {
    if (!this.byteRate) return;
    const want = Math.ceil((this.byteRate * this.keepSeconds + this.reach()) / BLOCK);
    this.maxBlocks = Math.min(this.maxBase, Math.max(MIN_KEEP / BLOCK, want));
    while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
  }
};
