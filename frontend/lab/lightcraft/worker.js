// A LightCraft render worker (apps/lightcraft-web/worker.js in LightCraft, ours since the threads build,
// engine/lightcraft-web/README.md). The page posts its compiled module and the storage kind; the worker
// then runs LightCraft's worker_main. On a cross-origin isolated page it loads the threads build
// instead (threads/: shared memory, a rayon pool on THREADS Web Workers), so one render, a 1:1 view's
// full-size decode above all, uses several cores; if the phone refuses the shared memory or the pool
// does not start, it uses the page's own one-thread module.
// Two render workers share the cores: half each, at least two, at most four (the A35 has eight).
const THREADS = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
const POOL_START_MS = 10_000;

async function threaded() {
  const glue = await import('./threads/lightcraft_web.js');
  await glue.default({ module_or_path: '/lab/lightcraft/threads/lightcraft_web_bg.wasm' });
  await Promise.race([glue.initThreadPool(THREADS), new Promise((_, no) => setTimeout(() => no(new Error('the render threads did not start')), POOL_START_MS))]);
  return glue;
}

async function plain(module) {
  const glue = await import('./lightcraft_web.js');
  await glue.default({ module_or_path: module });
  return glue;
}

self.onmessage = async (e) => {
  self.onmessage = null;
  try {
    const glue = self.crossOriginIsolated && THREADS > 1
      ? await threaded().catch((err) => { console.warn(`render worker: one thread (${err})`); return plain(e.data.module); })
      : await plain(e.data.module);
    glue.worker_main(e.data.store);
  } catch (err) {
    // surfaces as the Worker's `error` event on the page, which falls back to inline rendering
    setTimeout(() => { throw err; });
  }
};
