import { appFor } from '../registry/apps.js';

// A ring or chip's circle is removed before paint: the capsule's clip is the reveal.
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

// After the chat's first sync (th:changed), at idle, signed in only: away from home's first paint.
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
