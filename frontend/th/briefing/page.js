// @ts-check
// The Briefing page (BRIEFING.md), one swipe right of home: the date, the Thunderhead's line, and
// the tiles the Worker says have something to say (GET /v1/briefing): the weather first (a tap
// opens its next hours and the place, weather.js), "Waiting on you" (gold; a tap goes home to the
// card), then the night shift's tiles (a tap opens their place in their app). It paints from this phone first
// (IndexedDB `th-data`, wiped on sign-out), then from the Worker when the page comes into view, and
// again when a card, a work order or a setting changes. With nothing but the weather, a quiet line
// says the night arranges it (BRIEFING.md §7) instead of a placeholder tile. While nothing is on
// this phone yet, skeleton tiles; pulled down at the top, it refreshes with the bottom light
// breathing; a long press on a tile moves or hides it, kept on this phone. Text is set with
// textContent only.
import { api, signedIn } from '../client.js';
import { kv } from '../idb.js';
import { el, toast } from '../ui.js';

/** @typedef {import('../../../shared/contract/briefing.ts').BriefingResponse} BriefingResponse */

const db = kv('th-data');
const KEY = 'briefing';
const FRESH_MS = 60_000;
/** The owner's arrangement of the tiles, by key: `{ order: string[], hidden: string[] }`. */
const ARRANGED = 'th.p.tiles';
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
  else $('#brief .grid').replaceChildren(...['wide', 'half', 'half'].map((w) => el('div', { class: `tile skel ${w}`, 'aria-hidden': 'true' }, [el('span', { class: 'bar' }), el('span', { class: 'bar' }), el('span', { class: 'bar' })])));
  pullToRefresh(page);
  arrangeByPress(page);
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
    else if (t.dataset.go === 'open' && t.dataset.path?.startsWith('/')) {
      // A tap acts on the night's arrangement (EVALS.md M-16): one sense, kept before the page leaves
      // (the next page sends it if this one can't).
      const path = t.dataset.path;
      const ledger = t.dataset.ledger;
      (ledger ? import('../senses/send.js').then((m) => m.sense('briefing.tile', `ledger:${ledger}`)) : Promise.resolve())
        .catch(() => {})
        .finally(() => location.assign(path));
    }
    else if (t.dataset.go === 'weather' && shown?.weather) {
      const w = shown.weather;
      import('./weather.js').then((m) => m.openWeather(w, () => { at = 0; refresh(); }));
    }
  });
  refresh();
}

/** @returns {Promise<void>} */
function refresh() {
  loading ??= (async () => {
    try {
      /** @type {BriefingResponse} */
      const b = await signedIn((t) => api.call('/v1/briefing', { token: t }));
      at = Date.now();
      draw(b);
      db.set(KEY, b).catch(() => {});
    } catch {
      // Offline or the Worker didn't answer: what this phone has stands; with nothing, it says so.
      if (!shown) $('#brief .grid').replaceChildren(tile({ icon: 'wifi-slash', label: 'Briefing', value: 'Your day didn’t load.', detail: 'Pull down to try again.', cls: 'wide' }));
    } finally {
      loading = null;
    }
  })();
  return loading ?? Promise.resolve();
}

/** A tile: key line (icon and label), value, detail; a button when it goes somewhere.
 * @param {{ icon: string, label: string, value: string, detail: string, cls?: string, go?: string }} t */
