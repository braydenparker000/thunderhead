// @ts-check
// The menu's Conversations (MENU-AND-SETTINGS.md §3), loaded when the menu first opens (boot.js),
// so the shell stays inside its budget: Today's Now row with its part of the day, Yesterday, This
// week, and "All conversations ›", a full-screen list of every older thread by month, 30 at a time.
// Imported old chats land by their own day with "from the old Chats" under the title. A tap on an
// older row shows it read-only on home (past.js); a tap on Now returns there, or says it is already
// there. Long-press actions (Continue this, Rename, Delete) are not built yet (decisions.md). Text
// is set with textContent only.
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { toast } from '../ui.js';
import * as data from './data.js';
import { byMonth, grouped, metaOf, OLD_CHATS, PAGE, partOfDay, titleOf } from './model.js';
import * as past from './past.js';

/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('./model.js').Group} Group */

/** The list is read again on opening the menu once it is this old, or when the feed says so. */
const STALE_MS = 30_000;
const GROUPS = /** @type {const} */ ([['yesterday', 'Yesterday'], ['week', 'This week']]);

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const svg = (/** @type {string} */ icon, cls = '') => `<svg class="i${cls}" aria-hidden="true"><use href="/ui/icons.svg#${icon}"/></svg>`;
/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const go = (/** @type {string} */ v) => document.dispatchEvent(new CustomEvent('th:go', { detail: v }));

let started = false;
let stale = true;
/** @type {Promise<void> | null} */
let loading = null;
/** @type {{ day: string, id: string | null, at: number | null }} */
let today = { day: '', id: null, at: null };

/** Wires the menu once; boot.js calls it when the menu first starts to open. */
export function startMenu() {
  if (started) return;
  started = true;
  const side = $('#side');
  new MutationObserver(() => {
    if (side.classList.contains('open') && (stale || Date.now() - data.list.at > STALE_MS)) load();
  }).observe(side, { attributes: true, attributeFilter: ['class'] });
  addEventListener('online', () => {
    stale = true;
    if (side.classList.contains('open')) load();
  });
  document.addEventListener('th:changed', (e) => {
    const kinds = /** @type {CustomEvent<string[]>} */ (e).detail ?? [];
    if (!kinds.some((k) => k === 'thread' || k === 'message' || k === '*')) return;
    stale = true;
    if (side.classList.contains('open')) load();
  });
  // Now: back from an older conversation, else the toast that it is already here (home.js).
  $('#now').addEventListener('click', (e) => {
    if (!past.isOpen()) return;
    e.stopImmediatePropagation();
    past.close();
    go('home');
  }, true);
  $('#convos').addEventListener('click', (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-id], button[data-all]'));
    if (!row) return;
    if (row.dataset.all !== undefined) allPage();
    else openThread(/** @type {string} */ (row.dataset.id));
  });
  load();
}

