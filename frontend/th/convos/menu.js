// @ts-check
// The menu's Conversations (MENU-AND-SETTINGS.md §3), loaded when the menu first opens (boot.js),
// so the shell stays inside its budget. Now is a card for today (its date, how many messages, its
// part of the day); under it come Yesterday, Earlier this week (since Monday) and Last week, each a
// heading that folds its rows away and remembers that on this phone; then "All conversations ›", a
// full-screen list of every thread by month, the months folding the same way, 30 rows at a time.
// A row is the title, the date on the right ("21:40" yesterday, else "Sat 24"), and the night
// shift's summary or the message count under it, with an "Old Chats" tag on an imported one. A tap
// on a row shows it read-only on home (past.js); a tap on Now returns there. Swiped left, a row
// offers Pin (pinned rows come first, kept on this phone) and its whole summary. Skeleton rows
// stand in while the list first loads. Long-press actions (Continue this, Rename, Delete) are not
// built yet (decisions.md). Text is set with textContent.
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { toast } from '../ui.js';
import * as data from './data.js';
import { byMonth, count, GROUPS, grouped, isNow, longDate, metaOf, OLD_CHATS, PAGE, partOfDay, subOf, titleOf } from './model.js';
import * as past from './past.js';

/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('./model.js').Group} Group */

/** The list is read again on opening the menu once it is this old, or when the feed says so. */
const STALE_MS = 30_000;
/** Pinned threads' ids, on this phone (cleared at sign-out with the rest of th.p.*). */
const PINS = 'th.p.pins';

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

// Headings the owner folded, kept on this phone: a convenience, so lost storage just opens them.
const CLOSED = 'th.convos.closed';
/** @returns {Set<string>} */
function closedSet() {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}
/** @param {string} key @param {boolean} closed */
function keepClosed(key, closed) {
  const s = closedSet();
  if (closed) s.add(key);
  else s.delete(key);
  try {
    localStorage.setItem(CLOSED, JSON.stringify([...s].slice(-40)));
  } catch {}
}

let started = false;
let stale = true;
/** @type {Promise<void> | null} */
let loading = null;
/** @type {{ day: string, id: string | null, at: number | null, messages?: unknown[] }} */
let today = { day: '', id: null, at: null };

/** Folds or opens a group from its heading. @param {HTMLElement} head */
function toggle(head) {
  const g = /** @type {HTMLElement} */ (head.parentElement);
  const open = head.getAttribute('aria-expanded') !== 'true';
  head.setAttribute('aria-expanded', String(open));
  g.classList.toggle('closed', !open);
  keepClosed(/** @type {string} */ (g.dataset.g), !open);
}

/** Taps inside a list: a heading folds, a row opens its thread, "All conversations" its page.
 * @param {MouseEvent} e @param {() => void} [before] what to do before a thread opens */
function tapIn(e, before) {
  const t = /** @type {HTMLElement} */ (e.target);
  const head = /** @type {HTMLElement | null} */ (t.closest('button.ghead'));
  if (head) return toggle(head);
  const row = /** @type {HTMLElement | null} */ (t.closest('button[data-id], button[data-all]'));
  if (!row) return;
  if (row.dataset.all !== undefined) return void allPage();
  before?.();
  openThread(/** @type {string} */ (row.dataset.id));
}

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
  $('#convos').addEventListener('click', (e) => tapIn(e));
  rowSwipe($('#convos'));
  if (!$('#convos').children.length) $('#convos').replaceChildren(...[0, 1, 2].map(() => el('div', 'row thr skelrow')));
  load();
}

