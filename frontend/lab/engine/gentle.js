// @ts-check
// After the graphics chip resets, the editor keeps trying, gentler each time, never giving up (the owner, 2026-11-17,
// after a Galaxy A15 reset while a photo was being built: "It should be intelligent. It should never ever ever stay
// off ... It should just keep trying"). What was being made when the chip reset (the badge's note: work.js) is
// blamed on this phone: each reset it is blamed for halves the pieces it hands the GPU, and a few times made without
// one let them grow again, so a phone finds the size it can take. And for a while after any reset (`CALM`), what the
// photo can do without (the copy made again, Starfish's preparation, Starfish after it was blamed) waits: Chrome
// shuts a page out of the GPU after two of its crashes within two minutes, and a second crash in that time is what
// left the A15 with no full-size pixels at all. Kept in localStorage, so a reset is remembered for every photo and
// past a reload.

const KEY = 'th.editor.gentle', MOST = 4, BACK = 3, MS = 120_000;
/** Ms after a reset during which work that can wait waits (`?calm=` sets it, the checks' way). */
export const CALM = Number(new URLSearchParams(globalThis.location?.search || '').get('calm')) || MS;
/** The badge's notes (work.js) and the job each names. */
const JOBS = /** @type {Record<string, string>} */ ({ 'Building a sharper copy': 'copy', 'Preparing Starfish': 'prep', 'Loading Starfish': 'starfish', 'Loading full detail': 'detail' });
/** @typedef {{ last: number, jobs: Record<string, { level: number, ok: number }> }} State */

/** @returns {State} */
function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object' && s.jobs) return s; } catch { /* a private window */ }
  return { last: 0, jobs: {} };
}
const write = (/** @type {State} */ s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* a private window */ } };

/** The job a note names ('none' for nothing named). @param {string} note */
export const jobOf = (note) => JOBS[note] || 'none';
/** How many times gentler a job is now: 0 as usual, each step half the pieces. @param {string} job */
export const level = (job) => read().jobs[job]?.level || 0;
/** The share of its usual piece a job hands the GPU now: 1, ½, ¼ … @param {string} job */
export const share = (job) => 2 ** -level(job);
/** The chip reset while `job` was being made: it goes a step gentler, and work that can wait waits a while. Gives its level now. @param {string} job */
export function blame(job) {
  const s = read(); s.last = Date.now();
  if (job !== 'none') { const j = (s.jobs[job] ||= { level: 0, ok: 0 }); j.level = Math.min(MOST, j.level + 1); j.ok = 0; }
  write(s);
  return s.jobs[job]?.level || 0;
}
/** `job` was made whole: after a few such, its pieces grow back a step. @param {string} job */
export function went(job) {
  const s = read(), j = s.jobs[job];
  if (!j || !j.level) return;
  if (++j.ok >= BACK) { j.level--; j.ok = 0; }
  write(s);
}
/** Ms until work that can wait may run (0: now). */
export const calmIn = () => Math.max(0, read().last + CALM - Date.now());
/** Resolves once work that can wait may run. */
export const calm = () => new Promise((r) => setTimeout(r, calmIn()));
