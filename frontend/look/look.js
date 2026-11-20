// @ts-check
// Ink and Lamp's own behaviour, loaded by ui/theme.js after the first paint while the look is on.
// For now: the day on <html data-day> ("sunday", "friday" or none), by the phone's own date as home's
// date line reads it, kept right across midnight and on coming back to the page (the look's CSS
// turns the rubric gold on Sundays); every file of the look kept on the phone once its sheet has
// loaded (keep.js); then <html data-look-ready>, which says this script has run.
// `LOOK` is this folder's published path (/look/<hash>/), for a page that names one of its files,
// e.g. `${LOOK}emblems.svg#em-harp` in an SVG <use>.

import { keep } from './keep.js';

export const LOOK = new URL('./', import.meta.url).pathname;

const DAYS = /** @type {const} */ ({ 0: 'sunday', 5: 'friday' });
const root = document.documentElement;
let next = 0;

/** Puts today's day on <html> and waits for the next midnight. */
export function today(now = new Date()) {
  const day = DAYS[/** @type {0 | 5} */ (now.getDay())];
  if (day) root.dataset.day = day;
  else delete root.dataset.day;
  clearTimeout(next);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  next = window.setTimeout(() => today(), midnight.getTime() - now.getTime() + 50);
}

today();
document.addEventListener('visibilitychange', () => { if (!document.hidden) today(); });
const sheet = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[data-look]'));
if (sheet?.sheet) keep(LOOK);
else sheet?.addEventListener('load', () => keep(LOOK), { once: true });
root.dataset.lookReady = '';
