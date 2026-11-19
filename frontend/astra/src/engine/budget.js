// The memory a playing film may take: one budget, in bytes first and seconds second, by how much memory the phone says
// it has (navigator.deviceMemory, Chrome's) and the data saver. Chrome on Android ends a tab that grows too far, mid-film.
//
// What Astra decides of the page's memory (measured 2026-11-19, scripts/astra/memory.mjs, frontend/astra/README.md,
// Memory while a film plays) is three things: the JS heap with its arrays (the reader's cache of the film, the copies
// on their way to the garbage collector, the engine itself), the browser's media buffer (what the SourceBuffers keep
// ahead of the playhead and behind it) and the workers' heaps (converted sound). Chrome's own decoders and frames, and
// the page around the player, are Chrome's. `mb` is the most those three should reach; `film` is the part of it that
// is the film's own bytes held on purpose: the browser's buffer ahead and behind and the reader's cache. The rest, at
// its peak about 130 MB on a 25 to 60 Mbit/s film before this budget, is the engine and the garbage its film bytes
// leave (V8 lets it grow by about half again what is held before it collects), so it falls as `film` falls.

const MiB = 1 << 20;

export const BUDGETS = {
  roomy: {mb: 250, film: 112 * MiB}, // 4 GB or more (the owner's phone), or a browser that does not say
  small: {mb: 180, film: 56 * MiB},  // 2 GB (a 3 GB phone says 2)
  tight: {mb: 140, film: 32 * MiB},  // 1 GB or less
};
export const SAVER = 0.75; // the data saver keeps three quarters of it (it reads less ahead besides: player-data.js)

/** The budget for this phone: {name, mb, film} (film in bytes). */
export function memoryBudget({deviceMemory = globalThis.navigator?.deviceMemory, saver = false} = {}) {
  const name = !(deviceMemory > 0) || deviceMemory >= 4 ? 'roomy' : deviceMemory >= 2 ? 'small' : 'tight';
  const {mb, film} = BUDGETS[name];
  if (!saver) return {name, mb, film};
  const kept = Math.round(film * SAVER);
  return {name: name + ' saver', mb: Math.round(mb - (film - kept) / MiB), film: kept};
}
