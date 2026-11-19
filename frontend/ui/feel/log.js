// The shell's feel log, as Astra's (astra/src/ui/feel-log.js): every named movement on the main pages is timed
// here, with how many frames it drew, the longest gap between two, and whether it was cut short, in a small ring
// kept in memory only: nothing is stored or sent. Settings › About › "Copy feel report" copies it as plain text
// (ui/feel/report.js): numbers and fixed names only. Each movement also keeps the longest frames it fell in, with
// what ran in them (ui/feel/frames.js), so the report can say what froze.
//
// What is timed, and how:
// - a movement made in JavaScript names itself: timed(name, work) (below), one line where it starts;
// - the stylesheets' own movements (a toast, a card docking or folding, a reply's words, the Briefing's tiles) are
//   named from a fixed table of their keyframes and elements, from the browser's own animation and transition
//   events, so none of those files carries a hook;
// - a theme change (data-theme on <html>) up to the second frame after it, with any colour transitions it starts;
// - home's start (or the return from an app's page, when home loads again or comes back from the back/forward
//   cache) up to the first idle moment after it loaded.
// Parts of a movement that share its name and overlap in time (seven discs, a reply's words) are one movement.

import {keep, watchFrames} from './frames.js';
import {motionReduced} from '../../th/motion.js';

/** @typedef {import('./frames.js').Frame} Frame */
/** @typedef {{name: string, start: number, counted: number, last: number, frames: number, worst: number, parts: number, cut: boolean, froze: Frame[]}} Run */
/** @typedef {{name: string, ms: number, counted?: number, frames: number, worstGap: number, interrupted: boolean, start: number, end: number, froze: Frame[]}} Entry */

const RING = 150; // movements kept, newest last
const LONGEST = 10000; // a movement still going after this is closed as cut (an element removed mid-way)
/** @type {Entry[]} */
const entries = [];
/** @type {Map<string, Run>} */
const active = new Map(); // name -> the movement under way
let looping = false, busyAt = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A movement's name as the report may carry it: lower-case letters, digits and : . _ - only. */
export const cleanName = (/** @type {unknown} */ name) => String(name || 'unnamed').toLowerCase().replace(/[^a-z0-9:._-]+/g, '-').slice(0, 40) || 'unnamed';

function loop() {
  if (looping || typeof requestAnimationFrame !== 'function') return;
  looping = true;
  const frame = (/** @type {number} */ t) => {
    for (const run of [...active.values()]) {
      run.frames++; run.worst = Math.max(run.worst, t - run.last); run.last = Math.max(run.last, t);
      if (t - run.start > LONGEST) { run.parts = 1; end(run, true); }
    }
    if (active.size) requestAnimationFrame(frame); else looping = false;
  };
  requestAnimationFrame(frame);
}

/** Starts a part of the movement `name` (joining it when it is under way). @param {string} name @returns {Run} */
function begin(name, start = now()) {
  const key = cleanName(name);
  let run = active.get(key);
  if (!run) {
    run = {name: key, start, counted: start, last: start, frames: 0, worst: 0, parts: 0, cut: false, froze: []};
    active.set(key, run);
    loop();
  }
  busyAt = now();
  run.parts++;
  return run;
}

/** Ends a part; the movement is kept once its last part has ended (cut if any part was). @param {Run} run */
function end(run, cut = false) {
  if (cut) run.cut = true;
  if (--run.parts > 0 || active.get(run.name) !== run) return;
  active.delete(run.name);
  const t = busyAt = now();
  if (!run.frames && !run.cut && t - run.start < 20) return; // nothing moved (it was already where it was sent)
  entries.push({name: run.name, ms: Math.round(t - run.start), counted: Math.round(t - run.counted), frames: run.frames, worstGap: Math.round(Math.max(run.worst, t - run.last)),
    interrupted: run.cut, start: run.start, end: t, froze: run.froze});
  if (entries.length > RING) entries.splice(0, entries.length - RING);
}

