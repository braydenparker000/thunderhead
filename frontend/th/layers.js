// @ts-check
// Back closes the thing on top (GESTURES.md §7): one stack of the layers home shows over itself (the
// Briefing, the menu, the + sheet, sheets and confirms, Settings pages, Remind me, the voice memo strip,
// Find in today, a photo full screen). Each layer opened by a tap, a swipe's end or a key pushes one
// history entry of ours (`history.state.thl`: this page's run, the layer's number, the depth); a layer
// held open by a finger pushes its entry when the finger lifts; one opened by nothing the owner did
// (the mind, a deep link) pushes none, since Chrome steps over entries pushed without a gesture.
// Closed by its own tap or swipe, a layer takes its entry with it (history.back(), once). Back pops
// our entry and closes every layer above where it lands. Entries that are not ours (the island's, a
// past conversation's, search's: island.js, convos/past.js, convos/search.js) stay theirs; one we push
// over gets the number of our top layer under it (`thn`), so Back landing there closes ours above it.
// An entry of ours with no layer left (a layer another took over) is stepped over at once; a reload on
// a layer goes back to the entry under the first one.

const KEY = 'thl';
const run = Math.random().toString(36).slice(2, 10);
let seq = 0;
/** @typedef {{ n: number, name: string, close: () => void, pushed: boolean, none: boolean }} Layer */
/** @type {Layer[]} bottom first */
const stack = [];
/** @type {Layer[]} opened while a finger is down: pushed as it lifts */
let waiting = [];
/** @type {Layer[]} opened while one of our Backs is on its way: pushed once it lands */
let held = [];
let pending = false;
let down = false;
/** The index of the entry under our first layer (the Navigation API's; -1 without it). */
let base = -1;
const index = () => /** @type {any} */ (globalThis).navigation?.currentEntry?.index ?? -1;

/** @param {any} s @returns {{ s: string, n: number, d: number, b: number } | null} */
const ours = (s) => (s && typeof s === 'object' && s[KEY]) || null;
/** @param {number} n */
const live = (n) => stack.some((l) => l.pushed && l.n === n);
/** @param {{ s: string, n: number } | null} m an entry of ours whose layer is gone */
const stale = (m) => Boolean(m) && !(m?.s === run && live(m.n));
const gesture = () => /** @type {any} */ (navigator).userActivation?.isActive ?? true;

/** @param {Layer} l */
function push(l) {
  if (!stack.includes(l)) return;
  if (pending) return void held.push(l);
  const under = stack.filter((x) => x.pushed).at(-1)?.n ?? 0;
  const s = history.state, m = ours(s), reuse = Boolean(m && stale(m));
  if (!under) base = reuse ? /** @type {any} */ (m).b : index();
  l.pushed = true;
  const entry = { [KEY]: { s: run, n: l.n, d: stack.filter((x) => x.pushed).length, b: base } };
  // A stale entry of ours on top (a layer that just closed, its Back not yet sent) is this one's now.
  if (reuse) return history.replaceState(entry, '');
  if (s && typeof s === 'object' && !m && !('thn' in s)) history.replaceState({ ...s, thn: under }, '');
  history.pushState(entry, '');
}

/** The entry in view is ours with no layer: step back over it. */
function settle() {
  if (pending || !stale(ours(history.state))) return;
  pending = true;
  history.back();
}

/** @param {Layer} l */
function done(l) {
  const i = stack.indexOf(l);
  if (i < 0) return;
  stack.splice(i, 1);
  held = held.filter((x) => x !== l);
  waiting = waiting.filter((x) => x !== l);
  if (l.pushed) setTimeout(settle);
}

/** @param {string} name @param {() => void} close */
function make(name, close) {
  const l = { n: ++seq, name, close, pushed: false, none: false };
  stack.push(l);
  if (gesture()) push(l);
  else if (down) waiting.push(l);
  else l.none = true;
  return l;
}

/** Opens a layer; `close` closes it when Back lands below it (it may call the returned function,
 * which then does nothing). Call the returned function when the layer closes any other way.
 * @param {string} name @param {() => void} close @returns {() => void} */
export function open(name, close) {
  const l = make(name, close);
  return () => done(l);
}

/** @type {Map<string, Layer>} */
const named = new Map();
/** A layer that is open or not by a flag (the + sheet, the Briefing, the menu).
 * @param {string} name @param {boolean} on @param {() => void} close */
export function toggle(name, on, close) {
  const l = named.get(name), shown = Boolean(l && stack.includes(l));
  if (on && !shown) named.set(name, make(name, close));
  if (!on && l) { named.delete(name); done(l); }
}

/** Home's place (home.js go()): the Briefing or the menu is a layer, home is none; the one left closes
 * before the next opens. @param {string} v @param {() => void} back */
export function place(v, back) {
  for (const k of ['brief', 'side']) if (k !== v) toggle(k, false, back);
  if (v === 'brief' || v === 'side') toggle(v, true, back);
}

/** The layers open, bottom first (for the tests). */
export const names = () => stack.map((l) => l.name);

addEventListener('popstate', () => {
  pending = false;
  const s = history.state, m = ours(s);
  const at = m ? (m.s === run ? m.n : 0) : s == null ? 0 : typeof s.thn === 'number' ? s.thn : Infinity;
  for (const l of [...stack].reverse()) {
    if (l.n <= at || !(l.pushed || l.none)) continue;
    stack.splice(stack.indexOf(l), 1);
    l.close();
  }
  for (const l of held.splice(0)) push(l);
  settle();
});
addEventListener('pageshow', () => { pending = false; });
addEventListener('pointerdown', () => { down = true; }, true);
addEventListener('pointerup', () => { down = false; for (const l of waiting.splice(0)) push(l); }, true);
addEventListener('pointercancel', () => { down = false; for (const l of waiting.splice(0)) l.none = true; }, true);
// A reload on a layer: home shows, and the entries the old page pushed are left in one step (they
// belonged to that page, so going to each would load the page again).
const left = ours(history.state);
if (left) {
  const to = left.b >= 0 && index() >= 0 ? left.b - index() : -left.d;
  if (to < 0) { pending = true; history.go(to); }
}
