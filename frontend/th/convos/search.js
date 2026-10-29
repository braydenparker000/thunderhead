// @ts-check
// Search in the menu (MENU-AND-SETTINGS.md §2): the "Search everything" pill becomes a search
// field and the panel shows results instead, in groups (Go to 4, Conversations 5, What I remember
// 3, each with "Show all N"). This phone answers first, in the same frame: app and settings names,
// thread titles, today's messages. The Worker's search (GET /v1/search: every message, imported
// old chats included, facts and day notes) answers 150 ms after typing stops, and its rows are
// appended within their groups, never reordering what is on screen. Offline it says so and
// searches this phone only. × clears; Back or Escape leaves search. Text is set with textContent.
import { current } from '../chat/index.js';
import { failure } from '../flow.js';
import { SOURCES } from '../registry/memory.js';
import { apps } from '../registry/apps.js';
import { toast } from '../ui.js';
import * as data from './data.js';
import { openThread } from './menu.js';
import { append, around, DEBOUNCE_MS, find, MIN_CHARS, rank, refId, shortDate, SHOWN, snippetParts, titleOf } from './model.js';
import * as past from './past.js';

/** @typedef {import('./model.js').Part} Part */
/** @typedef {'goto' | 'convos' | 'memory'} G */
/** @typedef {{ ref: string, icon: string, color?: string, title: string, parts?: Part[], sub?: string, thread?: string, act: () => void }} Row */

const GROUPS = /** @type {const} */ ([['goto', 'Go to'], ['convos', 'Conversations'], ['memory', 'What I remember']]);
const OFFLINE = 'Offline: searching this phone only.';
const PARTIAL = "Couldn't reach the full search. These are from this phone.";

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const svg = (/** @type {string} */ icon) => `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${icon}"/></svg>`;
/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const go = (/** @type {string} */ v) => document.dispatchEvent(new CustomEvent('th:go', { detail: v }));

/** @type {{ box: HTMLElement, input: HTMLInputElement, results: HTMLElement } | null} */
let ui = null;
let token = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
/** @type {{ q: string, rows: Record<G, Row[]>, all: Set<G>, server: 'idle' | 'pending' | 'done' | 'offline' | 'failed' }} */
let run = { q: '', rows: { goto: [], convos: [], memory: [] }, all: new Set(), server: 'idle' };
let wired = false;

/** Enters search: the field, focused, and the results in place of the rest of the panel. */
export function enter() {
  if (ui) return ui.input.focus();
  wire();
  const box = el('div', 'search sbox');
  box.innerHTML = svg('magnifying-glass');
  const input = el('input');
  Object.assign(input, { type: 'search', autocomplete: 'off', spellcheck: false, enterKeyHint: 'search' });
  input.setAttribute('aria-label', 'Search everything');
  const clear = el('button', 'sclear');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear');
  clear.innerHTML = svg('x');
  box.append(input, clear);
  const results = el('div', 'sres');
  const pill = $('#search');
  pill.hidden = true;
  pill.after(box, results);
  $('#side').classList.add('searching');
  ui = { box, input, results };
  history.pushState({ th: 'search' }, '');
  input.addEventListener('input', changed);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exit();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    changed();
    input.focus();
  });
  results.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const all = /** @type {HTMLElement | null} */ (t.closest('[data-all]'));
    if (all) {
      run.all.add(/** @type {G} */ (all.dataset.all));
      return draw();
    }
    if (t.closest('.askme')) return askInstead();
    const b = /** @type {HTMLElement | null} */ (t.closest('[data-ref]'));
    const row = b && Object.values(run.rows).flat().find((r) => r.ref === b.dataset.ref);
    row?.act();
  });
  input.focus();
}

function wire() {
  if (wired) return;
  wired = true;
  addEventListener('popstate', () => {
    if (ui && history.state?.th !== 'search') exit(false);
  });
  const side = $('#side');
  new MutationObserver(() => {
    if (ui && !side.classList.contains('open')) exit();
  }).observe(side, { attributes: true, attributeFilter: ['class'] });
}

/** Leaves search. `pop`: false when Back already removed search's history entry, or when the
 * past view takes it over. */
export function exit(pop = true) {
  if (!ui) return;
  ui.box.remove();
  ui.results.remove();
  ui = null;
  token++;
  clearTimeout(timer);
  $('#search').hidden = false;
  $('#side').classList.remove('searching');
  if (pop && history.state?.th === 'search') history.back();
}