/**
 * Names and times one movement: `timed(name, work, target?)`, returning `work` (or what `work()` returned).
 * `name` is fixed words, `kind:what` (e.g. 'island:expand'). `work` says when it ends:
 * - a Web Animation, or anything with a `finished` promise: when it finishes; cut if it is cancelled (it rejects)
 *   or it resolves to {cancelled: true} (Astra's handles);
 * - a promise: when it settles; cut if it rejects or resolves to {cancelled: true};
 * - an animator from th/motion.js: when it rests; cut if `target` is given and it rested elsewhere (a finger took
 *   it, or it was stopped);
 * - a function: called at once, and what it returns is read as above;
 * - anything else: done at once.
 * Calls with the same name that overlap make one movement. It costs one frame callback while anything is timed.
 * @template W @param {string} name @param {W} work @param {number} [target] @returns {W}
 */
export function timed(name, work, target) {
  const run = begin(name);
  /** @type {any} */
  let result;
  try { result = typeof work === 'function' ? work() : work; } catch (error) { end(run, true); throw error; }
  const done = typeof result?.whenResting === 'function'
    ? result.whenResting().then(() => ({cancelled: target !== undefined && Math.abs(result.value - target) > 1e-3}))
    : typeof result?.finished?.then === 'function' ? result.finished : typeof result?.then === 'function' ? result : null;
  if (done) done.then((/** @type {any} */ v) => end(run, v?.cancelled === true), () => end(run, true));
  else end(run, false);
  return result;
}

// The stylesheets' movements: [keyframes name, the element it runs on, the movement] and [element, movement] for
// transitions. Anything not listed (the field's drift, a press on a row, the thinking light) is not timed.
const KEYFRAMES = [
  ['wordup', '.reply .w', 'reply:reveal'], ['dockin', '#decision .card', 'decision:dock'], ['dockin', '#working .card', 'working:dock'],
  ['dockin', '#home>.past', 'past:open'], ['dockin', '.status', 'status:dock'], ['rise', '.turn', 'turn:rise'], ['rise', '.card.news', 'news:rise'],
  ['rise', '.card', 'card:rise'], ['ripple', '.brief .grid>*', 'briefing:tiles'], ['pulse', '.card', 'card:pulse'], ['cardpulse', '.card', 'card:pulse'],
  ['ractions', '.ractions', 'reply:actions'],
];
const TRANSITIONS = [
  ['#toast', 'toast'], ['#decision .card', 'decision:fold'], ['#working .card', 'working:fold'], ['.card.news', 'news:fold'],
  ['.opts, .opts button', 'options'], ['.remind', 'attach:remind'], ['.viewer', 'attach:viewer'], ['.how .howin', 'reply:how'],
  ['.gbody', 'menu:group'], ['.seg-thumb', 'settings:choice'], ['.switch-track', 'settings:switch'], ['.ask .sendline', 'send'],
];
const parts = new WeakMap(); // element -> Map(what -> its movement)
const is = (/** @type {Element} */ el, /** @type {string} */ sel) => { try { return el.matches(sel); } catch { return false; } };
/** @param {any} e an AnimationEvent or a TransitionEvent @returns {string | null} */
function cssName(e) {
  const el = e.target;
  if (!(el instanceof Element)) return null;
  if (e.type.startsWith('animation')) return KEYFRAMES.find(([k, sel]) => k === e.animationName && is(el, sel))?.[2] ?? null;
  const named = TRANSITIONS.find(([sel]) => is(el, sel))?.[1];
  if (named) return named;
  // A theme change's colours, while it is under way.
  return active.has('theme') && /color|background|fill|stroke|border/.test(e.propertyName) ? 'theme' : null;
}
/** @param {any} e */
function onCss(e) {
  const what = `${e.animationName ?? e.propertyName}${e.pseudoElement || ''}`, el = e.target;
  const mine = parts.get(el);
  if (e.type === 'animationstart' || e.type === 'transitionrun') {
    if (mine?.has(what)) return;
    const name = cssName(e);
    if (!name) return;
    const map = mine ?? new Map();
    parts.set(el, map);
    map.set(what, begin(name));
    return;
  }
  const run = mine?.get(what);
  if (!run) return;
  mine.delete(what);
  end(run, e.type.endsWith('cancel'));
}

/** Calls fn at the first idle moment once the page has loaded. */
/** @param {() => void} fn */
function settled(fn) {
  const idle = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, {timeout: 3000}) : setTimeout(fn, 1));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, {once: true});
}

