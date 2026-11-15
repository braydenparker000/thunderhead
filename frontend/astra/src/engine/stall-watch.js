// A small watchdog for a re-wrapped film (remux.js). Media Source plays only
// where every track has data, so sound with a hole in it, or sound that ends
// before the picture, stops playback for good while the picture pipeline
// waits, 40 seconds ahead, for the playhead to move. Once a second: when the
// element is stuck and one kind has no more data coming for the place it is
// stuck at, a small hole is stepped over; sound that has run out while the
// picture goes on is reported ('audioended', the player plays on without it),
// and when both have run out the stream is ended so the film can finish.

import {bufferedAt} from './mse.js';

const MAX_HOLE = 3; // seconds stepped over without asking anyone
const PATIENCE = 2; // checks in a row the element must be stuck first

/** The start of the first buffered range after `time` (Infinity when none). */
export function nextStart(buffer, time) {
  let ranges;
  try { ranges = buffer.buffered; } catch { return Infinity; }
  for (let i = 0; i < ranges.length; i++) if (ranges.start(i) > time) return ranges.start(i);
  return Infinity;
}

/**
 * What to do about a stuck element, from plain facts (pure, tested):
 * kinds: {video|audio: {buffered: bool at t, next: start of the next range, ended: pipeline done, readPast: read beyond t,
 * has(time): buffered at that time}}.
 * Returns null, {seek: time}, {end: true} or {audioEnded: true}.
 */
export function remedy(kinds, t) {
  const all = Object.entries(kinds), missing = all.filter(([, k]) => !k.buffered);
  if (!missing.length || !missing.every(([, k]) => k.ended || k.readPast)) return null; // data is still on its way
  const next = Math.max(...missing.map(([, k]) => k.next));
  if (next - t <= MAX_HOLE && all.every(([, k]) => k.has(next + 0.05))) return {seek: next + 0.05};
  const gone = missing.filter(([, k]) => k.ended && k.next === Infinity).map(([name]) => name);
  if (!gone.length) return null;
  if (all.every(([, k]) => k.ended)) return {end: true};
  if (gone.includes('audio') && kinds.video?.buffered) return {audioEnded: true};
  return null;
}

export class StallWatch {
  constructor(session) {
    this.session = session;
    this.stuck = 0;
    this.timer = setInterval(() => this.check(), 1000);
  }

  check() {
    const s = this.session, v = s.video, queues = Object.entries(s.queues);
    if (s.destroyed || !queues.length || v.paused || v.seeking || v.readyState >= 3 || s.ms?.readyState !== 'open'
      || queues.some(([, q]) => q.pending() || q.buffer.updating)) { this.stuck = 0; return; }
    if (++this.stuck < PATIENCE) return;
    this.stuck = 0;
    const t = v.currentTime, d = s.ms.duration;
    const kinds = Object.fromEntries(queues.map(([k, q]) => [k, {buffered: bufferedAt(q.buffer, t, 0.3, d), next: nextStart(q.buffer, t), ended: !!s.ended[k], readPast: s.readAt[k] > t + 1, has: time => bufferedAt(q.buffer, time, 0.3, d)}]));
    const r = remedy(kinds, t);
    if (!r) return;
    s.emit('stall', {at: +t.toFixed(2), ...r});
    if (r.seek) v.currentTime = r.seek;
    else if (r.end) { try { s.ms.endOfStream(); } catch {} }
    else if (r.audioEnded) s.emit('audioended', {at: t});
  }

  stop() { clearInterval(this.timer); }
}
