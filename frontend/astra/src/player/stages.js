// The player's work after a movement's first frame (FEEL.md; the feel report counts the main thread's gaps):
// opening and closing start their movement at once, where the compositor runs it, and what they also have to
// do (the film asked for, the controls drawn, the subtitles' style, the app behind put out of reach or back
// in it) waits here until that frame has been presented, then runs in order, one piece a frame: a piece that
// changes what the page looks like (the app put out of reach) is drawn in its own frame, so the next (focus) reads
// it without forcing a style pass. A `first` piece goes ahead of the others still waiting. A piece that throws is
// reported and the others still run.

import {afterFirstFrame, nextFrame} from '../ui/motion-core.js';

const report = error => { if (typeof reportError === 'function') reportError(error); else setTimeout(() => { throw error; }); };

export class Stages {
  constructor() {
    this.queue = [];
    this.running = null;
  }

  get pending() { return this.queue.length > 0; }

  /**
   * Adds `fn` (`first`: ahead of the pieces not marked first; `after`: a promise it waits for, and the pieces
   * behind it with it). Runs after the frame being made now is presented.
   */
  add(fn, {first = false, after = null} = {}) {
    const piece = {fn, first, after};
    if (first) {
      const at = this.queue.findIndex(x => !x.first);
      this.queue.splice(at < 0 ? this.queue.length : at, 0, piece);
    } else this.queue.push(piece);
    this.running ??= this.run();
  }

  async run() {
    await afterFirstFrame();
    while (this.queue.length) {
      if (this.queue[0].after) { await this.queue[0].after; if (!this.queue.length) break; this.queue[0].after = null; continue; }
      const {fn} = this.queue.shift();
      try { fn(); } catch (error) { report(error); }
      if (this.queue.length) await nextFrame();
    }
    this.running = null;
  }

  /** Runs everything waiting now, in order (the player opens again while the last close still had work). */
  flush() { while (this.queue.length) { const {fn} = this.queue.shift(); try { fn(); } catch (error) { report(error); } } }

  /** Drops everything waiting. */
  clear() { this.queue.length = 0; }
}
