// @ts-check
// Opening an app grows from where it was chosen (HOME.md §12): a circle in the app's colour over
// the page's own background widens from that point to the whole screen, then the app loads under
// it, and the app's page uncovers from it (ui/arrive.js). Reduced motion: a quick fade. A page
// that Back restores uncovers from it, and a load that never happens (offline) drops it after 8 s.
// The owner's Opening an app (circle, fade or none) and Opening speed (Settings → Appearance)
// shape it; with none the promise resolves at once.

const pref = (/** @type {string} */ k) => { try { return localStorage.getItem(`th.s.${k}`); } catch { return null; } };
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
  const style = pref('appearance.launch') ?? 'circle', ms = Number(pref('appearance.launch_ms')) || 300;
  if (style === 'none') return Promise.resolve();
  const o = document.createElement('div');
  o.className = 'launch';
  o.style.setProperty('--c', color);
  document.body.append(o);
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const a = reduced || style === 'fade'
    ? o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 120 : ms, easing: 'ease-out', fill: 'forwards' })
    : o.animate([{ clipPath: `circle(28px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }], { duration: ms, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
  // Back to home kept whole by the browser (its back/forward cache): the phone shows home's last
  // frame first, this colour, so home uncovers from it, the launch in reverse (HOME.md §12).
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 150 : ms, easing: 'ease-out', fill: 'forwards' }).finished.finally(() => o.remove());
  }, { once: true });
  setTimeout(() => o.remove(), 8000);
  return a.finished.then(
    () => {},
    () => {},
  );
}
