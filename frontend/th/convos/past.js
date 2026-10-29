// @ts-check
// An older conversation on home, read-only (HOME.md §4.9): the voice line, the decision card and
// today's thread step aside; a glass pill at the top of the column reads "<title> · <when>" with
// Back to now; the filed thread shows scrolled to the bottom, or to a search hit, highlighted for
// 2 s. Back, the pill's button, the menu's Now row, or sending a message returns to today (the
// message then sends as usual). Text is set with textContent only.
import { replyBody } from '../chat/view.js';
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import * as data from './data.js';
import { titleOf, whenOf } from './model.js';

/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('../../../shared/contract/api.ts').Message} Message */

/** Pages read back at most to find a search hit (1,000 messages). */
const FIND_PAGES = 5;
export const HIT_MS = 2000;

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const pill = el('div', 'past');
const label = el('span');
const back = el('button', '', 'Back to now');
back.type = 'button';
pill.append(label, back);
const log = el('div', 'turns talk pastlog');
log.id = 'past';
log.setAttribute('role', 'log');

/** @typedef {{ id: string, before: number | null, items: Message[] }} Open */
/** @type {Open | null} */
let open = null;
let wired = false;

export const isOpen = () => open !== null;

function wire() {
  if (wired) return;
  wired = true;
  back.addEventListener('click', () => close());
  addEventListener('popstate', () => {
    if (open && history.state?.th !== 'past') close(true);
  });
  // Sending from the ask bar returns to now first; the conversation (th/chat) then sends it.
  document.addEventListener('submit', (e) => {
    if (open && /** @type {HTMLElement} */ (e.target).id === 'ask') close();
  }, true);
}

/** Shows `t` on home; `focus` is a message id to scroll to and highlight. @param {Thread} t @param {string | null} [focus] */
export async function show(t, focus = null) {
  wire();
  const was = open;
  open = { id: t.id, before: null, items: [] };
  const mine = open;
  label.textContent = titleOf(t);
  log.setAttribute('aria-label', titleOf(t));
  log.replaceChildren();
  const home = $('#home');
  const convo = $('#convo');
  home.classList.add('pastview');
  if (!pill.isConnected) convo.prepend(pill);
  if (!log.isConnected) convo.append(log);
  // One history entry for the past view: Back returns to now. A search's entry becomes this one.
  if (was || history.state?.th) history.replaceState({ th: 'past' }, '');
  else history.pushState({ th: 'past' }, '');
  back.focus({ preventScroll: true });
  data.today().then(({ day }) => {
    if (open === mine) label.textContent = `${titleOf(t)} · ${whenOf(t.day, day)}`;
  }, () => {});
  await load(mine, focus);
}

/** Reads the newest page (and further back until `focus` is there), then draws. @param {Open} o @param {string | null} focus */
async function load(o, focus) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    let p = await data.messages(o.id, null);
    /** @type {Message[]} */
    let items = p.items;
    for (let i = 1; focus && p.before && i < FIND_PAGES && !items.some((m) => m.id === focus); i++) {
      p = await data.messages(o.id, p.before);
      items = [...p.items, ...items];
    }
    if (open !== o) return;
    o.items = items;
    o.before = p.before;
    draw(o);
    const hit = focus ? log.querySelector(`[data-id="${CSS.escape(focus)}"]`) : null;
    if (hit) highlight(/** @type {HTMLElement} */ (hit));
    else $('#convo').scrollTop = $('#convo').scrollHeight;
  } catch (e) {
    if (open !== o) return;
    problem(e, () => load(o, focus));
  }
}

/** The line in place of the thread when it couldn't load, with Retry. @param {unknown} e @param {() => void} retry */
function problem(e, retry) {
  const line = el('div', 'sys', navigator.onLine ? lineFor(failure(e)) : "You're offline. This conversation shows once you're back.");
  const again = el('button', 'retry', 'Retry');
  again.type = 'button';
  again.addEventListener('click', () => {
    turn.remove();
    retry();
  });
  line.append(' ', again);
  const turn = el('div', 'turn sysline');
  turn.append(line);
  log.prepend(turn);
}

/** Older messages above, keeping what's on screen where it is. @param {Open} o @param {HTMLButtonElement} btn */
async function earlier(o, btn) {
  btn.disabled = true;
  try {
    const p = await data.messages(o.id, o.before);
    if (open !== o) return;
    const convo = $('#convo');
    const h = convo.scrollHeight;
    o.items = [...p.items, ...o.items];
    o.before = p.before;
    draw(o);
    convo.scrollTop += convo.scrollHeight - h;
  } catch (e) {
    btn.disabled = false;
    problem(e, () => earlier(o, btn));
  }
}

/** One message, as home draws it, without its actions (read-only). @param {Message} m */
function message(m) {
  /** @type {HTMLElement} */
  let node;
  if (m.author === 'owner') {
    node = el('div', 'mine');
    node.append(el('div', 'you', m.body));
  } else if (m.author === 'mind' && m.kind !== 'error') {
    node = el('div', `voice reply${m.kind === 'progress' ? ' progress' : ''}`);
    node.append(replyBody(m.body));
  } else node = el('div', 'sys', m.body);
  node.dataset.id = m.id;
  return node;
}

/** The thread in turns: an owner message starts one and the replies join it. @param {Open} o */
function draw(o) {
  /** @type {Node[]} */
  const out = [];
  if (o.before) {
    const btn = el('button', 'earlier', 'Show earlier');
    btn.type = 'button';
    btn.addEventListener('click', () => earlier(o, btn));
    out.push(btn);
  }
  /** @type {HTMLElement | null} */
  let turn = null;
  let alone = false;
  for (const m of o.items) {
    // A system line (or another agent's) stands alone, as on home.
    const lone = m.author !== 'owner' && m.author !== 'mind';
    if (!turn || m.author === 'owner' || lone || alone) {
      turn = el('div', lone ? 'turn sysline' : 'turn');
      alone = lone;
      out.push(turn);
    }
    turn.append(message(m));
  }
  if (!o.items.length) out.push(el('div', 'sys', 'No messages in this one yet.'));
  log.replaceChildren(...out);
}

/** Scrolls to a message and tints it for 2 s. @param {HTMLElement} node */
export function highlight(node) {
  node.scrollIntoView({ block: 'center' });
  node.classList.add('hit');
  setTimeout(() => node.classList.remove('hit'), HIT_MS);
}

/** Back to today. `fromPop`: the history entry is already gone. */
export function close(fromPop = false) {
  if (!open) return;
  open = null;
  $('#home').classList.remove('pastview');
  pill.remove();
  log.replaceChildren();
  log.remove();
  const convo = $('#convo');
  convo.scrollTop = convo.scrollHeight;
  if (!fromPop && history.state?.th === 'past') history.back();
}

/** Today's thread, at a message (a search hit): back to now, then scroll to it if it is drawn. @param {string} id */
export function focusNow(id) {
  close();
  const node = document.querySelector(`#talk [data-id="${CSS.escape(id)}"]`);
  if (node) setTimeout(() => highlight(/** @type {HTMLElement} */ (node)), 50);
}
