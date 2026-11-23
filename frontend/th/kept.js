// @ts-check
// What the owner wrote and had not sent, kept through a sign-out nobody chose (SIGN-IN.md §11.3): the
// session aged out (`expired`) or the server no longer knows it (`unauthorized`). Any revocation (this
// phone or another signed it out, a password change, a recovery or reset, the device cap), an unknown
// reason and a sign-out by hand keep nothing. The outbox (`th-data` `chat.outbox.*`) and the ask bar's
// draft (`localStorage` `th.p.draft`) are copied to IndexedDB `th-kept`, under the username that wrote
// them, normalised as the Worker does (auth/passwords.ts), before the wipe deletes them. The next sign-in
// on this phone settles it: the same username gets it back (it then sends); anyone else, or a sign-in
// with no username, drops it unread; after 30 days it is dropped unread at the next page start.
import { kv } from './idb.js';

const kept = kv('th-kept');
const OUTBOX = 'chat.outbox.';
const DRAFT = 'th.p.draft';
export const KEEP_MS = 30 * 86_400_000;

/** @param {unknown} u */
const owner = (u) => (typeof u === 'string' ? u.normalize('NFKC').trim().toLowerCase() : '');

/** @typedef {{ id: string, body?: string, files?: unknown[] }} Item */
/** @typedef {{ owner: string, outbox: Item[], draft: string | null, at: number }} Kept */

/** Whether a forced sign-out for this /signin/ reason keeps the unsent work. @param {string | null | undefined} reason */
export const keepsFor = (reason) => reason === 'expired' || reason === 'unauthorized';

const read = async () => /** @type {Kept | undefined} */ (await kept.get('unsent').catch(() => undefined));

/** Copies the unsent work to `th-kept`, before the wipe. Added to what is kept for the same owner, never
 * less; when the copy with its files can't be written, the words and the draft are kept without them.
 * @param {{ username?: string } | null} session */
export async function keepUnsent(session) {
  const who = owner(session?.username);
  if (!who) return;
  /** @type {Item[]} */
  const outbox = await kv('th-data').list(OUTBOX).catch(() => []);
  let draft = null;
  try { draft = localStorage.getItem(DRAFT) || null; } catch {}
  if (!outbox.length && !draft) return;
  let old = await read();
  if (old?.owner !== who) old = undefined;
  const byId = new Map((old?.outbox ?? []).map((m) => [m.id, m]));
  for (const m of outbox) byId.set(m.id, m);
  /** @type {Kept} */
  const v = { owner: who, outbox: [...byId.values()], draft: draft || old?.draft || null, at: Date.now() };
  try {
    await kept.set('unsent', v);
  } catch {
    const words = v.outbox.flatMap(({ files, ...m }) => (m.body ? [m] : []));
    await kept.set('unsent', { ...v, outbox: words }).catch(() => {});
  }
}

/** Drops a kept record older than 30 days, unread (each page start that loads the session code). */
export async function sweep() {
  const v = await read();
  if (v && !(Date.now() - v.at <= KEEP_MS)) await kept.drop();
}

/** At a sign-in: gives it back to the same owner, then forgets it either way. @param {string | undefined} username */
export async function settle(username) {
  const v = await read();
  if (!v) return;
  await kept.drop();
  const who = owner(username);
  if (!who || v.owner !== who || !(Date.now() - v.at <= KEEP_MS)) return;
  const db = kv('th-data');
  for (const m of v.outbox ?? []) if (m && typeof m.id === 'string') await db.set(`${OUTBOX}${m.id}`, m).catch(() => {});
  try { if (v.draft && !localStorage.getItem(DRAFT)) localStorage.setItem(DRAFT, v.draft); } catch {}
}
