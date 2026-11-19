// When the stream list does its work (FEEL.md; the feel report counts the main thread's gaps): its header's
// movement is alone on screen, and no piece of work is over a few milliseconds. Placeholders are drawn with the
// screen; while the add-on is asked, the stream reader's one-time cost is paid a step a frame (release-facts.js
// WARM). An add-on's answer is drawn only once the settle's first CALM_MS are over; with the owner's filters or
// order on, each stream's facts are read first, READ_MS a frame (the order needs them all); with neither, nothing
// is read ahead: each card reads its own as it is made, a slice a frame (stream-card.js drawInSlices), and only the
// first slice before the header has settled. What can wait longer (the player's code, getting ready for a tap,
// the sources a tap reads) waits for the movement's end, and is done a part a frame.
// Back (unsettle) does none of it: the screen is destroyed and every loop here stops at its next slice.

import {factsOf} from '../addons/stream-facts.js';
import {WARM} from '../addons/release-facts.js';
import {questionOf} from '../addons/device-facts.js';
import {nextFrame, whenIdle} from '../ui/motion-core.js';

/** Nothing of an answer is drawn in a movement's first CALM_MS; a slice of reading is at most READ_MS. */
export const CALM_MS = 150, READ_MS = 4;

const done = new WeakSet();
/** Reads `streams`' facts ahead (what the filters and the order use), READ_MS a frame. Resolves true when all are read, false if `alive()` turned false. */
export async function readAhead(streams, alive = () => true) {
  let i = 0;
  while (i < streams.length) {
    const end = performance.now() + READ_MS;
    for (; i < streams.length && performance.now() < end; i++) {
      const s = streams[i];
      if (!s || typeof s !== 'object' || done.has(s)) continue;
      factsOf(s); done.add(s); // kept with the stream: the filters read them again
    }
    if (i < streams.length) { await nextFrame(); if (!alive()) return false; }
  }
  return alive();
}

/** Runs `fn(part)` over `items`, a part of `size` a frame. Resolves true when done, false if `alive()` turned false. */
export async function inParts(items, size, fn, alive = () => true) {
  for (let i = 0; i < items.length; i += size) {
    if (i) { await nextFrame(); if (!alive()) return false; }
    fn(items.slice(i, i + size));
  }
  return alive();
}

let warmed = null;
// And what the filters and a card's note read (stream-facts.js, device-facts.js), with plain text and with emoji.
const MORE = ['x', 'x 🎬'].flatMap(t => [() => factsOf({name: t, title: `${t} 1.2 GB`}), () => questionOf({url: new URL('a.mkv', location.href).href, name: t, title: `${t} x265`})]);
/** The stream reader's one-time cost, a step a frame, once a visit (release-facts.js WARM). */
export const warm = () => (warmed ??= (async () => { for (const step of [...WARM, ...MORE]) { await nextFrame(); try { step(); } catch {} } })());

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
    this.warm = warm(); // while the add-on is asked
  }

  /** Resolves once the movement is over. */
  settled() { return (async () => { await wait(0); while (performance.now() < this.stillAt) await wait(this.stillAt - performance.now()); })(); }

  /** The screen's movement starts now and lasts `ms`. */
  moving(ms) { const now = performance.now(); this.calmAt = now + CALM_MS; this.stillAt = now + ms; }

  /** The list is drawn again once it may be: after CALM_MS of the movement, the reader warm, and the facts an order or a filter needs read. */
  draw() { this.wanted = true; this.running ??= this.run(); }

  async run() {
    const alive = () => !this.screen.destroyed;
    await wait(0); // the movement, started just after the screen is made, sets calmAt
    await wait(this.calmAt - performance.now());
    await this.warm;
    while (this.wanted && alive()) {
      this.wanted = false;
      // Only an order or a filter needs every stream's facts before the first card: else each card reads its own.
      if (this.screen.reads?.()) {
        const streams = [...this.screen.groups.values()].flatMap(g => g.streams || []);
        if (!(await readAhead(streams, alive))) break;
      }
      await nextFrame(); // the draw has a frame of its own
      if (alive()) this.screen.render();
    }
    this.running = null;
  }

  /** Runs `fn` once the movement is over and the main thread is free, or `timeout` ms later (once per `key` while one is waiting). */
  idle(fn, key = fn, {timeout = 2000} = {}) {
    if (this.idles.has(key)) return;
    this.idles.set(key, true);
    // A task later (the shell starts the movement just after making the screen), until it is over, then idle.
    this.settled().then(() => whenIdle(() => { this.idles.delete(key); if (!this.screen.destroyed) fn(); }, {timeout}));
  }
}
