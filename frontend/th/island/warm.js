import { appFor } from '../registry/apps.js';

// Ring and chip callers create the generic circle before importing the island. Remove it in
// this mutation microtask, before paint; the app's own capsule clip supplies the whole reveal.
if (window.top === window.self && location.pathname === '/') {
  const colors = new Set(['music','podcasts'].map(id => appFor(id)?.color));
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement) || !node.classList.contains('launch') || node.classList.contains('th-app-shell') || !colors.has(node.style.getPropertyValue('--c'))) continue;
      for (const a of node.getAnimations()) a.cancel();
      node.remove();
    }
  }).observe(document.body, {childList:true});
}

// Chat publishes th:changed after its first complete sync. Wait for idle after that, signed in only.
// Kept separate so the capsule and app code do not compete with home's first paint.
let scheduled = false;
document.addEventListener('th:changed', () => {
  if (scheduled || window.top !== window.self || location.pathname !== '/' || document.documentElement.dataset.signedIn === undefined) return;
  scheduled = true;
  let started = false;
  const run = () => {
    if (started) return;
    started = true;
    if (/** @type {any} */ (navigator).connection?.saveData) return;
    void import('./island.js').then(m => m.warm()).catch(() => {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run, {timeout:3000});
  setTimeout(run,3000);
});
