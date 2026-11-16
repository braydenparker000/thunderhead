// @ts-check
// Who has the GPU, and what is being made (the owner, 2026-11-16: one queue, in order of what matters). In front: a
// finger on the photo and the editor's own frames and views (`hold`, released when done). Behind: what can wait, such as
// the copy made again and Starfish read and compiled; between its slices it asks for its `turn`, which comes once
// nothing in front holds the GPU, so a frame never waits behind it for more than the slice it has begun. And what is
// being made that the screen should name (`doing`): the zoom's badge shows the most pressing under its red dot.

let front = 0;
const waiting = /** @type {(() => void)[]} */ ([]);

/** The GPU is wanted in front (a frame, a finger, a view the screen waits on); the returned function lets it go. */
export function hold() {
  front++; let done = false;
  return () => { if (done) return; done = true; front--; if (!front) for (const w of waiting.splice(0)) w(); };
}
/** For work that can wait: resolves once nothing in front holds the GPU. */
export async function turn() { while (front > 0) await new Promise((r) => waiting.push(() => r(undefined))); }

/** What is being made, most pressing first: the order the badge names them in. */
const ORDER = ['Loading full detail', 'Loading Starfish', 'Preparing Starfish', 'Building a sharper copy'];
const running = /** @type {string[]} */ ([]), heard = /** @type {Set<() => void>} */ (new Set());
/** Something the screen should name is being made (one of ORDER); the returned function says it is done. @param {string} what */
export function doing(what) {
  running.push(what); for (const f of heard) f();
  let done = false;
  return () => { if (done) return; done = true; const i = running.indexOf(what); if (i >= 0) running.splice(i, 1); for (const f of heard) f(); };
}
/** The most pressing thing being made now, or '' for nothing. */
export const making = () => ORDER.find((w) => running.includes(w)) || running[0] || '';
/** Calls `f` whenever that changes. @param {() => void} f */
export const onMaking = (f) => { heard.add(f); };
