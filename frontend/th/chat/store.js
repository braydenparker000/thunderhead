// @ts-check
// What the phone keeps of the conversation, in IndexedDB `th-data` (PRIVACY.md §4, wiped on
// sign-out): the last state, so home paints at once from cache, and the outbox of messages not
// sent yet. One tab writes at a time; the outbox is small (≤ 200 messages, HOME.md §4.7).
import { kv } from '../idb.js';

/** @typedef {import('./model.js').Local} Local */
/** @typedef {{ today: import('../../../shared/contract/api.ts').TodayResponse | null, presence: import('../../../shared/contract/api.ts').MindPresence | null,
 *   surfaces: import('../../../shared/contract/api.ts').Surface[], seq: number, at: number }} Cached */

const db = kv('th-data');
export const OUTBOX_MAX = 200;

export const cache = {
  /** @returns {Promise<Cached | null>} */
  read: async () => (await db.get('chat.cache').catch(() => null)) ?? null,
  /** @param {Cached} v */
  write: (v) => db.set('chat.cache', v).catch(() => {}),
};

export const outbox = {
  /** @returns {Promise<Local[]>} */
  list: async () => (await db.get('chat.outbox').catch(() => null)) ?? [],
  /** @param {Local} m */
  async put(m) {
    const all = await outbox.list();
    const i = all.findIndex((x) => x.id === m.id);
    if (i >= 0) all[i] = m;
    else all.push(m);
    await db.set('chat.outbox', all);
  },
  /** @param {string} id */
  async remove(id) {
    await db.set('chat.outbox', (await outbox.list()).filter((x) => x.id !== id));
  },
};
