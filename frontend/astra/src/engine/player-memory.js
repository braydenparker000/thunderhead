// The memory a film holds, in the engine's log (the playback report's): one `memory` entry at each film's first
// picture and one every 60 s of play while the page is visible, so a report from the phone shows what it held. Numbers
// and fixed words only: the JS heap in MB where the browser gives it (Chrome's performance.memory, which counts the
// heap's arrays too), the seconds of film buffered ahead of the playhead and behind it and about how many MB that is at
// the film's average bitrate, the reader's cache in MB and the budget in force (budget.js). Mixed into AstraPlayer's
// prototype through player-data.js, so `this` is the player. It costs one look at the buffer a minute.

const EVERY = 60; // seconds of play between two entries
const MiB = 1 << 20;

export const memoryMethods = {
  /** Starts watching the element (once a player): the first picture of each film, then each minute played in view. */
  watchMemory() {
    if (this.memoryWatch || !this.video) return;
    const v = this.video;
    let last = 0, played = 0;
    const picture = () => { // once a film: a fresh pipeline at the same place (a resume) shows a first frame again
      if (this.memoryLoad === this.load_ && this.load_ !== undefined) return;
      this.memoryLoad = this.load_;
      played = 0; last = performance.now();
      this.recordMemory('picture');
    };
    const tick = () => {
      const now = performance.now(), step = Math.min(1000, now - last); // a gap (a stop, the page asleep) counts a second at most
      last = now;
      if (v.paused || v.seeking || globalThis.document?.visibilityState === 'hidden') return;
      played += step;
      if (played >= EVERY * 1000) { played -= EVERY * 1000; this.recordMemory('play'); }
    };
    v.addEventListener('loadeddata', picture);
    v.addEventListener('timeupdate', tick);
    this.memoryWatch = () => { v.removeEventListener('loadeddata', picture); v.removeEventListener('timeupdate', tick); };
  },

  stopMemory() { this.memoryWatch?.(); this.memoryWatch = null; },

  /** One `memory` entry in the log: `at` is 'picture' or 'play'. */
  recordMemory(at) {
    const v = this.video, t = v.currentTime, s = this.probed?.source || this.source, rate = s?.byteRate || 0;
    const ranges = this.session?.queues?.video?.buffer?.buffered ?? v.buffered;
    let ahead = 0, behind = 0;
    try {
      for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= t + 0.1 && ranges.end(i) > t) { ahead = ranges.end(i) - t; behind = t - ranges.start(i); }
    } catch {} // a buffer taken off its media source
    const mb = x => Math.round(x / MiB), heap = globalThis.performance?.memory?.usedJSHeapSize;
    let cache = 0;
    if (s?.blocks) for (const b of s.blocks.values()) cache += b.length;
    this.record('memory', {at, heap: heap ? mb(heap) : null, ahead: +ahead.toFixed(1), behind: +behind.toFixed(1),
      aheadMB: rate ? mb(ahead * rate) : null, behindMB: rate ? mb(behind * rate) : null, cacheMB: mb(cache),
      budget: this.budget?.name ?? null, budgetMB: this.budget?.mb ?? null, filmMB: this.budget ? mb(this.budget.film) : null});
  },
};
