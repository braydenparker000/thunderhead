// Touch rules for the player surface, kept pure so they are unit-tested.
// Zones: left 40%, centre 20%, right 40%.

export const DOUBLE_TAP_MS = 280; // a second tap within this is a double tap
export const STREAK_MS = 800; // taps within this of a seek keep adding to it
export const HOLD_MS = 400; // press this long to play faster
export const SEEK_STEP = 10; // the double tap's step until the owner picks another (Settings › Player)
export const SEEK_STEPS = [5, 10, 15, 30];
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
 * Fingers on the picture, as a small state machine: down, move, up and
 * cancel go in; what the player should do comes out. The first finger
 * decides. A second finger that lands before the first has moved past the
 * slop or held starts a pinch (zoom), which rules out the hold; once a hold,
 * a drag or a pinch is under way any other finger is ignored, so the first
 * one's lift still ends what it started. A pinch ends with either finger's
 * lift; the finger left on the glass then does nothing until it lifts.
 * Moving past the slop rules out a hold and a tap, even when the drag never
 * becomes a seek or a level (a diagonal, or gestures turned off). While the
 * picture is zoomed, a one-finger drag pans it instead of seeking.
 * The hold's timer is the caller's: down() says how long, hold() fires it.
 *   down(): {holdIn, pinch?} | null      move(): [actions]      up()/cancel(): action | null
 * Actions: {type: 'hold'} | {type: 'drag', kind} (once) | {type: 'seek', dx} |
 * {type: 'level', kind, dy} | {type: 'pan', dx, dy} | {type: 'pinch', ratio, focus, mid} |
 * {type: 'end', kind, cancelled} | {type: 'tap', x, w}
 */
export class Gesture {
  constructor({slop = 8} = {}) { this.slop = slop; this.p = null; }

  get active() { return !!this.p; }
  get kind() { return this.p?.kind || null; }

  /**
   * `w`, `h` are the surface's size; `gestures` the viewer's setting; `canHold` whether the video plays;
   * `zoom` whether a pinch may start (not while locked); `zoomed` whether the picture is enlarged (drags pan).
   */
  down({id, x, y, w, h, gestures = true, canHold = false, zoom = false, zoomed = false, allow = null}) {
    const p = this.p;
    if (p) {
      if (!p.zoom || p.kind || p.moved || p.second) return null; // a finger too late to pinch: ignored
      p.kind = 'pinch'; p.holdable = false;
      p.second = {id, x, y};
      p.start = Math.max(1, Math.hypot(x - p.cx, y - p.cy));
      p.focus = {x: (x + p.cx) / 2, y: (y + p.cy) / 2};
      return {holdIn: 0, pinch: true};
    }
    this.p = {id, x, y, cx: x, cy: y, w, h, gestures, zoom, zoomed, allow, kind: null, moved: false, holdable: gestures && canHold};
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
    if (!p) return out;
    if (p.kind === 'pinch') {
      if (id === p.id) { p.cx = x; p.cy = y; } else if (id === p.second.id) { p.second.x = x; p.second.y = y; } else return out;
      out.push({type: 'pinch', ratio: Math.hypot(p.second.x - p.cx, p.second.y - p.cy) / p.start, focus: p.focus, mid: {x: (p.second.x + p.cx) / 2, y: (p.second.y + p.cy) / 2}});
      return out;
    }
    if (id !== p.id) return out;
    p.cx = x; p.cy = y;
    const dx = x - p.x, dy = y - p.y;
    if (!p.moved && Math.hypot(dx, dy) > this.slop) { p.moved = true; p.holdable = false; }
    if (!p.kind && p.moved && p.zoomed) { p.kind = 'pan'; out.push({type: 'drag', kind: 'pan'}); }
    if (!p.kind && p.moved && p.gestures) {
      const kind = classifyDrag({dx, dy, startX: p.x, startY: p.y, width: p.w, height: p.h, slop: this.slop});
      // A drag the owner switched off (Settings › Player: swipe to seek, brightness, volume) is no gesture.
      if (kind) { p.kind = kind !== 'none' && p.allow && p.allow[kind] === false ? 'none' : kind; if (p.kind !== 'none') out.push({type: 'drag', kind}); }
    }
    if (p.kind === 'seek') out.push({type: 'seek', dx});
    else if (p.kind === 'pan') out.push({type: 'pan', dx, dy});
    else if (p.kind === 'brightness' || p.kind === 'volume') out.push({type: 'level', kind: p.kind, dy});
    return out;
  }

  up({id}) { return this.finish(id, false); }

  /** The pointer was cancelled or lost, or the player needs the gesture over (a menu, the lock, closing). Pass no id for "whatever is going on". */
  cancel(id) { return this.finish(id, true); }

  finish(id, cancelled) {
    const p = this.p;
    if (!p) return null;
    if (p.kind === 'pinch' && id != null && (id === p.id || id === p.second.id)) {
      // One finger of the two lifted: the pinch is over; the other is spent until it lifts too.
      const left = id === p.id ? p.second : {id: p.id, x: p.cx, y: p.cy};
      this.p = {id: left.id, x: left.x, y: left.y, cx: left.x, cy: left.y, w: p.w, h: p.h, gestures: false, zoom: false, zoomed: false, kind: 'none', moved: true, holdable: false};
      return {type: 'end', kind: 'pinch', cancelled};
    }
    if (id != null && id !== p.id) return null;
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

/** The double tap's running total, as its ripple says it: "+20 s", "−10 s", "+1:30". */
export function stepLabel(seconds) {
  const s = Math.round(seconds), a = Math.abs(s), sign = s < 0 ? '−' : '+';
  return sign + (a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : `${a} s`);
}

/** The double tap's step from the owner's setting (one of SEEK_STEPS; 10 otherwise). */
export const seekStep = prefs => SEEK_STEPS.includes(prefs?.seekStep) ? prefs.seekStep : SEEK_STEP;

/** "+30s" / "-10s" / "+1:30". */
export function deltaLabel(seconds) {
  const s = Math.round(seconds), a = Math.abs(s), sign = s < 0 ? '−' : '+';
  return sign + (a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : `${a}s`);
}
