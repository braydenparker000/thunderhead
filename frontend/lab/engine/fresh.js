// @ts-check
// The editor's pages after a release. A new release's service worker waits until the shell finds a safe moment
// (th/update.js), and until then the worker in charge serves the editor it kept, the release before's (sw.js
// `lab`). Someone who goes straight to the editor or the engine test page never gives the shell that moment, and
// was left on old code for days: a test measured the old network and an export took the old time. So these pages
// look for a new release themselves when they open with a signal, apply it when the page says it is at rest
// (nothing open that a reload would lose), and reload into it. The shell, if it is open elsewhere, reloads at
// its own next safe moment (th/update.js).
/** @typedef {'current' | 'changing' | 'late' | 'none'} Fresh current: this is the newest release; changing: a newer
 *   one is being applied and the page will reload; late: a newer one is still being fetched (it is applied when it
 *   is ready and the page rests); none: no service worker in charge, or no signal */
const WAIT = 25_000;   // how long `settled` waits for a newer release to be fetched before saying it is late

/** Starts it. `rest`: whether a reload would lose nothing now (asked again every 2 s while a release waits).
 * @param {{ rest?: () => boolean }} [o] @returns {Promise<Fresh>} settled once it is known which release this page will run */
export function fresh(o = {}) {
  const sw = navigator.serviceWorker, rest = o.rest || (() => true);
  if (!sw?.controller || navigator.onLine === false || window.top !== window.self) return Promise.resolve('none');
  // at most one reload every 20 s, so a release that will not take cannot loop the page
  const reload = () => { try { if (Date.now() - Number(sessionStorage.getItem('th-fresh') || 0) < 20_000) return; sessionStorage.setItem('th-fresh', String(Date.now())); } catch { return; } location.reload(); };
  const atRest = (/** @type {() => void} */ f) => { if (rest()) { f(); return; } const t = setInterval(() => { if (rest()) { clearInterval(t); f(); } }, 2000); };
  return new Promise((/** @type {(f: Fresh) => void} */ done) => {
    let asked = false;
    sw.addEventListener('controllerchange', () => { done('changing'); atRest(reload); });
    const apply = (/** @type {ServiceWorker} */ w) => { if (asked) return; asked = true; atRest(() => { done('changing'); w.postMessage({ type: 'skipWaiting' }); }); };
    const follow = (/** @type {ServiceWorker} */ w) => {
      setTimeout(() => done('late'), WAIT);
      w.addEventListener('statechange', () => { if (w.state === 'installed') apply(w); if (w.state === 'redundant') done('current'); });
    };
    (async () => {
      const reg = await sw.getRegistration('/');
      if (!reg) { done('none'); return; }
      if (reg.waiting) apply(reg.waiting);   // one that was waiting already: at once, before the page is in use
      reg.addEventListener('updatefound', () => { if (reg.installing) follow(reg.installing); });
      await reg.update();
      if (reg.waiting) apply(reg.waiting); else if (reg.installing) follow(reg.installing); else done('current');
    })().catch(() => done('none'));
  });
}
