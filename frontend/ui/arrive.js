// @ts-check
// Arriving at an app's own page from home (HOME.md §12): one movement, no empty frame. Home's
// launch colour is the old picture of a cross-document view transition (arrive.css opts the page
// in; ui/theme.js lets it run when the colour covers home). The colour stays over this page while
// it builds, and the page fades in over it (--d-base, the launch's own length; 150 ms with reduced
// motion) once it has something to show: its first words or pictures painted, or the page loaded
// (at once for a page the browser built ahead, apps/home/prewarm.js), or after 1.2 s whatever
// happens. A classic script in the page's head, so it listens before the page's first frame.
addEventListener('pagereveal', (e) => {
  const fade = /** @type {any} */ (e).viewTransition;
  fade?.ready.then(() => {
    const root = document.documentElement;
    // The browser's own cross-fade gives way: the colour holds, and only the page fades in.
    for (const a of document.getAnimations()) if (/^::view-transition-(old|new)\(root\)$/.test(/** @type {any} */ (a.effect)?.pseudoElement ?? '')) a.cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const show = root.animate([{ opacity: 0, mixBlendMode: 'normal' }, { opacity: 1, mixBlendMode: 'normal' }],
      { duration: reduced ? 150 : 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both', pseudoElement: '::view-transition-new(root)' });
    show.pause();
    let gone = false;
    const go = () => { if (!gone) { gone = true; show.play(); } };
    if (document.readyState === 'complete') return go();
    addEventListener('load', go, { once: true });
    try {
      new PerformanceObserver((l) => { if (l.getEntriesByName('first-contentful-paint').length) go(); }).observe({ type: 'paint', buffered: true });
    } catch {}
    setTimeout(go, 1200);
  }, () => {});
});