/** Each keystroke: this phone's rows at once, the Worker's after a pause. */
function changed() {
  if (!ui) return;
  const q = ui.input.value.trim();
  const mine = ++token;
  clearTimeout(timer);
  run = { q, rows: { goto: [], convos: [], memory: [] }, all: new Set(), server: 'idle' };
  if (q.length < MIN_CHARS) return draw();
  run.rows.goto = goto(q);
  run.rows.convos = localConvos(q);
  run.server = navigator.onLine ? 'pending' : 'offline';
  draw();
  if (run.server === 'offline') return;
  timer = setTimeout(async () => {
    try {
      const hits = await data.search(q);
      if (mine !== token) return;
      for (const h of hits) {
        if (h.source === 'messages' && h.thread_id) run.rows.convos = append(run.rows.convos, [messageRow(h.ref, h.thread_id, snippetParts(h.snippet))]);
        else if (h.source === 'facts' || h.source === 'day_notes') run.rows.memory = append(run.rows.memory, [memoryRow(h.ref, snippetParts(h.snippet))]);
      }
      run.server = 'done';
    } catch (e) {
      if (mine !== token) return;
      run.server = !navigator.onLine || failure(e).kind === 'network' ? 'offline' : 'failed';
    }
    draw();
  }, DEBOUNCE_MS);
}

/** App and settings names; exact, then prefix, then the rest. @param {string} q @returns {Row[]} */
function goto(q) {
  /** @type {{ name: string, icon: string, color?: string, act: () => void }[]} */
  const named = apps.map((a) => ({ name: a.name, icon: a.icon, color: a.color, act: () => (a.built ? location.assign(a.path) : toast(`${a.name} comes later`)) }));
  for (const r of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#side > .row:not(#now)'))) {
    const name = r.querySelector('.t')?.textContent ?? '';
    const icon = r.querySelector('use')?.getAttribute('href')?.split('#')[1] ?? 'caret-right';
    if (name) named.push({ name, icon, act: () => r.click() });
  }
  return named
    .map((n) => /** @type {const} */ ([rank(n.name, q), n]))
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, n]) => ({ ref: `go:${n.name}`, icon: n.icon, color: n.color, title: n.name, act: () => leave(n.act) }));
}

/** Thread titles from the list, and today's messages, both on this phone. @param {string} q @returns {Row[]} */
function localConvos(q) {
  /** @type {Row[]} */
  const rows = [];
  const todayId = current.today?.thread?.id ?? null;
  for (const t of data.list.threads.values()) {
    if (t.id === todayId) continue;
    const title = titleOf(t);
    const at = find(title, q);
    if (!at) continue;
    rows.push({ ref: `thread:${t.id}`, icon: 'chat-circle', title: '', parts: [...around(title, at[0], at[1], 60), { text: ` · ${shortDate(t.day)}`, bold: false }], act: () => leave(() => openThread(t.id), false) });
  }
  for (const m of current.today?.messages ?? []) {
    const at = find(m.body, q);
    if (at) rows.push(messageRow(`msg:${m.id}`, m.thread_id, around(m.body.replace(/\s+/g, ' '), at[0], at[1])));
  }
  return rows;
}

/** A message hit: its thread's title and date over the snippet. @param {string} ref @param {string} thread @param {Part[]} parts @returns {Row} */
function messageRow(ref, thread, parts) {
  const id = refId(ref);
  const today = thread === (current.today?.thread?.id ?? null);
  const t = data.list.threads.get(thread);
  return {
    ref, icon: 'chat-circle', parts, thread,
    title: today ? 'Now' : t ? `${titleOf(t)} · ${shortDate(t.day)}` : '',
    act: () => (today ? leave(() => (go('home'), past.focusNow(id))) : leave(() => openThread(thread, id), false)),
  };
}

/** A fact or a day note. @param {string} ref @param {Part[]} parts @returns {Row} */
function memoryRow(ref, parts) {
  const day = ref.startsWith('day:') ? refId(ref) : null;
  return { ref, icon: 'brain', parts, title: '', sub: day ? `Day note · ${shortDate(day)}` : undefined, act: () => leave(() => remembered(day ? null : refId(ref))) };
}

