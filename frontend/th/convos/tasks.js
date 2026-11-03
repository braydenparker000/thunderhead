// @ts-check
// The menu's Tasks (MENU-AND-SETTINGS.md §3.4): what Muse was asked ("@muse …" in the chat, or by
// the mind) and its uploads, newest first (GET /v1/work/orders, 20 at most), each with its state and
// age. A tap opens a sheet with Muse's progress lines and, while it isn't finished, Cancel (the
// owner's, never gated). The group hides while there are none. Read when the menu opens and when the
// feed says `work` changed (menu.js); kept in memory only.
import { api, signedIn } from '../client.js';
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { toast } from '../ui.js';
import { icon, sheet } from '../../apps/settings/components.js';

/** @typedef {import('../../../shared/contract/work.ts').WorkOrder} WorkOrder */
/** @typedef {import('../../../shared/contract/work.ts').MuseNote} MuseNote */
/** @typedef {import('../../../shared/contract/work.ts').TaskState} TaskState */

/** Each state's word and icon. @type {Record<TaskState, [string, string]>} */
const STATES = {
  asked: ['Asked', 'clock'],
  picked_up: ['Picked up', 'hand-pointing'],
  working: ['Working', 'arrow-clockwise'],
  done: ['Done', 'check'],
  failed: ['Failed', 'warning-circle'],
  cancelled: ['Cancelled', 'x'],
};
const OPEN = new Set(['asked', 'picked_up', 'working']);

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** The orders the menu shows, newest first; empty until read. @type {WorkOrder[]} */
export let items = [];

/** Reads them again; what it had stands when the Worker can't answer. */
export async function refresh() {
  try {
    /** @type {{ items: WorkOrder[] }} */
    const page = await signedIn((t) => api.call('/v1/work/orders?status=all&limit=20', { token: t }));
    items = Array.isArray(page?.items) ? page.items.slice(0, 20) : items;
  } catch {}
}

/** "now", "5 min", "3 h", then the day. @param {number} at @param {number} [now] */
export function ago(at, now = Date.now()) {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return new Date(at).toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
}

/** A task's row, in the conversations' row anatomy: its state's icon, title, state and age.
 * @param {WorkOrder} o @param {number} i its place, for the cascade as the group opens */
export function row(o, i) {
  const [word, symbol] = STATES[o.state] ?? STATES.asked;
  const b = el('button', 'row thr task');
  b.type = 'button';
  b.dataset.task = o.id;
  b.dataset.state = o.state;
  b.style.setProperty('--i', String(Math.min(i, 12)));
  const copy = el('span', 'tx row-copy');
  copy.append(el('span', 'tl row-title', o.title), el('span', 'l2 row-detail', word));
  b.append(icon(symbol), copy, el('small', 'when row-value', ago(o.created_at)));
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  b.append(caret);
  return b;
}

/** What came of it, in a line: Muse's note when done, its reason when it failed. @param {WorkOrder} o */
function outcome(o) {
  const r = /** @type {{ note?: unknown } | null} */ (o.result);
  if (o.state === 'done') return typeof r?.note === 'string' ? r.note : '';
  if (o.state === 'failed') return o.status === 'expired' ? 'It ran out of time.' : o.heartbeat_note ?? '';
  return '';
}

/** The task's sheet: its state, Muse's progress lines, and Cancel while it isn't finished.
 * @param {string} id @param {() => void} redraw repaints the menu after a cancel */
export async function open(id, redraw) {
  const o = items.find((x) => x.id === id);
  if (!o || document.querySelector('.tasksheet')) return;
  const [word] = STATES[o.state] ?? STATES.asked;
  const log = el('div', 'tasklog');
  log.append(el('p', '', 'Loading what Muse said…'));
  /** @type {Node[]} */
  const children = [el('p', 'taskstate', `${word} · ${ago(o.created_at)}`)];
  const said = outcome(o);
  if (said) children.push(el('p', 'taskout', said));
  children.push(log);
  if (OPEN.has(o.state)) {
    const stop = el('button', 'btn danger', 'Cancel task');
    stop.type = 'button';
    stop.addEventListener('click', async () => {
      stop.disabled = true;
      try {
        await signedIn((t) => api.call(`/v1/work/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', token: t, body: { why: 'The owner cancelled it in the menu.' } }));
        void modal.close();
        toast('Cancelled. Muse won’t do it.');
        await refresh();
        redraw();
      } catch (e) {
        stop.disabled = false;
        toast(lineFor(failure(e)));
      }
    });
    children.push(stop);
  }
  const modal = sheet({ title: o.title, children, cancel: 'Close' });
  modal.element.classList.add('tasksheet');
  try {
    /** @type {{ items: MuseNote[] }} */
    const page = await signedIn((t) => api.call(`/v1/work/thread?order=${encodeURIComponent(id)}`, { token: t }));
    const clock = (/** @type {number} */ at) => new Date(at).toTimeString().slice(0, 5);
    log.replaceChildren(...(page.items.length ? page.items.map((n) => el('p', '', `${clock(n.created_at)} · ${n.body}`)) : [el('p', '', o.kind === 'muse.upload_batch' ? 'Uploads say nothing on the way.' : 'No word from Muse yet.')]));
  } catch (e) {
    log.replaceChildren(el('p', '', navigator.onLine ? lineFor(failure(e)) : "You're offline. Muse's lines show once you're back."));
  }
}
