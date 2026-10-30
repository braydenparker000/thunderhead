// @ts-check
// Opening an app grows from where it was chosen (HOME.md §12): a circle in the app's colour over
// the page's own background widens from that point to the whole screen, then the app loads under
// it. Reduced motion: a quick fade. A page that Back restores drops it, and so does a load that
// never happens (offline), after 8 s.

/** @type {{ x: number, y: number } | null} */
let at = null;

/** Where the next launch grows from (a ring bubble's or a chip's centre). @param {number} x @param {number} y */
export function from(x, y) {
  at = { x, y };
}

/** Covers the screen in `color`; resolves once it has. @param {string} color @returns {Promise<void>} */
export function launch(color) {
  const { x, y } = at ?? { x: innerWidth / 2, y: innerHeight - 60 };
  at = null;
  const o = document.createElement('div');
  o.className = 'launch';
  o.style.setProperty('--c', color);
  document.body.append(o);
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const a = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' })
    : o.animate([{ clipPath: `circle(28px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }], { duration: 300, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
  addEventListener('pageshow', (e) => e.persisted && o.remove(), { once: true });
  setTimeout(() => o.remove(), 8000);
  return a.finished.then(
    () => {},
    () => {},
  );
}
