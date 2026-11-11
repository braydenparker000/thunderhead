// @ts-check
// Opening an app from the ring without the wait (HOME.md §12, "Ahead of the finger"). The moment the
// finger rests on an app, the browser starts loading that app's page out of sight (a prerender,
// through speculation rules); when the finger lifts and the launch circle has covered the screen,
// the page is already built and is simply shown. Sliding to another app drops the first and starts
// the next, so at most one page is ever held. Nothing is loaded for:
//   - Music and Podcasts while they open inside home (the island warms those itself);
//   - a phone on data saver, or a browser without prerendering (the app then loads as before);
//   - the owner's "Open apps ahead" switch off (Settings → Ring and gestures).
// A page loaded this way knows it (`document.prerendering`); what should only happen once it is
// seen waits for that: nothing is sensed (th/senses/send.js), and the browser itself holds back
// sound, notifications and the like until the page is shown.
import { appFor, landing } from '/th/registry/apps.js';

/** The apps that open inside home (th/island/island.js LAYERED; a test holds the two equal). */
export const IN_HOME = Object.freeze(['music', 'podcasts']);
/** How long the finger rests on an app before its page starts loading: a slide across the ring loads nothing. */
export const DWELL_MS = 70;
/** How long after the ring closes a page nobody opened is kept (the launch itself takes 300 ms). */
export const DROP_MS = 2500;

const can = typeof HTMLScriptElement !== 'undefined' && HTMLScriptElement.supports?.('speculationrules') === true;
const pref = (/** @type {string} */ k) => { try { return localStorage.getItem(`th.s.${k}`); } catch { return null; } };

/** The page to load ahead for an app, or null. @param {string | null} id */
export function ahead(id) {
  const app = id ? appFor(id) : null;
  if (!can || !app?.built || pref('gestures.prewarm') === 'false') return null;
  if (/** @type {any} */ (navigator).connection?.saveData) return null;
  if (IN_HOME.includes(app.id) && document.documentElement.dataset.island !== 'off') return null;
  return landing(app.path);
}

/** @type {HTMLScriptElement | null} */
let tag = null;
let held = '';
let timer = 0;

function hold(/** @type {string} */ path) {
  if (path === held) return;
  tag?.remove();
  tag = null;
  held = path;
  if (!path) return;
  tag = document.createElement('script');
  tag.type = 'speculationrules';
  tag.textContent = JSON.stringify({ prerender: [{ urls: [path], eagerness: 'immediate' }] });
  document.head.append(tag);
}

// home.js says which app the finger is on (`th:ring`, null for none). A page already held stays
// held while the finger is between apps, so lifting on it still finds it ready.
document.addEventListener('th:ring', (e) => {
  clearTimeout(timer);
  clearTimeout(letGo);
  const path = ahead(/** @type {CustomEvent} */ (e).detail);
  if (path) timer = window.setTimeout(() => hold(path), DWELL_MS);
});
// The ring closed. If an app was chosen this page is gone before the timer runs; if none was, the
// page that was loading is dropped, so nothing runs out of sight behind home.
let letGo = 0;
const closed = () => { clearTimeout(timer); clearTimeout(letGo); if (held) letGo = window.setTimeout(() => hold(''), DROP_MS); };
for (const type of ['pointerup', 'pointercancel', 'keyup']) addEventListener(type, closed);
// Back on home (the app was closed, or Back restored this page): nothing is held any more.
addEventListener('pageshow', () => hold(''));
