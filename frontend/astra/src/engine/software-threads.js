// How many cores the software decoder (libmedia) may use. libmedia runs its
// decoders on several threads by itself wherever SharedArrayBuffer exists,
// which is only on a cross-origin isolated page (Astra's pages served by its
// worker, sw.js); elsewhere it is one thread, as it always was. Its own choice
// is 2 to 8 threads by picture size, up to every core: here it is held to one
// core fewer than the phone has and at most 4 (8 small cores must leave room
// for the page, the sound and the picture), through libmedia's own hook for a
// script every one of its workers runs first (CHEAP_POLYFILL_URL), which tells
// them the phone has that many cores. With THREADS off, an isolated page
// decodes on one thread too (CHEAP_DISABLE_THREAD). Both are read when
// libmedia loads, so this runs before its script is added.

export const THREADS = true;
export const MAX_THREADS = 4;

/** The threads libmedia may use on a phone with `cores` cores: one fewer, at most MAX_THREADS, at least 1. */
export const threadCap = cores => Math.max(1, Math.min(MAX_THREADS, (Number(cores) || 1) - 1));

/**
 * Sets libmedia's switches on `scope` (the page) before its script loads.
 * Returns the threads its decoders may use: 1 without isolation or with THREADS off.
 */
export function prepareThreads(scope = globalThis, threads = THREADS) {
  if (!scope.crossOriginIsolated || typeof scope.SharedArrayBuffer !== 'function') return 1;
  if (!threads) { scope.CHEAP_DISABLE_THREAD = true; return 1; }
  const cap = threadCap(scope.navigator?.hardwareConcurrency);
  if (!scope.CHEAP_POLYFILL_URL) {
    const code = `try { Object.defineProperty(self.navigator, 'hardwareConcurrency', {value: ${cap}, configurable: true}); } catch {}\n`;
    scope.CHEAP_POLYFILL_URL = URL.createObjectURL(new Blob([code], {type: 'text/javascript'})); // kept: workers start all along
  }
  return cap;
}

/** What the lab's device report says: whether the page is isolated and the cores the software decoder uses. */
export function threadsReport(scope = globalThis) {
  const cores = Number(scope.navigator?.hardwareConcurrency) || 0;
  if (!scope.crossOriginIsolated) return `Not isolated: one core (opens isolated from the second visit)`;
  if (!THREADS) return `Isolated; threads switched off: one core`;
  return `Isolated: up to ${threadCap(cores)} of ${cores} cores`;
}
