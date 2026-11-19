// What every piece of ui/motion.js stands on: the motion level (Settings › Motion and the phone's own
// wish), haptics (Settings › Touch), the durations and curves of FEEL.md, and one way to start an
// animation that takes over from whatever the element is doing (FEEL.md rule 4: a second tap
// retargets, it never queues). Screens import ui/motion.js, not this file.

import {SPRINGS, linearEasing} from './spring.js';

/** Durations in ms, the same as tokens.css (--t-press … --t-lively). */
export const T = {press: 90, fast: 150, normal: 220, screen: 320, travel: 380, sheet: 300, lively: 420, fade: 120};
/** The standard ease, for fades only (--ease). */
export const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const linearWorks = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)') === true;
/** A spring's easing by name (snappy, smooth, lively); the standard ease where linear() is missing. */
export const spring = name => linearWorks ? (spring.cache[name] ??= linearEasing(SPRINGS[name])) : EASE;
spring.cache = {};

// The level: 'full' | 'reduced' | 'off'.
let choice = 'system';
const listeners = new Set();
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** The level for a setting ('system', 'full', 'reduced', 'off') when the phone does or does not ask for less motion. */
export function levelFor(setting, phoneReduces) {
  if (setting === 'full' || setting === 'reduced' || setting === 'off') return setting;
  return phoneReduces ? 'reduced' : 'full';
}
export const level = () => levelFor(choice, !!query?.matches);

let shown = null;
function announce() {
  const now = level();
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = now;
  if (now === shown) return;
  const before = shown;
  shown = now;
  if (before !== null) for (const fn of listeners) fn(now);
}
/** Calls fn(level) whenever the level changes. Returns a function that stops it. */
export function onLevel(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** The `motion` setting changed (settings/motion.js). */
export function setMotionChoice(value) { choice = ['system', 'full', 'reduced', 'off'].includes(value) ? value : 'system'; announce(); }
query?.addEventListener?.('change', announce);
announce();

// Haptics (FEEL.md "Haptics"): one helper, `tick(kind)`.
let haptics = 'subtle';
const PATTERNS = {select: 8, toggle: 10, lift: 12, snap: 4, edge: 6, success: [8, 40, 8], warn: 20};
const FULL_ONLY = new Set(['snap', 'edge']);
/** The vibration for a kind under a setting ('off', 'subtle', 'full'), or null for none. */
export function hapticPattern(kind, setting) {
  if (setting === 'off' || !(kind in PATTERNS)) return null;
  if (FULL_ONLY.has(kind) && setting !== 'full') return null;
  return PATTERNS[kind];
}
/** The `haptics` setting changed (settings/motion.js). */
export function setHaptics(value) { haptics = ['off', 'subtle', 'full'].includes(value) ? value : 'subtle'; }
export const hapticsSetting = () => haptics;
export const motionChoice = () => choice;
/** A tick under the finger for something the owner just did: select, toggle, lift, snap, edge, success, warn. */
export function tick(kind) {
  const pattern = hapticPattern(kind, haptics);
  if (pattern == null) return false;
  try { return navigator.vibrate?.(pattern) ?? false; } catch { return false; }
}

// Animations. Each element's running animations (from here) are kept, so a new one starts from where
// the element is now and the old ones stop: retargeting, never a queue.
const runningOn = new WeakMap();
const PROPS = ['transform', 'opacity', 'clipPath'];

/** Stops what this module runs on `el`, leaving it where its own styles put it. */
export function stop(el) { for (const a of runningOn.get(el) || []) a.cancel(); runningOn.delete(el); }

/**
 * Animates `el` from where it is now (or from `from`) to `to` (transform, opacity or clipPath only:
 * FEEL.md rule 2). With `keep` the end state stays until stop(el) or the next animation; without it,
 * the element returns to its own styles at the end. Several calls may share one element in a single
 * step (`join`: do not stop the others, as for a transform and an opacity on their own curves).
 */
export function go(el, to, {from = null, duration, easing = EASE, delay = 0, keep = false, join = false} = {}) {
  const now = getComputedStyle(el), start = {};
  for (const p of Object.keys(to)) {
    if (!PROPS.includes(p)) throw Error(`motion moves only ${PROPS.join(', ')}: not ${p}`);
    start[p] = from?.[p] ?? (p === 'clipPath' ? now.clipPath : now[p]);
  }
  if (!join) stop(el);
  const anim = el.animate([start, to], {duration, easing, delay, fill: keep ? 'both' : 'backwards'});
  const list = runningOn.get(el) || [];
  list.push(anim);
  runningOn.set(el, list);
  // A kept end state stays listed (stop() must be able to lift it); others leave the list when done.
  const drop = () => { const l = runningOn.get(el); if (l) { const i = l.indexOf(anim); if (i >= 0) l.splice(i, 1); } };
  anim.finished.then(keep ? null : drop, drop);
  return anim;
}

/**
 * A handle for a motion made of animations: {finished, cancel()}. `finished` always resolves (never
 * rejects) with {cancelled}; cancel() stops every part and runs `settle` so things are left sane.
 */
export function handle(anims, settle = () => {}) {
  let done = false, resolve;
  const finished = new Promise(r => { resolve = r; });
  const end = cancelled => { if (done) return; done = true; if (cancelled) for (const a of anims) a.cancel(); settle(cancelled); resolve({cancelled}); };
  Promise.all(anims.map(a => a.finished)).then(() => end(false), () => end(true));
  return {finished, cancel: () => end(true)};
}

/** A handle for a motion that happens at once (level 'off', or nothing to move). */
export function instant(settle = () => {}) { settle(false); return {finished: Promise.resolve({cancelled: false}), cancel() {}}; }

// Heavy work and movement do not share a frame (the feel report counts the main thread's gaps): a movement
// starts first, on the compositor, and the work comes after its first frame, in pieces, one a frame.
const raf = fn => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
/** Resolves just after the next frame has been drawn (in a task posted from its frame callback). */
export const nextFrame = () => new Promise(resolve => raf(() => setTimeout(resolve, 0)));
/** Resolves once the frame being made now (a movement's first) has been presented: two frames on. */
export const afterFirstFrame = () => new Promise(resolve => raf(() => raf(() => setTimeout(resolve, 0))));
/** Runs `fn` when the main thread is free (an idle moment; at most `timeout` ms later). Returns a cancel. */
export function whenIdle(fn, {timeout = 2000} = {}) {
  if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(() => fn(), {timeout}); return () => cancelIdleCallback(id); }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}