/** @returns {string[]} */
function pinned() {
  try {
    const v = JSON.parse(localStorage.getItem(PINS) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A row swiped left 56 px: its actions under it; the tap the swipe ends in is swallowed. @param {HTMLElement} host */
function rowSwipe(host) {
  /** @type {{ row: HTMLElement, x: number, y: number, on: boolean } | null} */
  let s = null;
  let swallow = false;
  host.addEventListener('pointerdown', (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.row.thr[data-id]'));
    s = row && e.isPrimary ? { row, x: e.clientX, y: e.clientY, on: false } : null;
  });
  addEventListener('pointermove', (e) => {
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.on) {
      if (Math.hypot(dx, dy) < 8) return;
      if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) return void (s = null);
      s.on = true;
    }
    s.row.style.transition = 'none';
    s.row.style.transform = `translateX(${Math.max(dx, -96)}px)`;
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!s) return;
    const { row, on, x } = s;
    s = null;
    row.style.transition = '';
    row.style.transform = '';
    if (!on) return;
    swallow = true;
    setTimeout(() => (swallow = false), 60);
    if (e.type === 'pointerup' && e.clientX - x <= -56) actions(row);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  host.addEventListener('click', (e) => {
    if (!swallow) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

/** Pin or Unpin, and Summary (when the night wrote one), under the row. @param {HTMLElement} row */
function actions(row) {
  const had = row.nextElementSibling?.classList.contains('rowacts');
  for (const r of document.querySelectorAll('#convos .rowacts')) r.remove();
  if (had) return;
  const id = row.dataset.id ?? '';
  const t = data.list.threads.get(id);
  const box = el('div', 'rowacts');
  box.setAttribute('role', 'toolbar');
  box.dataset.id = id;
  /** @param {string} label @param {() => void} fn */
  const add = (label, fn) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      box.remove();
      fn();
    });
    box.append(b);
  };
  const pins = pinned();
  add(pins.includes(id) ? 'Unpin' : 'Pin', () => {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [id, ...pins].slice(0, 20);
    try {
      localStorage.setItem(PINS, JSON.stringify(next));
    } catch {}
    draw();
  });
  if (t?.summary) add(row.classList.contains('full') ? 'Less' : 'Summary', () => row.classList.toggle('full'));
  row.after(box);
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

/** A row for one thread, text only: title and date, then its summary or count, an imported one tagged.
 * @param {Thread} t @param {Group} g @param {number} i its place, for the cascade as a group opens */
function row(t, g, i) {
  const b = el('button', `row thr${t.kind === 'imported' ? ' old' : ''}`);
  b.type = 'button';
  b.dataset.id = t.id;
  b.style.setProperty('--i', String(Math.min(i, 12)));
  const l1 = el('span', 'l1');
  l1.append(el('span', 'tl', titleOf(t)), el('small', 'when', metaOf(t, g)));
  const l2 = el('span', 'l2');
  if (t.kind === 'imported') l2.append(el('span', 'tag', OLD_CHATS));
  l2.append(el('span', 'sum', subOf(t)));
  const tx = el('span', 'tx');
  tx.append(l1, l2);
  b.append(tx);
  return b;
}

/** A group: its heading (name, how many, a chevron) that folds the rows under it.
 * @param {string} key @param {string} name @param {Node[]} rows @param {Set<string>} closed */
function group(key, name, rows, closed) {
  const shut = closed.has(key);
  const g = el('section', `cg${shut ? ' closed' : ''}`);
  g.dataset.g = key;
  const head = el('button', 'ghead');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(!shut));
  head.append(el('span', 'gl', name), el('span', 'gn', String(rows.length)));
  head.insertAdjacentHTML('beforeend', svg('caret-right', ' chev'));
  const inner = el('div', 'gin');
  inner.append(...rows);
  const body = el('div', 'gbody');
  body.append(inner);
  g.append(head, body);
  return g;
}

/** Now's card: today's date, how many messages, the part of the day of its last one. */
function drawNow() {
  const t = today.id ? data.list.threads.get(today.id) : undefined;
  const at = t?.updated_at || today.at;
  const n = Math.max(t?.message_count ?? 0, today.messages?.length ?? 0);
  const now = $('#now');
  /** @type {HTMLElement} */ (now.querySelector('small')).textContent = at ? partOfDay(at) : '';
  const text = /** @type {HTMLElement} */ (now.querySelector('.t'));
  if (!today.day) return;
  const sub = `${longDate(today.day)}${n ? ` · ${count(n)}` : ''}`;
  if (text.querySelector('.sub')?.textContent === sub) return;
  text.replaceChildren(el('span', 'tl', 'Now'), el('span', 'sub', sub));
}

/** The groups under Now, and the line when the list couldn't load. @param {unknown} [error] */
async function draw(error) {
  // A row's actions open across a redraw open again under it.
  const acting = /** @type {HTMLElement | null} */ (document.querySelector('#convos .rowacts'))?.dataset.id;
  const host = $('#convos');
  today = await data.today().catch(() => today);
  drawNow();
  /** @type {Node[]} */
  const out = [];
  if (today.day) {
    const every = [...data.list.threads.values()];
    const pins = pinned();
    const top = pins.map((id) => data.list.threads.get(id)).filter((t) => t && !isNow(t, today.day, today.id));
    const all = every.filter((t) => !top.includes(t));
    const g = grouped(all, today.day, today.id);
    const closed = closedSet();
    if (top.length) out.push(group('pinned', 'Pinned', /** @type {Thread[]} */ (top).map((t, i) => row(t, 'week', i)), closed));
    out.push(...g.today.map((t, i) => row(t, 'today', i)));
    for (const [key, name] of GROUPS) if (g[key].length) out.push(group(key, name, g[key].map((t, i) => row(t, key, i)), closed));
    const others = every.filter((t) => !isNow(t, today.day, today.id)).length;
    if (others || !data.list.done) {
      const b = el('button', 'row all');
      b.type = 'button';
      b.dataset.all = '';
      const tx = el('span', 'tx');
      tx.append(el('span', 'tl', 'All conversations'), el('span', 'l2', data.list.done ? `${others} ${others === 1 ? 'conversation' : 'conversations'}, by month` : 'By month, newest first'));
      b.append(tx);
      b.insertAdjacentHTML('beforeend', svg('caret-right', ' go'));
      out.push(b);
    } else if (!error) out.push(el('p', 'cline', 'Each day files itself here once it is over.'));
  }
  if (error) out.push(el('p', 'cline', listLine(error, data.list.threads.size > 0)));
  host.replaceChildren(...out);
  const again = acting ? /** @type {HTMLElement | null} */ (host.querySelector(`.row.thr[data-id="${CSS.escape(acting)}"]`)) : null;
  if (again) actions(again);
}

/** What the list says when the Worker didn't answer: over what this phone has, or alone.
 * @param {unknown} e @param {boolean} kept */
function listLine(e, kept) {
  if (!navigator.onLine) return kept ? 'Offline: showing what this phone has.' : "You're offline. Your conversations show once you're back.";
  return `${kept ? "Couldn't refresh your conversations." : "Couldn't load your conversations."} ${lineFor(failure(e))}`;
}

/** "All conversations": every thread but Now, by month, newest first, 30 at a time, full screen
 * over the menu like a settings page. */
async function allPage() {
  const back = el('button', 'sback', '‹ Menu');
  back.type = 'button';
  const lead = el('p', 'alllead');
  const list = el('div', 'alllist');
  const more = el('button', 'btn soft', 'Show more');
  more.type = 'button';
  const line = el('p', 'line');
  line.setAttribute('role', 'status');
  const page = el('section', 'spage allconvos');
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-label', 'All conversations');
  page.append(back, el('h1', '', 'All conversations'), lead, list, more, line);
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
  list.addEventListener('click', (e) => tapIn(e, close));
  const threads = () => [...data.list.threads.values()].filter((t) => !isNow(t, today.day, today.id));
  const paint = () => {
    const all = threads();
    const closed = closedSet();
    /** @type {Node[]} */
    const out = [];
    let left = shown;
    for (const m of byMonth(all, today.day)) {
      if (left <= 0) break;
      const items = m.items.slice(0, left);
      left -= items.length;
      out.push(group(`m:${m.key}`, m.label, items.map((t, i) => row(t, 'older', i)), closed));
    }
    if (!all.length && data.list.done) out.push(el('p', 'cline', 'Each day files itself here once it is over.'));
    list.replaceChildren(...out);
    lead.textContent = data.list.done ? `${all.length} ${all.length === 1 ? 'conversation' : 'conversations'}, newest first.` : 'Newest first.';
    more.hidden = all.length <= shown && data.list.done;
  };
  /** Reads until there are `shown` threads, or the end. */
  const fill = async () => {
    more.disabled = true;
    line.textContent = '';
    try {
      if (!today.day) today = await data.today();
      if (threads().length < shown) await data.more(shown - threads().length);
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