let watching = 'none';
if (typeof document !== 'undefined') {
  for (const type of ['animationstart', 'animationend', 'animationcancel', 'transitionrun', 'transitionend', 'transitioncancel']) {
    document.addEventListener(type, onCss, {capture: true, passive: true});
  }
  new MutationObserver(list => {
    if (!list.some(m => m.oldValue !== document.documentElement.dataset.theme)) return;
    const run = begin('theme');
    requestAnimationFrame(() => requestAnimationFrame(() => end(run)));
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true});
  // Home's start, from the moment the page was asked for; its frames are counted from here.
  const back = /** @type {any} */ (performance.getEntriesByType?.('navigation')?.[0])?.type === 'back_forward';
  const start = begin(back ? 'app:return' : 'home:start', 0);
  start.last = start.counted = now(); // frames are counted from here (fps over this part only)
  settled(() => end(start));
  addEventListener('pageshow', (/** @type {PageTransitionEvent} */ e) => { if (e.persisted) { const run = begin('app:return'); settled(() => end(run)); } });
  // A long frame is reported after it ends, so it goes to the movements it overlapped: those under way, and the
  // last ones that ended (a frame that froze a movement usually ends it too).
  watching = watchFrames(frame => {
    for (const run of active.values()) if (frame.end > run.start) keep(run, frame);
    for (let i = entries.length - 1; i >= 0 && i >= entries.length - 30; i--) {
      const e = entries[i];
      if (frame.at < e.end && frame.end > e.start) keep(e, frame);
    }
  });
}
/** What the browser reports of long frames here: 'long-animation-frame', 'longtask' or 'none'. */
export const framesWatched = () => watching;

/**
 * The Motion level the report was made under: 'full', 'reduced' or 'off'. A Motion setting feeds it through
 * <html data-motion-level> (the Settings catalogue writes a phone setting's `attr` there); with none, the
 * phone's own reduced motion (and the owner's Reduced motion setting) decide between full and reduced.
 */
export function level() {
  const set = typeof document === 'undefined' ? '' : document.documentElement.dataset.motionLevel;
  if (set === 'full' || set === 'reduced' || set === 'off') return set;
  try { return motionReduced() ? 'reduced' : 'full'; } catch { return 'full'; }
}

// The screen's refresh rate as this page sees it, as Astra measures it: the median time between frames over a
// quiet second (no movement for 2 s, no touch); a second that stops being quiet is dropped and tried again later
// (waits doubling to 30 s).
/** @type {{hz: number, ms: number} | null} */
let refresh = null;
let sampling = false;
const median = (/** @type {number[]} */ list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const quiet = () => !active.size && now() - busyAt > 2000;
const touched = () => { busyAt = now(); };
/** Measures it once a second is quiet (see above). Returns at once. */
export function measureRefresh({wait = 2000} = {}) {
  if (sampling || typeof requestAnimationFrame !== 'function') return;
  sampling = true;
  addEventListener('pointerdown', touched, {capture: true, passive: true});
  const later = () => { sampling = false; measureRefresh({wait: Math.min(wait * 2, 30000)}); };
  setTimeout(() => {
    if (!quiet()) { later(); return; }
    /** @type {number[]} */
    const gaps = [];
    /** @type {number | null} */
    let last = null, first = null;
    const frame = (/** @type {number} */ t) => {
      if (!quiet()) { later(); return; }
      if (last != null) gaps.push(t - last);
      last = t; first ??= t;
      if (t - first < 1000) { requestAnimationFrame(frame); return; }
      sampling = false;
      const ms = median(gaps);
      if (ms > 0) refresh = {ms: Math.round(ms * 10) / 10, hz: Math.round(1000 / ms)};
    };
    requestAnimationFrame(frame);
  }, wait);
}
/** The last measured refresh: {hz, ms} or null. */
export const refreshRate = () => refresh;
if (typeof document !== 'undefined') measureRefresh();

/** The movements kept, oldest first (copies). */
export const feelEntries = () => entries.map(e => ({...e, froze: e.froze.map(f => ({...f, scripts: f.scripts.map(x => ({...x}))}))}));
/** Empties the log (tests). */
export function clearFeelLog() { entries.length = 0; }
