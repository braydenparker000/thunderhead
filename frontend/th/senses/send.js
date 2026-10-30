// @ts-check
// What the owner does, as events for the Senses object (API.md §11.14; P9, EVALS.md M-16 and M-18):
// `<app>.open` when an app's page opens, `briefing.tile` when a night tile is tapped (its ref the
// tile's ledger row). Only signed in and in a top-level page; kept on this phone (at most 200)
// until the Worker takes them. A few seconds after the last one, or when the page hides, the waiting
// events are sealed into one batch, which is sent again with the same bytes until it is taken (API.md
// §11.14); one tab sends at a time. Names and times only: nothing the owner typed or saved.
import { CONFIG } from '/config.js';
import { sessionToken } from '/th/ported/session.js';

const KEY = 'th.p.senses';
/** The sealed batch on its way: `{ id, body, tries }`. */
const BATCH = 'th.p.senses.batch';
const MAX = 200;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
/** @type {Promise<void> | null} */
let sending = null;

/** @typedef {{ id: string, at: number, type: string, ref?: string }} Sense */

/** UUIDv7 (RFC 9562): the Senses object takes no other id. */
function uuidv7(now = Date.now()) {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** @returns {Sense[]} */
function waiting() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** @param {Sense[]} q */
function keep(q) {
  try {
    if (q.length) localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX)));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** One event, sent soon. @param {string} type e.g. `guitar.open` @param {string | null} [ref] */
export async function sense(type, ref = null) {
  if (window.top !== window.self || !(await sessionToken())) return;
  const now = Date.now();
  keep([...waiting(), { id: uuidv7(now), at: now, type, ...(ref ? { ref } : {}) }]);
  clearTimeout(timer);
  timer = setTimeout(flush, 3000);
}

/** Sends what waits, one batch at a time. */
export function flush() {
  // One tab at a time (the Web Locks API), so two never seal the same events.
  /** @returns {Promise<void>} */
  const run = async () => {
    if (navigator.locks) await navigator.locks.request('th.senses', send);
    else await send();
  };
  sending ??= run().finally(() => {
    sending = null;
  });
  return sending;
}

/** @returns {{ id: string, body: string, tries: number } | null} */
function sealed() {
  try {
    return JSON.parse(localStorage.getItem(BATCH) || 'null');
  } catch {
    return null;
  }
}
/** @param {{ id: string, body: string, tries: number } | null} b */
function seal(b) {
  try {
    if (b) localStorage.setItem(BATCH, JSON.stringify(b));
    else localStorage.removeItem(BATCH);
  } catch {}
}

async function send() {
  if (!navigator.onLine || !CONFIG.api) return;
  const token = await sessionToken();
  if (!token) return;
  for (let round = 0; round < 3; round++) {
    let batch = sealed();
    if (!batch) {
      const events = waiting();
      if (!events.length) return;
      batch = { id: uuidv7(), body: JSON.stringify({ events }), tries: 0 };
      seal(batch);
      keep([]);
    }
    /** @type {Response | null} */
    let r = null;
    try {
      r = await fetch(`${CONFIG.api}/v1/senses/batches/${batch.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: batch.body,
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
      });
    } catch {}
    // Taken, or refused in a way no retry fixes (a malformed batch, or the Worker failing it five
    // times): it leaves the phone. Offline or signed out: it waits as it is.
    const done = r && (r.ok || r.status === 409 || r.status === 422 || (r.status >= 500 && batch.tries >= 4));
    if (!done) {
      if (r && r.status >= 500) seal({ ...batch, tries: batch.tries + 1 });
      return;
    }
    seal(null);
  }
}

addEventListener('pagehide', () => void flush());
addEventListener('online', () => void flush());
if (waiting().length || sealed()) setTimeout(flush, 3000);
