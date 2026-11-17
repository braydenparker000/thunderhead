// @ts-check
// How long things took on this phone, kept as numbers: a photo opening (and where the time went), its full-size
// pixels ready, the first full-size view, an export, a reset. Each goes to the flight recorder (th/report/journal.js),
// which the background worker sends to the owner's own storage when the owner leaves that on (Settings › Privacy and
// data › Editor reports); this page sends nothing anywhere itself (SECURITY.md §4.1). The heavy jobs the badge names
// (engine/work.js) are recorded as they begin and end, so the one unended when the chip or the page died is known; and
// what the graphics chip is. The last 120 timings also stay in localStorage under `th.editor.timings`, for this page's
// own reads (the Export board's estimate: eta.js). Never a photo, its name or its settings: only times, sizes and fixed words.
import { begin, log, start, allow } from '/th/report/journal.js';
import { prefOn } from '/th/pref.js';
import { allMaking, onMaking } from '../../engine/work.js';
import { jobOf } from '../../engine/gentle.js';

const KEY = 'th.editor.timings', MOST = 120;
start(); void allow(prefOn('privacy.editor_timings', true));

/** Keeps one timing. @param {string} kind @param {number} ms @param {Record<string, number | string | boolean>} [more] */
export function note(kind, ms, more = {}) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    all.push({ at: Date.now(), kind, ms: Math.round(ms), ...more });
    localStorage.setItem(KEY, JSON.stringify(all.slice(-MOST)));
  } catch {}
  void log(kind, { ms, ...more });
}
/** The timings kept on this phone, oldest first (the Export board's estimate reads its exports: eta.js). @returns {Record<string, any>[]} */
export function kept() { try { const all = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(all) ? all : []; } catch { return []; } }
export { begin };

// the jobs the badge names, each recorded as it begins and ends
const going = /** @type {Map<string, ReturnType<typeof begin>>} */ (new Map());
onMaking(() => {
  const now = new Set(allMaking().map(jobOf).filter((j) => j !== 'none'));
  for (const j of now) if (!going.has(j)) going.set(j, begin(j));
  for (const [j, end] of going) if (!now.has(j)) { end(); going.delete(j); }
});
// and what the graphics chip is, once the engine has it (engine/gpu.js)
addEventListener('th-gpu', (e) => { const d = /** @type {CustomEvent} */ (e).detail || {}; void log('gpu', { vendor: String(d.vendor || '').toLowerCase(), arch: String(d.arch || '').toLowerCase() }); });
