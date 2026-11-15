// Touch rules for the player surface, kept pure so they are unit-tested.
// Zones: left 40%, centre 20%, right 40%.

export const DOUBLE_TAP_MS = 280; // a second tap within this is a double tap
export const STREAK_MS = 800; // taps within this of a seek keep adding to it
export const HOLD_MS = 400; // press this long to play faster
export const SEEK_STEP = 10;
export const EDGE_GUARD = 72; // vertical swipes ignored this close to the top and bottom edges
export const SENSITIVITY = 0.65; // fraction of the full range per screen height

export function zoneOf(x, width) {
  const f = x / width;
  return f < 0.4 ? 'left' : f > 0.6 ? 'right' : 'center';
}

/** Seconds a full-width swipe covers: 60 s under 30 min, 90 s to an hour, 120 s beyond. */
export function swipeRange(duration) {
  return duration < 1800 ? 60 : duration < 3600 ? 90 : 120;
}

export function swipeTarget(startTime, dx, width, duration) {
  const target = startTime + (dx / width) * swipeRange(duration);
  return Math.max(0, Math.min(duration || target, target));
}

/**
 * Decides what a drag is once it has moved far enough:
 * 'seek' (horizontal), 'brightness' or 'volume' (vertical, by side), or null (not yet).
 */
export function classifyDrag({dx, dy, startX, startY, width, height, slop = 8}) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const verticalThreshold = Math.max(3 * slop, 0.06 * height);
  if (ady >= verticalThreshold && ady > 1.2 * adx) {
    if (startY < EDGE_GUARD || startY > height - EDGE_GUARD) return 'none';
    const zone = zoneOf(startX, width);
    return zone === 'left' ? 'brightness' : zone === 'right' ? 'volume' : 'none';
  }
  if (adx >= 3 * slop && adx > ady) return 'seek';
  return null;
}

/**
 * One finger on the picture, as a small state machine: down, move, up and
 * cancel go in; what the player should do comes out. Only the first finger
 * counts: a second one is ignored, so the first one's lift still ends what it
 * started. Moving past the slop rules out a hold and a tap, even when the
 * drag never becomes a seek or a level (a diagonal, or gestures turned off).
 * The hold's timer is the caller's: down() says how long, hold() fires it.
 *   down(): {holdIn} | null      move(): [actions]      up()/cancel(): action | null
 * Actions: {type: 'hold'} | {type: 'drag', kind} (once) | {type: 'seek', dx} |
 * {type: 'level', kind, dy} | {type: 'end', kind, cancelled} | {type: 'tap', x, w}
 */
export class Gesture {
  constructor({slop = 8} = {}) { this.slop = slop; this.p = null; }

  get active() { return !!this.p; }
  get kind() { return this.p?.kind || null; }

  /** `rect` is the surface's size; `gestures` the viewer's setting; `canHold` whether the video plays. */
  down({id, x, y, w, h, gestures = true, canHold = false}) {
    if (this.p) return null; // a second finger
    this.p = {id, x, y, w, h, gestures, kind: null, moved: false, holdable: gestures && canHold};
    return this.p.holdable ? {holdIn: HOLD_MS} : {holdIn: 0};
  }

  /** The hold timer ran out: a hold, unless the finger has moved or the gesture ended. */
  hold() {
    const p = this.p;
    if (!p || !p.holdable || p.kind || p.moved) return null;
    p.kind = 'hold';
    return {type: 'hold'};
  }

  move({id, x, y}) {
    const p = this.p, out = [];
    if (!p || id !== p.id) return out;
    const dx = x - p.x, dy = y - p.y;
    if (!p.moved && Math.hypot(dx, dy) > this.slop) { p.moved = true; p.holdable = false; }
    if (!p.kind && p.moved && p.gestures) {
      const kind = classifyDrag({dx, dy, startX: p.x, startY: p.y, width: p.w, height: p.h, slop: this.slop});
      if (kind) { p.kind = kind; if (kind !== 'none') out.push({type: 'drag', kind}); }
    }
    if (p.kind === 'seek') out.push({type: 'seek', dx});
    else if (p.kind === 'brightness' || p.kind === 'volume') out.push({type: 'level', kind: p.kind, dy});
    return out;
  }

  up({id}) { return this.finish(id, false); }

  /** The pointer was cancelled or lost, or the player needs the gesture over (a menu, the lock, closing). Pass no id for "whatever is going on". */
  cancel(id) { return this.finish(id, true); }

  finish(id, cancelled) {
    const p = this.p;
    if (!p || (id != null && id !== p.id)) return null;
    this.p = null;
    if (p.kind && p.kind !== 'none') return {type: 'end', kind: p.kind, cancelled};
    if (cancelled || p.moved) return null;
    return {type: 'tap', x: p.x, w: p.w};
  }
}

/** New level after a vertical drag: up raises. Levels are 0..max. */
export function dragLevel(start, dy, height, max = 1) {
  return Math.max(0, Math.min(max, start - (dy / height) * SENSITIVITY * max));
}

/** "+30s" / "-10s" / "+1:30". */
export function deltaLabel(seconds) {
  const s = Math.round(seconds), a = Math.abs(s), sign = s < 0 ? '−' : '+';
  return sign + (a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : `${a}s`);
}