/** Leaves search, then the menu or this page, then runs `act`. @param {() => void} act @param {boolean} [pop] */
function leave(act, pop = true) {
  exit(pop);
  act();
}

/** What I remember, at the fact (filtered by the query when it isn't among the rows drawn). @param {string | null} id */
function remembered(id) {
  const q = run.q;
  /** @type {HTMLElement | null} */ (document.querySelector('#side [data-open="memory"]'))?.click();
  const until = Date.now() + 5000;
  const seek = (/** @type {boolean} */ filtered) => {
    const sections = document.querySelector('.spage .msections');
    if (!sections || sections.hasAttribute('aria-busy')) return void (Date.now() < until && setTimeout(() => seek(filtered), 50));
    const row = id ? sections.querySelector(`.mrow[data-id="${CSS.escape(id)}"]`) : null;
    if (row) return past.highlight(/** @type {HTMLElement} */ (row));
    const f = /** @type {HTMLInputElement | null} */ (document.querySelector('.spage .msearch'));
    if (filtered || !f) return;
    f.value = q;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => seek(true), 200);
  };
  seek(false);
}

/** Nothing found: the query goes to the ask bar. */
function askInstead() {
  const q = run.q;
  exit();
  go('home');
  const bar = /** @type {HTMLInputElement} */ ($('#q'));
  bar.value = q;
  bar.dispatchEvent(new Event('input', { bubbles: true }));
  bar.focus();
}

/** @param {Part[]} parts */
function marked(parts) {
  const s = el('span', 'sn');
  for (const p of parts) s.append(p.bold ? el('b', '', p.text) : p.text);
  return s;
}

/** @param {Row} r */
function rowEl(r) {
  const b = el('button', 'row srow');
  b.type = 'button';
  b.dataset.ref = r.ref;
  if (r.color) b.style.setProperty('--c', r.color);
  b.innerHTML = svg(r.icon);
  const t = el('span', 't');
  if (r.title) t.append(el('span', 'tl', r.title));
  if (r.parts) t.append(marked(r.parts));
  if (r.sub) t.append(el('span', 'src', r.sub));
  b.append(t);
  return b;
}

/** Draws the groups; then fills in, once, the thread titles and fact sources it lacked. */
function draw() {
  if (!ui) return;
  /** @type {Node[]} */
  const out = [];
  if (run.server === 'offline') out.push(el('p', 'cline', OFFLINE));
  if (run.server === 'failed') out.push(el('p', 'cline', PARTIAL));
  /** @type {Row[]} */
  const drawn = [];
  for (const [g, name] of GROUPS) {
    const rows = run.rows[g];
    if (!rows.length) continue;
    const shown = run.all.has(g) ? rows : rows.slice(0, SHOWN[g]);
    drawn.push(...shown);
    out.push(el('div', 'grp', name), ...shown.map(rowEl));
    if (shown.length < rows.length) {
      const all = el('button', 'showall', `Show all ${rows.length}`);
      all.type = 'button';
      all.dataset.all = g;
      out.push(all);
    }
  }
  if (run.q.length >= MIN_CHARS && !drawn.length && run.server !== 'pending') {
    const ask = el('button', 'btn soft askme', 'Ask me instead');
    ask.type = 'button';
    out.push(el('p', 'cline', `Nothing found for “${run.q}”.`), ask);
  }
  ui.results.replaceChildren(...out);
  fill(drawn);
}

/** @type {Set<string>} */
const asked = new Set();
/** Thread titles and fact sources for drawn rows, each looked up once per search. @param {Row[]} rows */
function fill(rows) {
  const mine = token;
  for (const r of rows) {
    if (asked.has(`${mine}:${r.ref}`)) continue;
    if (r.thread && !r.title) {
      asked.add(`${mine}:${r.ref}`);
      const thread = r.thread;
      data.thread(thread).then((t) => {
        r.title = `${titleOf(t)} · ${shortDate(t.day)}`;
        if (mine === token) draw();
      }, () => {});
    } else if (r.ref.startsWith('fact:') && r.sub === undefined) {
      asked.add(`${mine}:${r.ref}`);
      data.fact(refId(r.ref)).then((f) => {
        r.sub = SOURCES[/** @type {keyof typeof SOURCES} */ (f.source)] ?? '';
        if (mine === token) draw();
      }, () => {});
    }
  }
}
