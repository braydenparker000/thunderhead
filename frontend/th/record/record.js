// @ts-check
// Off the record on home (NEXT-BATCH.md part 8; HOME.md §6.2, §6.3): a conversation the mind
// answers but never remembers, gone 7 days after its last message. Started from the + sheet or by
// saying "off the record"; this phone keeps which one it is in (`th.p.otr`, wiped at sign-out with
// the rest of th.p.*), and home's conversation (th/chat) shows it in place of today's, with a quiet
// marker at its top and the bar's words saying so. End, "back on the record", or the conversation's
// own end (deleted, or its 7 days up) returns to today. The Worker enforces the rest (its
// conversation/held.ts); home never caches these messages.
import { api, signedIn } from '../client.js';
import { uuidv7 } from '../chat/model.js';
import { failure } from '../flow.js';
import { toast } from '../ui.js';

/** @typedef {import('../../../shared/contract/api.ts').TodayResponse} TodayResponse */
/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('../../../shared/contract/api.ts').Message} Message */

const KEY = 'th.p.otr';
export const MARK = 'Off the record · gone in 7 days';

/** The conversation off the record this phone is in, or null. */
export function current() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** @param {string | null} id */
function set(id) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
  document.dispatchEvent(new CustomEvent('th:otr'));
}

/** Starts one under this phone's id (a retry is the same conversation). */
export async function start() {
  if (current()) return toast('Already off the record.');
  const id = uuidv7();
  try {
    await signedIn((t) => api.call(`/v1/threads/${id}/off-record`, { method: 'PUT', token: t }));
    set(id);
    toast("Off the record. I'll answer, remember none of it, and it's gone in 7 days.");
  } catch {
    toast("Couldn't go off the record. Try again.");
  }
}

/** Back to today's conversation. `quiet`: no toast (it ended by itself). @param {boolean} [quiet] */
export function end(quiet = false) {
  if (!current()) return;
  set(null);
  if (!quiet) toast('Back on the record.');
}

/** Home's view of it: `today` with its thread and newest 50 messages in place of today's; null when
 * it is gone (deleted, or its time up), and this phone leaves it.
 * @param {string} token @param {string} id @param {TodayResponse} today @returns {Promise<TodayResponse | null>} */
export async function view(token, id, today) {
  try {
    /** @type {[Thread, { items: Message[] }]} */
    const [thread, page] = await Promise.all([
      api.call(`/v1/threads/${id}`, { token }),
      api.call(`/v1/threads/${id}/messages?limit=50`, { token }),
    ]);
    return { ...today, thread, messages: [...page.items].sort((a, b) => a.seq - b.seq) };
  } catch (e) {
    const f = failure(e);
    if (f.status !== 404 && f.status !== 410) throw e;
    end(true);
    toast('That conversation off the record is gone.');
    return null;
  }
}

/** The quiet marker at the top of the conversation, and the bar's words, while off the record.
 * @param {boolean} on */
export function mark(on) {
  const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'));
  if (q) {
    q.dataset.ph = on ? 'Off the record' : '';
    if (!q.closest('.listening, .finishing')) q.placeholder = on ? 'Off the record' : 'Ask anything';
  }
  document.querySelector('#home')?.classList.toggle('otr', on);
  let m = document.getElementById('otr');
  if (!on) return void m?.remove();
  if (m) return;
  m = document.createElement('div');
  m.id = 'otr';
  m.className = 'otrmark';
  m.setAttribute('role', 'note');
  m.innerHTML = '<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#eye-slash"/></svg>';
  m.append(MARK);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'End';
  b.setAttribute('aria-label', 'End off the record');
  b.addEventListener('click', () => end());
  m.append(b);
  document.querySelector('#talk')?.before(m);
}
