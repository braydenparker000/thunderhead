// The space above the keyboard (MUSIC.md §5.10). At /music the page asks the keyboard not to resize it
// (interactive-widget=resizes-visual) and its own visual viewport shrinks instead. In home's frame home
// now asks the same while Music is in front (th/island/island.js), so the frame keeps its size and only
// home's visual viewport shrinks: a frame's own visual viewport never sees the keyboard. The frame
// fills home's window (position: fixed, inset: 0), so home's visual viewport bottom is this window's.

/** The top-level page's visual viewport (home's when framed by it, else this page's own), or null. */
export function topViewport() {
  try {
    if (window.parent !== window && window.parent.location.origin === location.origin) return window.parent.visualViewport ?? null;
  } catch { /* another origin */ }
  return window.visualViewport ?? null;
}

/** CSS px from this window's top to the top of the keyboard (the window's height with none). */
export function visibleHeight() {
  const vv = topViewport();
  if (!vv || !(vv.height > 0)) return window.innerHeight;
  return Math.min(window.innerHeight, Math.round(vv.offsetTop + vv.height));
}
