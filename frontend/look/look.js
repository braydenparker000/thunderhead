// @ts-check
// Ink and Lamp's own behaviour, loaded by ui/theme.js after the first paint once the look is on.
// For a page builder:
//   whileOn(start)  runs start() now if the look is on, keeps the stop function it returns, calls that
//                   when the look is turned off (Settings, or the attribute going) and start() again
//                   when it is turned back on. One start's failure never stops another's.
//   on()            whether the look is on now.   LOOK  this folder's published path (/look/<hash>/).
// The page's modules: every shell route (/, /settings/…, /share/) is one document, home's, with the
// conversation, the + sheet, the island, the ring, the Briefing, the menu and Settings over it, so it
// loads home.js island.js ring.js briefing.js menu.js controls.js decide.js; the plain pages (404) load none.
// Here, while the look is on: <html data-day> ("sunday", "friday"), the browser bar in the ground's
// colour, the files kept on the phone (keep.js), then <html data-look-ready>; off, all of it goes, the
// look's sheet with it.

import { keep } from './keep.js';

export const LOOK = new URL('./', import.meta.url).pathname;
const MODULES = ['home.js', 'island.js', 'ring.js', 'briefing.js', 'menu.js', 'controls.js', 'decide.js'];
const root = document.documentElement;

/** Whether the look is on now. */
export const on = () => root.dataset.look === 'ink-lamp';

/** @type {Set<{ start: () => unknown, stop: (() => void) | null }>} */
const parts = new Set();
/** @param {{ start: () => unknown, stop: (() => void) | null }} p */
const begin = (p) => {
  try {
    const stop = p.start();
    p.stop = typeof stop === 'function' ? /** @type {() => void} */ (stop) : null;
  } catch (e) { reportError(e); }
};
/** @param {{ start: () => unknown, stop: (() => void) | null }} p */
const end = (p) => {
  try { p.stop?.(); } catch (e) { reportError(e); }
  p.stop = null;
};

/** Runs `start` while the look is on. @param {() => (() => void) | void} start */
export function whileOn(start) {
  const p = { start, stop: null };
  parts.add(p);
  if (on()) begin(p);
}

let was = on();
const follow = () => {
  if (on() === was) return;
  was = on();
  for (const p of parts) (was ? begin : end)(p);
};
document.addEventListener('th:setting', (e) => { if (/** @type {CustomEvent} */ (e).detail?.key === 'appearance.look') follow(); });
new MutationObserver(follow).observe(root, { attributes: true, attributeFilter: ['data-look'] });

/** Puts today's day on <html> and waits for the next midnight. */
let next = 0;
export function today(now = new Date()) {
  const day = /** @type {Record<number, string>} */ ({ 0: 'sunday', 5: 'friday' })[now.getDay()];
  if (day) root.dataset.day = day;
  else delete root.dataset.day;
  clearTimeout(next);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  next = window.setTimeout(() => today(), midnight.getTime() - now.getTime() + 50);
}
whileOn(() => {
  today();
  const seen = () => { if (!document.hidden) today(); };
  document.addEventListener('visibilitychange', seen);
  return () => { document.removeEventListener('visibilitychange', seen); clearTimeout(next); delete root.dataset.day; };
});

// The browser bar in the ground's colour, Ink's grey by day and Lamp's black by night; the page's own
// colours back when the look goes.
whileOn(() => {
  const metas = /** @type {HTMLMetaElement[]} */ ([...document.querySelectorAll('meta[name="theme-color"]')]);
  const own = metas.map((m) => m.content);
  const paint = () => { for (const m of metas) m.content = root.dataset.theme === 'dark' ? '#000000' : '#D6D6D2'; };
  paint();
  const watch = new MutationObserver(paint);
  watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { watch.disconnect(); metas.forEach((m, i) => { m.content = own[i]; }); };
});

const sheet = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[data-look]'));
if (sheet?.sheet) keep(LOOK);
else sheet?.addEventListener('load', () => keep(LOOK), { once: true });
// Ready while on. Off, the sheet goes too (ui/theme.js adds it again when the look comes back), so
// nothing of the look is left on the page.
whileOn(() => {
  root.dataset.lookReady = '';
  return () => { delete root.dataset.lookReady; document.querySelector('link[data-look]')?.remove(); };
});

// The page's own modules (the shell's document only), each on its own: a failed one leaves the rest.
if (document.getElementById('app')) for (const m of MODULES) import(`./${m}`).catch(reportError);
