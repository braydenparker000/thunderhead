// @ts-check
// Decoding a RAF on every core needs the page cross-origin isolated, which our service worker does for the
// engine pages (sw.js: COOP and COEP on /lab/engine/ and /lab/editor/). A newer worker waits for the shell's
// safe moment, which these pages never give, and a phone that only ever opened them has none: at load
// nothing is open yet, so register or apply it and reload once. The site also serves a page as /x and
// /x/index.html, which the worker doesn't isolate, so go to the one address first.

/** Starts it; returns a function saying where it stands (for a Threads line). @param {string} path e.g. '/lab/engine/' */
export function isolate(path) {
  let state = crossOriginIsolated ? 'isolated' : 'not isolated';
  if (location.pathname !== path) { location.replace(`${path}${location.search}`); return () => state; }
  if (crossOriginIsolated || !navigator.serviceWorker) return () => state;
  // at most one reload every 20 s, so a worker that never isolates can't loop the page
  const once = () => { try { if (Date.now() - Number(sessionStorage.getItem('engine-isolate') || 0) < 20_000) return; sessionStorage.setItem('engine-isolate', String(Date.now())); } catch { return; } location.reload(); };
  (async () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => { state = 'service worker changed, reloading'; once(); });
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) { state = 'no service worker yet: installing it'; reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }); }
    else await reg.update().catch((e) => { state = `service worker update failed: ${e?.message || e}`; });
    const skip = (/** @type {ServiceWorker} */ w) => w.postMessage({ type: 'skipWaiting' });
    const follow = (/** @type {ServiceWorker} */ w) => w.addEventListener('statechange', () => {
      state = `new service worker ${w.state}`;
      if (w.state === 'installed') skip(w);
      if (w.state === 'activated') once();
      if (w.state === 'redundant') state = 'the new service worker failed to install';
    });
    const ctl = navigator.serviceWorker.controller;
    if (reg.waiting) { state = 'applying the waiting service worker'; skip(reg.waiting); }
    else if (reg.installing) { state = 'new service worker installing'; follow(reg.installing); }
    else if (reg.active && ctl) { state = `the service worker in charge (${new URL(ctl.scriptURL).pathname}) does not isolate this page`; once(); }
    else if (reg.active) { state = 'page opened without the service worker: reloading'; once(); }
  })().catch((e) => { state = `service worker: ${e?.message || e}`; });
  return () => state;
}