function tile(t) {
  const node = el(t.go ? 'button' : 'div', { class: `tile ${t.cls ?? ''}`.trim(), ...(t.go ? { type: 'button', 'data-go': t.go } : {}) });
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

const APP_ICON = /** @type {Record<string, string>} */ ({ study: 'book-bookmark', music: 'music-notes-simple', guitar: 'guitar', podcasts: 'microphone', astra: 'monitor-play', media: 'youtube-logo' });

/** A tile the night shift placed: half unless it asked to be wide; a tap opens its place in its app.
 * @param {import('../../../shared/contract/briefing.ts').NightTile} t */
function nightTile(t) {
  const node = tile({ icon: APP_ICON[t.app ?? ''] ?? 'moon-stars', label: t.label, value: t.big ?? t.value, detail: t.detail ?? '', cls: t.wide ? 'wide night' : 'half night', go: t.path ? 'open' : undefined });
  if (t.big) {
    /** @type {HTMLElement} */ (node.querySelector('.v')).className = 'big';
    node.querySelector('.s')?.before(el('span', { class: 'v', text: t.value }));
  }
  if (!t.detail) node.querySelector('.s')?.remove();
  if (t.path) node.dataset.path = t.path;
  if (t.ledger_id) node.dataset.ledger = t.ledger_id;
  node.setAttribute('aria-label', [t.label, t.big, t.value, t.detail].filter(Boolean).join(', '));
  return node;
}

/** @param {BriefingResponse} b */
function draw(b) {
  shown = b;
  // An arrange row open across a redraw opens again under its tile.
  const arranging = /** @type {HTMLElement | null} */ (document.querySelector('#brief .tilearr'))?.dataset.key;
  /** @type {HTMLElement[]} */
  const tiles = [];
  // An answer kept on this phone from before P8 has no weather.
  if (b.weather) tiles.push(keyed(weatherTile(b.weather), 'weather'));
  for (const t of b.tiles) {
    if (t.kind === 'night') tiles.push(keyed(nightTile(t), `night:${t.label}`));
    else tiles.push(keyed(tile({ icon: 'bell', label: t.label, value: t.value, detail: t.detail, cls: 'gold half', go: 'waiting' }), `waiting:${t.label}`));
  }
  // The owner's arrangement: their order first, the rest as the Worker gave them; hidden ones out.
  const arr = arrangement();
  const place = (/** @type {HTMLElement} */ t) => {
    const i = arr.order.indexOf(t.dataset.key ?? '');
    return i < 0 ? 1e3 : i;
  };
  const hidden = tiles.filter((t) => arr.hidden.includes(t.dataset.key ?? ''));
  tiles.splice(0, tiles.length, ...tiles.filter((t) => !hidden.includes(t)).map((t, i) => /** @type {const} */ ([t, i])).sort((a, b) => place(a[0]) - place(b[0]) || a[1] - b[1]).map(([t]) => t));
  // Packing (BRIEFING.md §1): a half tile left without a partner becomes wide.
  const halves = tiles.filter((t) => t.classList.contains('half'));
  if (halves.length % 2 === 1) halves.at(-1)?.classList.add('wide');
  $('#brief .btitle .ln').textContent = b.title;
  const grid = $('#brief .grid');
  // A value or a detail that changed rolls in rather than jumping (keyed by the tile's label).
  const key = (/** @type {Element} */ t) => `${t.getAttribute('data-go') ?? ''}|${t.querySelector('.k')?.textContent ?? ''}`;
  const was = new Map([...grid.querySelectorAll('.tile')].map((t) => [key(t), [...t.querySelectorAll('.big,.v,.s')].map((n) => n.textContent)]));
  grid.replaceChildren(...tiles);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    for (const t of tiles) {
      const old = was.get(key(t));
      if (old) for (const [i, n] of [...t.querySelectorAll('.big,.v,.s')].entries()) if (old[i] !== undefined && old[i] !== n.textContent) n.animate([{ opacity: 0, transform: 'translateY(.45em)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  /** @type {HTMLElement[]} */
  const notes = [];
  if (b.muse) notes.push(el('p', { class: 'bmuse', text: b.muse }));
  if (!b.tiles.length) notes.push(el('p', { class: 'bmuse', text: 'I’ll arrange this page each night. Tomorrow it fills in.' }));
  if (hidden.length) {
    const show = el('button', { type: 'button', class: 'bmuse bhidden', text: `${hidden.length === 1 ? 'One tile' : `${hidden.length} tiles`} hidden · Show` });
    show.addEventListener('click', () => {
      keepArrangement({ ...arrangement(), hidden: [] });
      if (shown) draw(shown);
    });
    notes.push(show);
  }
  for (const old of document.querySelectorAll('#brief .bmuse')) old.remove();
  grid.after(...notes);
  if (arranging) arrange(arranging);
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

/** @param {HTMLElement} t @param {string} key */
function keyed(t, key) {
  t.dataset.key = key;
  return t;
}

/** @returns {{ order: string[], hidden: string[] }} */
function arrangement() {
  try {
    const v = JSON.parse(localStorage.getItem(ARRANGED) || '{}');
    return { order: Array.isArray(v.order) ? v.order : [], hidden: Array.isArray(v.hidden) ? v.hidden : [] };
  } catch {
    return { order: [], hidden: [] };
  }
}
/** @param {{ order: string[], hidden: string[] }} a */
function keepArrangement(a) {
  try {
    localStorage.setItem(ARRANGED, JSON.stringify(a));
  } catch {}
}

/** Pulled down 64 px at the top: refresh, the bottom light breathing while it does. @param {HTMLElement} page */
function pullToRefresh(page) {
  const hint = el('div', { class: 'pullfind', 'aria-hidden': 'true', text: 'Pull to refresh' });
  page.append(hint);
  /** @type {{ y: number, d: number } | null} */
  let pull = null;
  const show = (/** @type {number} */ d) => {
    const k = Math.min(1, d / 64);
    hint.style.opacity = String(k);
    hint.style.transform = `translate(-50%,${-12 + k * 12}px)`;
    hint.textContent = k >= 1 ? 'Release to refresh' : 'Pull to refresh';
    hint.classList.toggle('ready', k >= 1);
  };
  page.addEventListener('touchstart', (e) => {
    pull = page.scrollTop <= 0 && e.touches.length === 1 ? { y: e.touches[0].clientY, d: 0 } : null;
  }, { passive: true });
  page.addEventListener('touchmove', (e) => {
    if (!pull) return;
    pull.d = e.touches[0].clientY - pull.y;
    if (pull.d < 0 || page.scrollTop > 0) pull = null;
    show(pull ? pull.d : 0);
  }, { passive: true });
  page.addEventListener('touchend', () => {
    if (pull && pull.d >= 64) {
      const edge = document.querySelector('#edge');
      edge?.classList.add('busy');
      at = 0;
      refresh().finally(() => edge?.classList.remove('busy'));
    }
    pull = null;
    show(0);
  }, { passive: true });
}

/** A long press (450 ms) on a tile: Move earlier, Move later, Hide, under it; the tap it ends in is
 * swallowed. "Waiting on you" can move but not hide. @param {HTMLElement} page */
function arrangeByPress(page) {
  /** @type {{ t: HTMLElement, x: number, y: number, timer: ReturnType<typeof setTimeout> } | null} */
  let press = null;
  let pressed = false;
  page.addEventListener('pointerdown', (e) => {
    const t = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('#brief .grid .tile:not(.skel)'));
    if (!t?.dataset.key) return;
    press = { t, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      pressed = true;
      navigator.vibrate?.(8);
      arrange(/** @type {string} */ (t.dataset.key));
    }, 450) };
  });
  page.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
      clearTimeout(press.timer);
      press = null;
    }
  });
  addEventListener('pointerup', () => {
    if (press) clearTimeout(press.timer);
    press = null;
  });
  addEventListener('pointercancel', () => {
    if (press) clearTimeout(press.timer);
    press = null;
  });
  page.addEventListener('click', (e) => {
    if (!pressed) return;
    pressed = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  page.addEventListener('contextmenu', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.tile')) e.preventDefault();
  });
}

/** The arrange row under the tile `key`. @param {string} key */
function arrange(key) {
  document.querySelector('#brief .tilearr')?.remove();
  const grid = $('#brief .grid');
  const t = /** @type {HTMLElement | null} */ (grid.querySelector(`.tile[data-key="${CSS.escape(key)}"]`));
  if (!t) return;
  const keys = () => [...grid.querySelectorAll('.tile[data-key]')].map((n) => /** @type {HTMLElement} */ (n).dataset.key ?? '');
  const move = (/** @type {number} */ d) => {
    const k = keys();
    const i = k.indexOf(key);
    const j = i + d;
    if (j < 0 || j >= k.length) return;
    [k[i], k[j]] = [k[j], k[i]];
    keepArrangement({ ...arrangement(), order: k });
    if (shown) draw(shown);
    arrange(key);
  };
  const row = el('div', { class: 'tilearr', role: 'toolbar', 'aria-label': 'Arrange this tile', 'data-key': key });
  /** @param {string} label @param {() => void} fn */
  const add = (label, fn) => {
    const b = el('button', { type: 'button', text: label });
    b.addEventListener('click', fn);
    row.append(b);
  };
  add('Move earlier', () => move(-1));
  add('Move later', () => move(1));
  if (!key.startsWith('waiting:'))
    add('Hide', () => {
      const a = arrangement();
      keepArrangement({ ...a, hidden: [...new Set([...a.hidden, key])] });
      if (shown) draw(shown);
      toast('Tile hidden', {
        label: 'Undo',
        run: () => {
          keepArrangement(a);
          if (shown) draw(shown);
        },
      });
    });
  add('Done', () => row.remove());
  t.after(row);
}

