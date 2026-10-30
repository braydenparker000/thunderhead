// @ts-check
// The Briefing page (BRIEFING.md), one swipe right of home: the date, the Thunderhead's line, and
// the tiles the Worker says have something to say (GET /v1/briefing): the weather first (a tap
// opens its next hours and the place, weather.js), "Waiting on you" (gold; a tap goes home to the
// card), then the Board last (a tap opens the reader, board.js). It paints from this phone first
// (IndexedDB `th-data`, wiped on sign-out), then from the Worker when the page comes into view, and
// again when a card, a work order or a setting changes. Practice, study and what was built
// overnight come with the night shift's tiles; until then a quiet line says so instead of a
// placeholder tile. Text is set with textContent only.
import { api, signedIn } from '../client.js';
import { kv } from '../idb.js';
import { el } from '../ui.js';

/** @typedef {import('../../../shared/contract/briefing.ts').BriefingResponse} BriefingResponse */

const db = kv('th-data');
const KEY = 'briefing';
const FRESH_MS = 60_000;
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const icon = (/** @type {string} */ name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `/ui/icons.svg#${name}`);
  s.append(u);
  return s;
};

let at = 0;
/** @type {BriefingResponse | null} */
let shown = null;
/** @type {Promise<void> | null} */
let loading = null;

/** Wires the page once (boot.js, after the first paint). */
export async function startBriefing() {
  const page = $('#brief');
  $('#bdate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const cached = await db.get(KEY).catch(() => null);
  if (cached?.day) draw(cached);
  new IntersectionObserver((seen) => {
    if (seen.some((e) => e.isIntersecting) && Date.now() - at > FRESH_MS) refresh();
  }, { threshold: 0.3 }).observe(page);
  document.addEventListener('th:changed', (e) => {
    const kinds = /** @type {CustomEvent<string[]>} */ (e).detail ?? [];
    if (kinds.some((k) => k === 'proposal' || k === 'work' || k === 'setting' || k === '*')) at = 0;
  });
  page.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-go]'));
    if (!t) return;
    if (t.dataset.go === 'waiting') toCard();
    else if (t.dataset.go === 'board') import('./board.js').then((m) => m.openBoard(/** @type {string} */ (t.dataset.day)));
    else if (t.dataset.go === 'weather' && shown?.weather) {
      const w = shown.weather;
      import('./weather.js').then((m) => m.openWeather(w, () => { at = 0; refresh(); }));
    }
  });
  refresh();
}

function refresh() {
  loading ??= (async () => {
    try {
      /** @type {BriefingResponse} */
      const b = await signedIn((t) => api.call('/v1/briefing', { token: t }));
      at = Date.now();
      draw(b);
      db.set(KEY, b).catch(() => {});
    } catch {
      // Offline or the Worker didn't answer: what this phone has stands.
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** A tile: key line (icon and label), value, detail; a button when it goes somewhere.
 * @param {{ icon: string, label: string, value: string, detail: string, cls?: string, go?: string, day?: string }} t */
function tile(t) {
  const node = el(t.go ? 'button' : 'div', { class: `tile ${t.cls ?? ''}`.trim(), ...(t.go ? { type: 'button', 'data-go': t.go } : {}) });
  if (t.day) node.dataset.day = t.day;
  const k = el('span', { class: 'k' });
  k.append(icon(t.icon), t.label);
  node.append(k, el('span', { class: 'v', text: t.value }), el('span', { class: 's', text: t.detail }));
  node.setAttribute('aria-label', `${t.label}, ${t.value}, ${t.detail}`);
  return node;
}

/** The weather tile: the place (or "Weather"), the temperature big, the sentence. @param {NonNullable<BriefingResponse['weather']>} w */
function weatherTile(w) {
  const node = tile({ icon: 'cloud-sun', label: w.place ?? 'Weather', value: w.temp ?? '', detail: w.detail, cls: 'wide weather', go: 'weather' });
  const v = /** @type {HTMLElement} */ (node.querySelector('.v'));
  if (w.temp) v.className = 'big';
  else v.remove();
  node.setAttribute('aria-label', [w.place ?? 'Weather', w.temp, w.detail].filter(Boolean).join(', '));
  return node;
}

/** @param {BriefingResponse} b */
function draw(b) {
  shown = b;
  /** @type {HTMLElement[]} */
  const tiles = [];
  // An answer kept on this phone from before P8 has no weather.
  if (b.weather) tiles.push(weatherTile(b.weather));
  for (const w of b.tiles) tiles.push(tile({ icon: 'bell', label: w.label, value: w.value, detail: w.detail, cls: 'gold half', go: 'waiting' }));
  if (b.board) tiles.push(tile({ icon: 'newspaper', label: 'The Board', value: b.board.title, detail: b.board.detail, cls: 'wide board', go: 'board', day: b.board.day }));
  // Packing (BRIEFING.md §1): a half tile left without a partner becomes wide.
  const halves = tiles.filter((t) => t.classList.contains('half'));
  if (halves.length % 2 === 1) halves.at(-1)?.classList.add('wide');
  $('#brief .btitle .ln').textContent = b.title;
  const grid = $('#brief .grid');
  grid.replaceChildren(...tiles);
  /** @type {HTMLElement[]} */
  const notes = [];
  if (b.muse) notes.push(el('p', { class: 'bmuse', text: b.muse }));
  if (!b.board && !b.tiles.length) notes.push(el('p', { class: 'bmuse', text: 'Practice, study and what I built overnight come with a later update.' }));
  for (const old of document.querySelectorAll('#brief .bmuse')) old.remove();
  grid.after(...notes);
}

/** "Waiting on you": home, with the decision card in view, its border pulsed once. */
function toCard() {
  document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' }));
  setTimeout(() => {
    const card = document.querySelector('#decision .card:not(.gone)');
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 1_400);
  }, 420);
}