/** Reads the list (from this phone first, so there is something at once) and draws it. */
function load() {
  stale = false;
  loading ??= (async () => {
    try {
      if (await data.fromCache()) await draw();
      // Offline, what this phone has stands, with a line that says so.
      if (!navigator.onLine) throw new Error('offline');
      await data.refresh();
      await draw();
    } catch (e) {
      stale = true;
      await draw(e).catch(() => {});
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Shows an older thread on home. @param {string} id @param {string | null} [focus] */
export async function openThread(id, focus = null) {
  try {
    const t = await data.thread(id);
    go('home');
    await past.show(t, focus);
  } catch (e) {
    toast(navigator.onLine ? lineFor(failure(e)) : "You're offline. This conversation shows once you're back.");
  }
}

/** A row for one older thread. @param {Thread} t @param {Group} g */
function row(t, g) {
  const b = el('button', 'row thr');
  b.type = 'button';
  b.dataset.id = t.id;
  b.innerHTML = svg('chat-circle');
  const title = el('span', 't');
  title.append(el('span', 'tl', titleOf(t)));
  if (t.kind === 'imported') title.append(el('span', 'src', OLD_CHATS));
  b.append(title, el('small', '', metaOf(t, g)));
  return b;
}

/** The groups under Now, and the line when the list couldn't load. @param {unknown} [error] */
async function draw(error) {
  const host = $('#convos');
  today = await data.today().catch(() => today);
  const at = (today.id && data.list.threads.get(today.id)?.updated_at) || today.at;
  $('#now small').textContent = at ? partOfDay(at) : '';
  /** @type {Node[]} */
  const out = [];
  if (today.day) {
    const g = grouped([...data.list.threads.values()], today.day, today.id);
    out.push(...g.today.map((t) => row(t, 'today')));
    for (const [key, name] of GROUPS) if (g[key].length) out.push(el('div', 'grp', name), ...g[key].map((t) => row(t, key)));
    if (g.older.length || !data.list.done) {
      const all = el('button', 'row all');
      all.type = 'button';
      all.dataset.all = '';
      all.innerHTML = svg('clock');
      all.append(el('span', 't', 'All conversations'));
      all.insertAdjacentHTML('beforeend', svg('caret-right', ' go'));
      out.push(all);
    }
  }
  if (error) out.push(el('p', 'cline', listLine(error, data.list.threads.size > 0)));
  host.replaceChildren(...out);
}

/** What the list says when the Worker didn't answer: over what this phone has, or alone.
 * @param {unknown} e @param {boolean} kept */
function listLine(e, kept) {
  if (!navigator.onLine) return kept ? 'Offline: showing what this phone has.' : "You're offline. Your conversations show once you're back.";
  return `${kept ? "Couldn't refresh your conversations." : "Couldn't load your conversations."} ${lineFor(failure(e))}`;
}

/** "All conversations": every thread older than this week, by month, newest first, 30 at a time,
 * full screen over the menu like a settings page. */
async function allPage() {
  const back = el('button', 'sback', '‹ Menu');
  back.type = 'button';
  const list = el('div', 'alllist');
  const more = el('button', 'btn soft', 'Show more');
  more.type = 'button';
  const line = el('p', 'line');
  line.setAttribute('role', 'status');
  const page = el('section', 'spage allconvos');
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-label', 'All conversations');
  page.append(back, el('h1', '', 'All conversations'), list, more, line);
  $('#app').append(page);
  requestAnimationFrame(() => page.classList.add('in'));
  back.focus({ preventScroll: true });
  let shown = PAGE;
  const close = () => {
    page.classList.remove('in');
    setTimeout(() => page.remove(), 320);
  };
  back.addEventListener('click', close);
  page.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  list.addEventListener('click', (e) => {
    const r = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-id]'));
    if (!r) return;
    close();
    openThread(/** @type {string} */ (r.dataset.id));
  });
  const paint = () => {
    const older = grouped([...data.list.threads.values()], today.day, today.id).older;
    /** @type {Node[]} */
    const out = [];
    let left = shown;
    for (const m of byMonth(older)) {
      if (left <= 0) break;
      const items = m.items.slice(0, left);
      left -= items.length;
      out.push(el('div', 'grp', m.label), ...items.map((t) => row(t, 'older')));
    }
    if (!older.length && data.list.done) out.push(el('p', 'cline', 'Nothing older than this week yet.'));
    list.replaceChildren(...out);
    more.hidden = older.length <= shown && data.list.done;
  };
  /** Reads until there are `shown` older threads, or the end. */
  const fill = async () => {
    more.disabled = true;
    line.textContent = '';
    try {
      if (!today.day) today = await data.today();
      const have = () => grouped([...data.list.threads.values()], today.day, today.id).older.length;
      if (have() < shown) await data.more(today.day, shown - have());
    } catch (e) {
      line.textContent = navigator.onLine ? lineFor(failure(e)) : "You're offline. The rest shows once you're back.";
    } finally {
      more.disabled = false;
      paint();
    }
  };
  more.addEventListener('click', () => {
    shown += PAGE;
    fill();
  });
  paint();
  await fill();
}
