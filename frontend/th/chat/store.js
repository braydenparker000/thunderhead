// @ts-check
// What the phone keeps of the conversation, in IndexedDB `th-data` (PRIVACY.md §4, wiped on
// sign-out): the last state, so home paints at once from cache, and the outbox of messages not
// sent yet, one key per message (`chat.outbox.<id>`; ids are UUIDv7, so key order is the order
// they were written), so two quick writes never overwrite each other. ≤ 200 (HOME.md §4.7).
import { kv } from '../idb.js';

/** @typedef {import('./model.js').Local} Local */
/** @typedef {{ today: import('../../../shared/contract/api.ts').TodayResponse | null, presence: import('../../../shared/contract/api.ts').MindPresence | null,
 *   surfaces: import('../../../shared/contract/api.ts').Surface[], seq: number, at: number }} Cached */

const db = kv('th-data');
const KEY = 'chat.outbox.';
export const OUTBOX_MAX = 200;
/** Attachments waiting to send, at most (HOME.md §4.7). */
export const OUTBOX_BYTES = 20 * 1024 * 1024;

export const cache = {
  /** @returns {Promise<Cached | null>} */
  read: async () => (await db.get('chat.cache').catch(() => null)) ?? null,
  /** @param {Cached} v */
  write: (v) => db.set('chat.cache', v).catch(() => {}),
};

export const outbox = {
  /** @returns {Promise<Local[]>} */
  list: () => db.list(KEY).catch(() => []),
  /** Rejects if IndexedDB can't write; the caller keeps the message in memory. @param {Local} m */
  put: (m) => db.set(`${KEY}${m.id}`, m),
  /** @param {string} id */
  remove: (id) => db.del(`${KEY}${id}`),
};
