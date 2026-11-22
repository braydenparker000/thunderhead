// @ts-check
// The one index of Settings (owner, 2026-11-21): Settings' search field (search.js) and the menu's
// "Search everything" (th/convos/search.js) both find here. It holds every catalogue setting
// (shared/contract/settings.ts), every listed page, the controls outside the catalogue (Theme, Text
// size, Still background, Check for update, Quiet hours) and the actions people look for (Sign out,
// New recovery code, Export, Copy report, Repair, Bring data from the old site), each with the other words people use for
// it. A query matches when each of its words starts a word of the entry; the entry's own name first.
// An entry opens its page with `focus` (settings.js openPage), which brings that row into view and
// marks it for 2 s.
import { SETTINGS } from './catalog-data.js';
import { PAGES } from './pages.js';

/** @typedef {import('../../../shared/contract/settings.ts').SettingSpec} Spec */
/** @typedef {{ title: string, detail: string, page: string, focus?: string, icon: string, words: string, spec?: Spec }} Entry */

/** Lower case, accents off. @param {string} s */
export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (/** @type {string} */ s) => fold(s).split(/[^a-z0-9°]+/).filter(Boolean);

/** The other words for an entry, by its page, its key or its focus. */
const ALSO = /** @type {Record<string, string>} */ ({
  notifications: 'push alerts notify sound quiet',
  account: 'password log in login',
  devices: 'sign out logout log out sessions phones',
  export: 'backup download',
  memory: 'memory facts forget',
  deleted: 'trash bin restore undelete',
  privacy: 'data senses errors',
  data: 'usage mobile data wifi wi-fi cellular megabytes gigabytes download',
  appearance: 'look style',
  'appearance.look': 'theme style classic ink lamp',
  'appearance.haptics': 'sound vibration vibrate',
  'gestures.ring_ticks': 'sound',
  'mind.pushes': 'notifications push alerts',
  'mind.speech': 'quiet silent',
  'mind.day_start': 'light morning',
  'mind.night_start': 'dark night',
  'privacy.errors': 'crash bugs',
});

/** Settings' own controls and the actions, each on its page. @type {Entry[]} */
const FIXED = [
  { title: 'Theme', detail: 'Auto, day or night.', page: 'settings', focus: 'theme', icon: 'moon-stars', words: 'dark night light day mode appearance' },
  { title: 'Text size', detail: 'Smaller, default or larger.', page: 'settings', focus: 'text', icon: 'pencil-simple', words: 'font letters bigger smaller larger' },
  { title: 'Still background', detail: 'Nothing moves behind home.', page: 'settings', focus: 'still', icon: 'moon-stars', words: 'motion animation moving' },
  { title: 'Check for update', detail: 'The version on this phone.', page: 'settings', focus: 'update', icon: 'info', words: 'version release' },
  { title: 'Quiet hours', detail: 'When I send nothing, and Go quiet now.', page: 'notifications', focus: 'quiet', icon: 'moon-stars', words: 'do not disturb silence mute night go quiet' },
  { title: 'Sign out', detail: 'This phone, the others, or everywhere.', page: 'devices', focus: 'sign-out', icon: 'devices', words: 'logout log out' },
  { title: 'New recovery code', detail: 'For when you forget your password.', page: 'devices', focus: 'recovery', icon: 'key', words: 'password backup code' },
  { title: 'Export', detail: 'Everything of yours as one file.', page: 'privacy', focus: 'export', icon: 'download-simple', words: 'backup download' },
  { title: 'Copy report', detail: 'Numbers and states for whoever helps you.', page: 'about', focus: 'report', icon: 'copy', words: 'diagnostics debug support help problem bug' },
  { title: 'Repair', detail: 'When the app acts broken: fresh code, your data stays.', page: 'about', focus: 'repair', icon: 'arrow-clockwise', words: 'fix broken reset reload stuck cache service worker' },
  { title: 'Bring data from the old site', detail: 'The app data from the old site.', page: 'privacy', focus: 'import', icon: 'download-simple', words: 'import old site migrate' },
];

/** Settings hidden under the look it is wearing (look/settings.css): they do nothing there. */
const HIDDEN = { 'ink-lamp': ['appearance.accent', 'appearance.field', 'appearance.idle_glow'] };

/** Every entry, controls and actions first, then pages, then the catalogue. @returns {Entry[]} */
export function entries() {
  const title = Object.fromEntries(PAGES.map(([page, name, icon]) => [page, { name, icon }]));
  const hidden = /** @type {Record<string, string[]>} */ (HIDDEN)[globalThis.document?.documentElement.dataset.look ?? ''] ?? [];
  /** @type {Entry[]} */
  const out = [...FIXED];
  for (const [page, name, icon] of PAGES) out.push({ title: name, detail: '', page, icon, words: ALSO[page] ?? '' });
  for (const s of /** @type {readonly Spec[]} */ (SETTINGS)) {
    if (hidden.includes(s.key)) continue;
    const at = title[s.group] ?? { name: s.group, icon: 'gear-six' };
    out.push({ title: s.label, detail: `${at.name} · ${s.detail}`, page: s.group, focus: s.key, icon: at.icon, words: `${s.section ?? ''} ${ALSO[s.key] ?? ''}`, spec: s });
  }
  return out;
}

/** The entries for `query`, best first: the name is the query (0), the name's words start with its
 * words (1; a control's, action's or page's other words are its name), a setting's other words do (2),
 * its page and detail do (3); the menu takes no detail matches (`worst` 2).
 * @param {string} query @param {number} [max] @param {number} [worst] */
export function find(query, max = 30, worst = 3) {
  const q = wordsOf(query);
  if (!q.length) return [];
  const starts = (/** @type {string[]} */ ws) => q.every((w) => ws.some((x) => x.startsWith(w)));
  const whole = fold(query).trim();
  /** @type {[number, Entry][]} */
  const hits = [];
  for (const e of entries()) {
    // A control's, an action's or a page's other words count as its name ("dark" is the Theme).
    const name = e.spec ? wordsOf(e.title) : [...wordsOf(e.title), ...wordsOf(e.words)];
    const also = [...name, ...wordsOf(e.words)];
    const rank = fold(e.title) === whole ? 0 : starts(name) ? 1 : starts(also) ? 2 : starts([...also, ...wordsOf(e.detail)]) ? 3 : -1;
    if (rank >= 0 && rank <= worst) hits.push([rank, e]);
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, e]) => e);
}
