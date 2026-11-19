// When the stream list does its work (FEEL.md; the feel report counts the main thread's gaps): its header's
// movement is alone on screen. Placeholders are drawn with the screen; an add-on's answer is read (each stream's
// facts, a slice of a few milliseconds a frame) and drawn only once the settle's first CALM_MS are over, and the
// cards are then made a slice a frame (stream-card.js drawInSlices). What can wait longer (the player loaded
// ahead, getting ready for a tap, the sources a tap reads) waits for the movement's end and an idle moment.
// Back (unsettle) does none of it: the screen is destroyed and every loop here stops at its next slice.

import {factsOf} from '../addons/stream-facts.js';
import {releaseFacts} from '../addons/release-facts.js';
import {nextFrame, whenIdle} from '../ui/motion-core.js';

/** Nothing of an answer is drawn in a movement's first CALM_MS; a slice of reading is at most READ_MS. */
export const CALM_MS = 150, READ_MS = 4;

const done = new WeakSet();
/** Reads `streams`' facts ahead, READ_MS a frame. Resolves true when all are read, false if `alive()` turned false. */
export async function readAhead(streams, alive = () => true) {
  let i = 0;
  while (i < streams.length) {
    const end = performance.now() + READ_MS;
    for (; i < streams.length && performance.now() < end; i++) {
      const s = streams[i];
      if (!s || typeof s !== 'object' || done.has(s)) continue;
      factsOf(s); releaseFacts(s); done.add(s); // both kept with the stream: drawing the card reads them again
    }
    if (i < streams.length) { await nextFrame(); if (!alive()) return false; }
  }
  return alive();
}

const wait = ms => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

export class Pace {
  /** `screen`: a StreamsScreen (its `groups`, `render()` and `destroyed`). */
  constructor(screen) {
    this.screen = screen;
    this.calmAt = 0; // nothing of an answer is drawn before this
    this.stillAt = 0; // the movement is over
    this.wanted = false;
    this.running = null;
    this.idles = new Map();
  }

  /** The screen's movement starts now and lasts `ms`. */
  moving(ms) { const now = performance.now(); this.calmAt = now + CALM_MS; this.stillAt = now + ms; }

  /** The list is drawn again once it may be: after CALM_MS of the movement, with every stream read first. */
  draw() { this.wanted = true; this.running ??= this.run(); }

  async run() {
    const alive = () => !this.screen.destroyed;
    await wait(0); // the movement, started just after the screen is made, sets calmAt
    await wait(this.calmAt - performance.now());
    while (this.wanted && alive()) {
      this.wanted = false;
      const streams = [...this.screen.groups.values()].flatMap(g => g.streams || []);
      if (!(await readAhead(streams, alive))) break;
      await nextFrame(); // the draw has a frame of its own
      if (alive()) this.screen.render();
    }
    this.running = null;
  }

  /** Runs `fn` once the movement is over and the main thread is free (once per `key` while one is waiting). */
  idle(fn, key = fn) {
    if (this.idles.has(key)) return;
    this.idles.set(key, true);
    // A task later (the shell starts the movement just after making the screen), until it is over, then idle.
    const still = async () => { await wait(0); while (performance.now() < this.stillAt) await wait(this.stillAt - performance.now()); };
    still().then(() => whenIdle(() => { this.idles.delete(key); if (!this.screen.destroyed) fn(); }));
  }
}
