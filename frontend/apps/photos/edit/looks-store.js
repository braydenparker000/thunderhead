// @ts-check
// The looks on the Worker (PHOTOS.md, Looks; /v1/photos/looks), held in memory for the editor's life
// and on this phone for offline: the list once, then each save, import, rename and delete as it goes.
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';
import { store } from '../data.js';

/** Looks one PUT takes (shared/contract/photos-looks.ts LOOK_LIMITS.per_request). */
export const PER_PUT = 50;
/** @typedef {import('../../../../shared/contract/photos-looks.ts').PhotoLook} Look */
/** @typedef {Omit<Look, 'id' | 'created_at' | 'updated_at' | 'tag' | 'film' | 'credit'> & { tag?: string | null, film?: string | null, credit?: string | null }} NewLook */

const call = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ o = {}) => signedIn((token) => api.call(path, { ...o, token }));
/** @type {Look[] | null} */
let mem = null;
const keep = () => store.set('looks', mem).catch(() => {});

/** Every look, newest first (the Worker's, else this phone's copy). @param {boolean} [again] @returns {Promise<Look[]>} */
export async function looks(again = false) {
  if (mem && !again) return mem;
  try { mem = (await call('/v1/photos/looks')).items; keep(); } catch (e) { mem = (await store.get('looks').catch(() => null)) ?? null; if (!mem) throw e; }
  return /** @type {Look[]} */ (mem);
}

/** Adds looks (in PUTs of 50); returns the ones the Worker kept. @param {(NewLook & { id?: string })[]} items @returns {Promise<Look[]>} */
export async function addLooks(items) {
  /** @type {Look[]} */
  const out = [];
  for (let i = 0; i < items.length; i += PER_PUT) {
    const r = await call('/v1/photos/looks', { method: 'PUT', body: { items: items.slice(i, i + PER_PUT).map((l) => ({ ...l, id: l.id ?? uuidv7() })) } });
    out.push(...r.items);
  }
  const ids = new Set(out.map((l) => l.id));
  mem = [...out.slice().reverse(), ...(mem ?? []).filter((l) => !ids.has(l.id))];
  keep();
  return out;
}

/** @param {string} id @param {{ name?: string, recipe?: import('./fields.js').Recipe, panels?: import('../copied.js').Panel[] }} p */
export async function changeLook(id, p) {
  const { look } = await call(`/v1/photos/looks/${id}`, { method: 'PATCH', body: p });
  mem = (mem ?? []).map((l) => (l.id === id ? look : l));
  keep();
  return /** @type {Look} */ (look);
}

/** @param {string} id */
export async function dropLook(id) {
  await call(`/v1/photos/looks/${id}`, { method: 'DELETE' });
  mem = (mem ?? []).filter((l) => l.id !== id);
  keep();
}
