// @ts-check
// The page's side of an export's own thread (export-worker.js). The page keeps the GPU's work and the reading back;
// each band read back is given to the thread (moved, not copied), which reduces, sharpens and writes it while the
// GPU develops the next. A 40 MP band is about 30 MB, so no more than two are ever waiting on the thread.
import { sink } from './reduce.js';

const AHEAD = 2;   // bands given to the thread and not yet done with: one at work, one waiting
/** The work after the GPU, wherever it runs (reduce.js `sink`), with `drop` to give it up.
 * @typedef {{ push: (half: Uint16Array, n: number) => Promise<void>, done: () => Promise<Blob[]>, drop: () => void, off: boolean, ms: () => number }} Sink */

/** An export's thread, started and loaded, or null where one cannot start (the work is then done on the page).
 * @returns {Promise<Worker | null>} */
export function thread() {
  return new Promise((res) => {
    let w = /** @type {Worker | null} */ (null);
    const no = (/** @type {unknown} */ why) => { console.warn('export: on the page', why); w?.terminate(); res(null); };
    try { w = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' }); } catch (err) { no(err); return; }
    const t = setTimeout(() => no('the thread did not start'), 10_000), wk = w;
    wk.onerror = (e) => { clearTimeout(t); e.preventDefault(); no(e.message); };
    wk.onmessage = (e) => { if (e.data.ready) { clearTimeout(t); wk.onerror = null; wk.onmessage = null; res(wk); } };
  });
}

/** The work after the GPU for one export: on the thread `w` if there is one, otherwise on the page. `signal` gives
 * it up at once: the thread is stopped and every wait on it ends with the signal's reason.
 * @param {Worker | null} w @param {number} sw @param {number} sh @param {import('./reduce.js').Out[]} outs
 * @param {import('./files.js').Band | null} band the JPEG encoder @param {AbortSignal | undefined} signal @returns {Sink} */
export function work(w, sw, sh, outs, band, signal) {
  if (!w || outs.some((o) => 'rows' in o.file)) {   // a writer made on the page stays on the page
    w?.terminate();
    const s = sink(sw, sh, outs, band);
    let spent = 0;
    return { push: async (half, n) => { const t = performance.now(); await s.push(half, n); spent += performance.now() - t; }, done: s.done, drop: () => {}, off: false, ms: () => spent };
  }
  const wk = w, took = /** @type {Map<number, () => void>} */ (new Map()), pending = /** @type {Map<number, Promise<unknown>>} */ (new Map());
  let sent = 0, spent = 0, failed = /** @type {any} */ (null), files = /** @type {((f: Blob[]) => void) | null} */ (null);
  const fails = /** @type {Set<(e: any) => void>} */ (new Set());
  /** A wait on the thread that ends early, with the error, should it fail or the export be given up. @template T @param {(res: (v: T) => void) => void} hook @returns {Promise<T>} */
  const wait = (hook) => new Promise((res, rej) => { if (failed) { rej(failed); return; } fails.add(rej); hook((v) => { fails.delete(rej); res(v); }); });
  const fail = (/** @type {any} */ err) => { if (failed) return; failed = err; wk.terminate(); for (const f of [...fails]) f(err); fails.clear(); };
  const stop = () => fail(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
  signal?.addEventListener('abort', stop, { once: true });
  wk.onerror = (e) => fail(new Error(`the export's thread stopped: ${e.message}`));
  wk.onmessage = (e) => {
    const d = e.data;
    if (d.jpeg && d.id) {   // a JPEG band to encode on the decoder's thread; its bytes go back to the export's thread
      if (!band) { wk.postMessage({ id: d.id, error: 'no JPEG encoder' }); return; }
      band(.../** @type {[Uint8Array, number, number, number, boolean]} */ (d.jpeg)).then((j) => { if (!failed) wk.postMessage({ id: d.id, jpeg: j }, [j.buffer]); },
        (err) => { if (!failed) wk.postMessage({ id: d.id, error: String(err?.message || err) }); });
    } else if (d.took !== undefined) { spent += d.ms; took.get(d.took)?.(); took.delete(d.took); }
    else if (d.files) files?.(d.files);
    else if (d.error) fail(new Error(d.error));
  };
  wk.postMessage({ start: [sw, sh, outs] });
  return {
    async push(half, n) {
      if (failed) throw failed;
      const k = sent++, done = wait((res) => took.set(k, () => res(undefined)));
      done.catch(() => {});   // a failure is heard by the push that waits on it, or by `done`
      pending.set(k, done);
      wk.postMessage({ band: half, n, k }, [half.buffer]);
      // no more than AHEAD bands given and not done with: the next is read back once the one before this is done
      const old = pending.get(k + 1 - AHEAD);
      pending.delete(k + 1 - AHEAD);
      if (old) await old;
    },
    done: async () => { const f = wait((res) => { files = res; }); wk.postMessage({ finish: true }); const got = await f; signal?.removeEventListener('abort', stop); wk.terminate(); return got; },
    drop: () => { signal?.removeEventListener('abort', stop); fail(new DOMException('Export cancelled', 'AbortError')); },
    off: true, ms: () => spent,
  };
}
