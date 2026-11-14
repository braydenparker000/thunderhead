// @ts-check
// How long things took on this phone, kept as numbers: a photo opening (and where the time went), its full-size
// pixels ready, the first full-size view, an export. The last 120 stay in localStorage under `th.editor.timings`. This page sends
// nothing anywhere (SECURITY.md §4.1): the home page passes them on to the owner's own storage when the owner
// leaves that on (apps/settings/workshop-timings.js), so a slow step on the real phone can be found without the
// owner running a test. Never a photo, its name or its settings: only times, sizes and what kind of file.
const KEY = 'th.editor.timings', MOST = 120;

/** Keeps one timing. @param {'open' | 'full' | 'detail' | 'fine' | 'save' | 'move' | 'turn'} kind @param {number} ms @param {Record<string, number | string | boolean>} [more] */
export function note(kind, ms, more = {}) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    all.push({ at: Date.now(), kind, ms: Math.round(ms), ...more });
    localStorage.setItem(KEY, JSON.stringify(all.slice(-MOST)));
  } catch {}
}
/** The timings kept on this phone, oldest first (the Export board's estimate reads its exports: eta.js). @returns {Record<string, any>[]} */
export function kept() { try { const all = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(all) ? all : []; } catch { return []; } }
