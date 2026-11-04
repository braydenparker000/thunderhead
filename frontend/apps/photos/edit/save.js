// @ts-check
// The recipe saved as you move (PHOTOS.md, the editor; PUT /v1/photos/:id/recipe): half a second
// after the last change, the newest recipe goes to the Worker; until it is there it is kept on this
// phone, so a reload, a dropped connection or a night offline loses nothing, and it is sent when the
// phone is back online. The Worker writes nothing for a recipe it already has.
import { api, signedIn } from '/th/client.js';
import { store } from '../data.js';

const DEBOUNCE_MS = 500;
/** @typedef {import('./fields.js').Recipe} Recipe */

/** The photo's recipe: one not yet sent from this phone, else the Worker's (kept for offline), else as shot.
 * @param {string} id @returns {Promise<Recipe>} */
export async function loadRecipe(id) {
  const pending = await store.get(`recipe-pending:${id}`).catch(() => null);
  if (pending) return pending;
  try {
    const r = await signedIn((token) => api.call(`/v1/photos/${id}`, { token }));
    store.set(`recipe:${id}`, r.recipe ?? {}).catch(() => {});
    return r.recipe ?? {};
  } catch {
    return (await store.get(`recipe:${id}`).catch(() => null)) ?? {};
  }
}

/** @param {string} id @param {(state: 'saving' | 'saved' | 'offline' | 'failed') => void} onState */
export function saver(id, onState) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Recipe | null} */
  let pending = null;
  let sending = false;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };
  async function flush() {
    timer = null;
    if (!pending || sending) return;
    const recipe = pending;
    sending = true;
    try {
      await signedIn((token) => api.call(`/v1/photos/${id}/recipe`, { method: 'PUT', body: { recipe }, token }));
      store.set(`recipe:${id}`, recipe).catch(() => {});
      if (pending === recipe) {
        pending = null;
        await store.del(`recipe-pending:${id}`).catch(() => {});
        onState('saved');
      }
    } catch {
      onState(navigator.onLine === false ? 'offline' : 'failed');
      addEventListener('online', () => flush(), { once: true });
    } finally {
      sending = false;
      if (pending && pending !== recipe) schedule();
    }
  }
  return {
    /** @param {Recipe} recipe */
    put(recipe) {
      pending = recipe;
      store.set(`recipe-pending:${id}`, recipe).catch(() => {});
      onState('saving');
      schedule();
    },
    flush,
  };
}
