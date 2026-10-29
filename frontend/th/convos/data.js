// @ts-check
// What the menu's conversations and search read (API.md §11.7): the thread list, newest
// `updated_at` first in pages, kept in one store so the menu, the full list and search share it;
// one thread's messages for the past view; and the Worker's search. The first pages are kept in
// IndexedDB `th-data` (wiped on sign-out, MENU-AND-SETTINGS.md rule 7), so the menu has something
// to show offline. Today's day and thread come from home's conversation (th/chat), which already
// has them, else from the Worker.
import { api, signedIn } from '../client.js';
import { current } from '../chat/index.js';
import { kv } from '../idb.js';
import { PAGE, daysBetween } from './model.js';

/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('../../../shared/contract/api.ts').Message} Message */
/** @typedef {import('../../../shared/contract/api.ts').SearchHit} SearchHit */
/** @typedef {import('../../../shared/contract/api.ts').TodayResponse} TodayResponse */

const db = kv('th-data');
const KEY = 'convos.list';
/** Pages read for the menu's own groups at most (this week is nearly always the first). */
const MENU_PAGES = 4;
/** Messages per read of a past thread. */
export const MESSAGES = 200;

/** @template T @param {string} path @returns {Promise<T>} */
const get = (path) => signedIn((t) => api.call(path, { token: t }));

export const list = {
  /** @type {Map<string, Thread>} */
  threads: new Map(),
  /** @type {string | null} */
  cursor: null,
  done: false,
  /** When the list was last read from the Worker (0: never, or only from the cache). */
  at: 0,
};

/** Today's day and thread id: home's conversation has them; before it has loaded, the Worker. */
export async function today() {
  /** @type {TodayResponse} */
  const t = current.today ?? (await get('/v1/threads/today'));
  current.today ??= t;
  return { day: t.day, id: t.thread?.id ?? null, at: t.thread?.updated_at ?? null, messages: t.messages };
}

/** @param {string | null} cursor @returns {Promise<{ items: Thread[], next: string | null }>} */
const page = (cursor) => get(`/v1/threads?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

/** @param {Thread[]} items */
const keep = (items) => {
  for (const t of items) list.threads.set(t.id, t);
};

/** The list from this phone, if any (offline, or before the Worker answers). */
export async function fromCache() {
  if (list.threads.size) return true;
  /** @type {{ threads: Thread[], cursor: string | null, done: boolean } | null} */
  const c = await db.get(KEY).catch(() => null);
  if (!c?.threads) return false;
  keep(c.threads);
  Object.assign(list, { cursor: c.cursor, done: c.done });
  return true;
}

/** Reads the list again from the start: pages until this week is all there (threads are listed by
 * their last message, so once a page ends before this week began, every thread of it is in). */
export async function refresh() {
  const { day } = await today();
  /** @type {Map<string, Thread>} */
  const fresh = new Map();
  let cursor = null;
  let done = false;
  for (let i = 0; i < MENU_PAGES; i++) {
    const p = await page(cursor);
    for (const t of p.items) fresh.set(t.id, t);
    cursor = p.next;
    done = !p.next;
    const last = p.items.at(-1);
    if (done || !last || Date.now() - last.updated_at > 8 * 86_400_000) break;
  }
  list.threads = fresh;
  Object.assign(list, { cursor, done, at: Date.now() });
  db.set(KEY, { threads: [...fresh.values()], cursor, done }).catch(() => {});
  return day;
}

/** The next older threads for the full list: pages until `want` more older than this week, or the
 * end. @param {string} day today @param {number} [want] */
export async function more(day, want = PAGE) {
  let got = 0;
  while (!list.done && got < want) {
    const p = await page(list.cursor);
    got += p.items.filter((t) => !list.threads.has(t.id) && daysBetween(t.day, day) > 6).length;
    keep(p.items);
    list.cursor = p.next;
    list.done = !p.next;
  }
}

/** One thread, from the list or the Worker. @param {string} id @returns {Promise<Thread>} */
export async function thread(id) {
  /** @type {Thread} */
  const t = list.threads.get(id) ?? (await get(`/v1/threads/${encodeURIComponent(id)}`));
  list.threads.set(id, t);
  return t;
}

/** A thread's messages before `before` (the newest when null), oldest first, and the seq to read
 * further back from. @param {string} id @param {number | null} before */
export async function messages(id, before) {
  /** @type {{ items: Message[], next: string | null }} */
  const p = await get(`/v1/threads/${encodeURIComponent(id)}/messages?limit=${MESSAGES}${before ? `&before_seq=${before}` : ''}`);
  return { items: [...p.items].sort((a, b) => a.seq - b.seq), before: p.next ? Number(p.next) : null };
}

/** The Worker's search over every built source. @param {string} q @returns {Promise<SearchHit[]>} */
export async function search(q) {
  /** @type {{ items: SearchHit[] }} */
  const r = await get(`/v1/search?q=${encodeURIComponent(q)}&limit=50`);
  return r.items;
}

/** One fact, for where it came from ("You said"). @param {string} id */
export async function fact(id) {
  /** @type {import('../../../shared/contract/api.ts').FactDetail} */
  const d = await get(`/v1/memory/facts/${encodeURIComponent(id)}`);
  return d.fact;
}
