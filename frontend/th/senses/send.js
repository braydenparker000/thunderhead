// @ts-check
// What the owner does, as events for the Senses object (API.md §11.14; the list and each type's
// fields: shared/contract/senses.ts SENSE_TYPES): `<app>.open` when an app's page opens, Music's
// plays, skips and ratings, Podcasts' episodes and follows (th/podcasts/progress.js), Guitar's
// practice (th/guitar/practice.js), Study's reading, Astra's and My Media's watching
// (th/senses/watch.js), the shell's and home's (th/senses/shell.js). Only signed in, and in a
// top-level page or one of home's own frames; never for an app whose senses the owner switched off
// (Settings › Privacy, `privacy.senses.<app>`, as this phone last saw it: `th.p.settings`, which
// Settings keeps; the Worker checks again). Kept on this phone (at most 200) until the Worker takes
// them. A few seconds after the last one, or when the page hides, the waiting events are sealed into
// one batch, which is sent again with the same bytes until it is taken (API.md §11.14); one tab sends
// at a time. Ids, numbers and times only: nothing the owner typed or saved.
import { CONFIG } from '/config.js';
import { framedByOther, sessionToken } from '/th/ported/session.js';
// Every ported page loads this module (assets/error-report.js): in home's layer, a page that loaded
// again by itself claims its frame's trust back from its worker (th/ported/claim.js).
import '/th/ported/claim.js';

// Astra's and My Media's pages: what is watched, from each app's own progress (th/senses/watch.js).
if (/^\/(astra|media)\//.test(location.pathname)) import('./watch.js').then((m) => m.startWatching()).catch(() => {});

/** The types whose app is not their first part (SENSE_TYPES `app`; tests/senses-logic.test.mjs
 * checks every type of the contract against appOf). Kept here, not in th/contract.js, which counts
 * against the shell's size budget. */
const APPS = /** @type {Record<string, string>} */ ({
  player: 'music',
  podcast: 'podcasts',
  astra: 'media',
  mymedia: 'media',
  app: 'shell',
  ring: 'shell',
  island: 'shell',
  settings: 'shell',
  'briefing.open': 'shell',
  line: 'home',
  card: 'home',
  reply: 'home',
  briefing: 'home',
});
/** Whose privacy switch a type falls under. @param {string} type */
export function appOf(type) {
  const head = type.split('.')[0];
  return APPS[type.split('.').slice(0, 2).join('.')] ?? APPS[head] ?? head;
}
/** Whether the owner left a type's app on (on by default), as this phone last saw their settings.
 * @param {string} type */
export function allowed(type) {
  try {
    const s = JSON.parse(localStorage.getItem('th.p.settings') || 'null');
    return !s || s[`privacy.senses.${appOf(type)}`] !== false;
  } catch {
    return true;
  }
}

const KEY = 'th.p.senses';
/** The sealed batch on its way: `{ id, body, tries }`. */
const BATCH = 'th.p.senses.batch';
const MAX = 200;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
/** @type {Promise<void> | null} */
let sending = null;

/** @typedef {{ id: string, at: number, type: string, ref?: string, data?: Record<string, unknown> }} Sense */

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

/** One event, sent soon; whether it was kept to send (not when its app is switched off, signed out,
 * or in another's frame).
 * @param {string} type one of SENSE_TYPES, e.g. `guitar.open` @param {string | null} [ref]
 * @param {Record<string, unknown> | null} [data] its fields only: ids, numbers, times (≤ 2 KB)
 * @returns {Promise<boolean>} */
export async function sense(type, ref = null, data = null) {
  if (!allowed(type) || framedByOther() || !(await sessionToken())) return false;
  const now = Date.now();
  keep([...waiting(), { id: uuidv7(now), at: now, type, ...(ref ? { ref } : {}), ...(data ? { data } : {}) }]);
  clearTimeout(timer);
  timer = setTimeout(flush, 3000);
  return true;
}

/** How many more events the outbox keeps before it drops its oldest. */
export const room = () => MAX - waiting().length;
/** Whether nothing waits on this phone: every event kept was taken (or refused for good). */
export const drained = () => !waiting().length && !sealed();

const LOST = 'th.senses.lost';
/** How many batches this phone has let go without the Worker taking them (refused for good): a
 * caller that must know its events arrived compares it before and after (th/music/ratings.js). */
export function lost() {
  try {
    return Number(localStorage.getItem(LOST)) || 0;
  } catch {
    return 0;
  }
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
      // An app switched off since its events were kept: they never leave the phone.
      const events = waiting().filter((e) => allowed(e.type));
      if (!events.length) return keep([]);
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
    if (!r || !done) {
      if (r && r.status >= 500) seal({ ...batch, tries: batch.tries + 1 });
      return;
    }
    // Refused for good (409 is a batch already taken): counted, so a caller learns it was lost.
    if (!r.ok && r.status !== 409)
      try {
        localStorage.setItem(LOST, String(lost() + 1));
      } catch {}
    seal(null);
  }
}

addEventListener('pagehide', () => void flush());
addEventListener('online', () => void flush());
if (waiting().length || sealed()) setTimeout(flush, 3000);
