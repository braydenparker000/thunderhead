// Waiting on a link slower than the film (remux.js). The browser plays on as soon as anything is buffered, so on a
// link slower than the film it stalls every few seconds: measured 2026-11-18 on a 27.8 Mbit/s film, 7 to 9 times a
// minute, about 2 s each at 20 Mbit/s and 5.5 s at 8. Here, after a stall (not a start or a seek, which go as fast as
// they can), the fragments of picture and sound are held back from the browser's buffers until enough of the film has
// been read to play a good while: `need` seconds, from how far the link falls short of the film's bitrate, a few at
// least, growing when stalls come again soon, never more than a wait of about REBUFFER.wait seconds, and within what
// the pipelines read ahead. Holding keeps the element waiting by itself: nothing pauses, so the controls, the clock and
// the lock screen see a film that waits for data, as before. The sound is held too: with only the picture held, Chrome
// played the sound on for up to 3 s over a frozen picture before it waited. The total waiting cannot fall (the bytes
// are what they are); the interruptions do. The link's speed is what the range reader receives while a download runs;
// a film on a link faster than itself is never held and plays exactly as before.

import {bufferedEnd} from './mse.js';

// least: seconds of film ready at least; play: seconds of play aimed at before the next stall, doubled each time a
// stall comes within `again` seconds of the last resume (at most `grow` times); wait: the longest wait it plans.
export const REBUFFER = {on: true, least: 3, play: 20, grow: 2, again: 60, wait: 15};
const TICK = 250, WINDOW = 8000, KNOWN = 2000; // ms: how often it looks; the link's speed over this much busy time, once it has this much

/**
 * Seconds of film to have ready before playing on after a stall (pure, tested): 0 when the link brings the film as
 * fast as it plays. `filmRate` and `linkRate` in bytes a second; `ahead`: seconds the pipelines read past the playhead.
 */
export function readyTarget(filmRate, linkRate, repeats = 0, ahead = 40) {
  if (!(filmRate > 0) || !(linkRate > 0) || linkRate >= filmRate) return 0;
  const short = 1 - linkRate / filmRate; // the part of each second of film the link cannot bring in that second
  const want = Math.max(REBUFFER.least, REBUFFER.play * 2 ** Math.min(repeats, REBUFFER.grow) * short);
  const most = Math.min(REBUFFER.wait * linkRate / filmRate, ahead - 2); // ready in at most `wait` seconds, within reach
  const need = Math.min(want, most);
  return need >= 1 ? +need.toFixed(1) : 0;
}

/** The link's speed while a download runs (bytes a second), from the reader's count of what arrived. */
export class LinkRate {
  constructor() { this.spans = []; this.last = null; }

  sample(source, now = performance.now()) {
    const busy = [...source.streams].some(s => !s.paused), bytes = source.bytesFetched;
    const last = this.last;
    this.last = {now, bytes, busy};
    if (!last || !last.busy || !busy || bytes < last.bytes) return;
    this.spans.push([now - last.now, bytes - last.bytes]);
    let total = this.spans.reduce((n, s) => n + s[0], 0);
    while (total - this.spans[0][0] >= WINDOW) total -= this.spans.shift()[0];
  }

  /** Bytes a second, or 0 while it has not seen enough. */
  rate() {
    let ms = 0, bytes = 0;
    for (const [t, b] of this.spans) { ms += t; bytes += b; }
    return ms >= KNOWN ? bytes / ms * 1000 : 0;
  }
}

export class Rebuffer {
  /** `ahead()`: seconds the session's pipelines read past the playhead now. */
  constructor(session, ahead) {
    this.session = session;
    this.ahead = ahead;
    this.link = new LinkRate();
    this.repeats = 0;
    this.resumedAt = -Infinity;
    this.holding = null; // {since, need}
    this.placed = false; // the film has played since its last start or seek
    const v = session.video;
    // Since the film's last seek (remux-switch.js): ranShort, it ran short while playing, so Chrome keeps more decoded
    // sound; joined, how many times its sound was written over.
    this.on = {
      waiting: () => { if (this.placed && !session.video.seeking) session.ranShort = true; this.stalled(); },
      playing: () => { this.placed = true; },
      seeking: () => { this.placed = false; session.ranShort = false; session.joined = 0; this.release('seek'); },
    };
    for (const [type, fn] of Object.entries(this.on)) v.addEventListener(type, fn);
    this.timer = setInterval(() => this.tick(), TICK);
  }

  /** The element waits for data while the film plays: a stall, held when the link is slower than the film. */
  stalled() {
    const s = this.session, v = s.video, queue = s.queues.video, source = s.source;
    if (!REBUFFER.on || this.holding || !this.placed || !queue || v.paused || v.seeking || s.destroyed || !source) return;
    const now = performance.now();
    this.repeats = now - this.resumedAt < REBUFFER.again * 1000 ? this.repeats + 1 : 0;
    const need = readyTarget(source.byteRate, this.link.rate(), this.repeats, this.ahead());
    if (!need) return;
    this.holding = {since: now, need, left: null, ticks: 0};
    for (const q of Object.values(s.queues)) q.held = true;
    this.estimate();
    this.tell(true);
  }

  /** Seconds the wait has left at the link's speed now (null while the speed is not known). */
  estimate() {
    const h = this.holding, rate = this.link.rate(), film = this.session.source?.byteRate;
    h.left = rate > 0 && film > 0 ? Math.max(0, (h.need - Math.max(0, this.ready())) * film / rate) : null;
  }

  /** Seconds of film ready past the playhead, in both buffers and held: to where the latest fragment of each begins. */
  ready() {
    const s = this.session, t = s.video.currentTime;
    const upTo = (kind, shift) => { const q = s.queues[kind]; return !q || s.ended[kind] ? Infinity : Math.max(bufferedEnd(q.buffer, t), q.reach - shift) - t; };
    return Math.min(upTo('video', s.offset), upTo('audio', s.offset + s.advance));
  }

  tick() {
    const s = this.session;
    if (s.destroyed) return this.stop();
    if (s.source) this.link.sample(s.source);
    const h = this.holding;
    if (!h) return;
    // The need follows the link as it is now (faster: less), never above what was planned at the stall.
    h.need = Math.min(h.need, readyTarget(s.source?.byteRate, this.link.rate(), this.repeats, this.ahead()));
    const waited = (performance.now() - h.since) / 1000;
    if (this.ready() >= h.need || s.ended.video || !s.queues.video?.held || waited > REBUFFER.wait * 2) return this.release('ready');
    this.estimate();
    if (++h.ticks % 4 === 0) this.tell();
  }

  /** The fragments go to the browser again, all that was held first. */
  release(why) {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    if (why === 'ready') this.resumedAt = performance.now();
    for (const q of Object.values(this.session.queues)) { q.held = false; q.pump(); }
    this.session.emit('rebuffer', {holding: false, why, need: h.need, waited: Math.round(performance.now() - h.since)});
  }

  /** What the player shows meanwhile: how long the wait has left, when the link's speed says. */
  tell(first = false) {
    const h = this.holding;
    if (h) this.session.emit('rebuffer', {holding: true, first, need: h.need, left: h.left == null ? null : +h.left.toFixed(1), rate: Math.round(this.link.rate())});
  }

  stop() {
    clearInterval(this.timer);
    const v = this.session.video;
    for (const [type, fn] of Object.entries(this.on)) v.removeEventListener(type, fn);
    if (this.holding) for (const q of Object.values(this.session.queues)) q.held = false;
    this.holding = null;
  }
}
