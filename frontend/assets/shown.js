// When a page is first shown to the owner (error-report.js sends its `<app>.open` sense then): at
// once for a top-level page (or another site's frame, which sends nothing anyway); for a frame in
// home's layer (th/island/frames.js), the first time home brings it to the front. Home preloads
// Music and Podcasts there in hidden frames, and marks the one it brings to the front by taking
// `inert` off its frame (th/island/island.js `expand`, put back on `collapse`): that is the signal.
/** @param {Window} win @param {() => void} go */
export function whenShown(win, go) {
  let frame = null;
  try { frame = win.top === win.self ? null : win.frameElement; } catch {}
  if (!frame || !frame.hasAttribute('inert')) { go(); return; }
  const watch = new win.MutationObserver(() => {
    if (frame.hasAttribute('inert')) return;
    watch.disconnect();
    go();
  });
  watch.observe(frame, {attributes: true, attributeFilter: ['inert']});
}
