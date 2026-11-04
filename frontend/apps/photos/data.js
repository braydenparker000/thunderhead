// @ts-check
// Photos' calls to the Worker and what this phone keeps (PHOTOS.md §3.1): the shelf's pages, each
// photo's thumbnail and preview (IndexedDB `th-photos`, so the shelf and the full view work offline),
// and an import in progress (its Drive session, so a dropped connection or a reload resumes it).
import { CONFIG } from '/config.js';
import { api, signedIn } from '/th/client.js';
import { kv } from '/th/idb.js';

const BASE = CONFIG.api.replace(/\/+$/, '');
const CLIENT = `${CONFIG.build}.${String(CONFIG.commit).slice(0, 7)}`;
export const store = kv('th-photos');

/** @typedef {import('../../../shared/contract/photos.ts').PhotoItem} PhotoItem */
/** @typedef {import('../../../shared/contract/photos.ts').PhotoShelfResponse} Shelf */

/** @template T @param {string} path @param {{ method?: string, body?: unknown }} [o] @returns {Promise<T>} */
const call = (path, o = {}) => signedIn((token) => api.call(path, { ...o, token }));

/** The shelf from `before` (or the top). The top page is kept for the offline shelf.
 * @param {string | null} before @returns {Promise<Shelf & { offline?: boolean }>} */
export async function shelf(before = null) {
  const key = `shelf:${before ?? 'top'}`;
  try {
    /** @type {Shelf} */
    const s = await call(`/v1/photos${before ? `?before=${before}` : ''}`);
    store.set(key, s).catch(() => {});
    return s;
  } catch (e) {
    const kept = await store.get(key).catch(() => null);
    if (kept) return { ...kept, offline: true };
    throw e;
  }
}

/** One whole day. @param {string} day @returns {Promise<Shelf & { offline?: boolean }>} */
export async function day(day) {
  try {
    /** @type {Shelf} */
    const s = await call(`/v1/photos?day=${day}`);
    store.set(`day:${day}`, s).catch(() => {});
    return s;
  } catch (e) {
    const kept = await store.get(`day:${day}`).catch(() => null);
    if (kept) return { ...kept, offline: true };
    throw e;
  }
}

/** @param {string} id @returns {Promise<PhotoItem>} */
export async function photo(id) {
  try {
    const p = (await call(`/v1/photos/${id}`)).photo;
    store.set(`photo:${id}`, p).catch(() => {});
    return p;
  } catch (e) {
    const kept = await store.get(`photo:${id}`).catch(() => null);
    if (kept) return kept;
    throw e;
  }
}

/** @param {string} id @param {{ rating?: number, flag?: string | null }} body @returns {Promise<PhotoItem>} */
export const patch = async (id, body) => (await call(`/v1/photos/${id}`, { method: 'PATCH', body })).photo;
/** @param {string} id @returns {Promise<PhotoItem>} */
export const remove = async (id) => (await call(`/v1/photos/${id}`, { method: 'DELETE' })).photo;
/** @param {string} id @returns {Promise<PhotoItem>} */
export const restore = async (id) => (await call(`/v1/photos/${id}/restore`, { method: 'POST' })).photo;
/** @returns {Promise<PhotoItem[]>} */
export const deleted = async () => (await call('/v1/photos/deleted')).items;
/** @returns {Promise<{ access_token: string, expires_at: number, folder_id: string }>} */
export const uploadToken = () => call('/v1/photos/upload-token', { method: 'POST' });
/** @returns {Promise<import('../../../shared/contract/photos.ts').DriveStatus>} */
export const driveStatus = () => call('/v1/photos/drive');
/** @param {string} id @param {object} body @returns {Promise<PhotoItem>} */
export const register = async (id, body) => (await call(`/v1/photos/${id}`, { method: 'PUT', body })).photo;
/** The owner's preview size (Settings › Photos), as this phone last saw their settings. */
export function previewSide() {
  try {
    return Number(JSON.parse(localStorage.getItem('th.p.settings') || '{}')['photos.preview_size']) === 1024 ? 1024 : 2048;
  } catch {
    return 2048;
  }
}

/** @param {string} id @param {Blob} jpeg @returns {Promise<PhotoItem>} */
export const putPreview = (id, jpeg) =>
  signedIn(async (token) => {
    const res = await fetch(`${BASE}/v1/photos/${id}/preview`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'TH-Client': CLIENT, 'Content-Type': 'image/jpeg' },
      body: jpeg,
      credentials: 'omit',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error?.code ?? 'unavailable'), { status: res.status, code: data?.error?.code });
    return data.photo;
  });

/** The photo's preview: this phone's copy, else the Worker's (then kept here). @param {string} id */
export async function previewOf(id) {
  const kept = await store.get(`preview:${id}`).catch(() => null);
  if (kept) return /** @type {Blob} */ (kept);
  return signedIn(async (token) => {
    const res = await fetch(`${BASE}/v1/photos/${id}/preview`, {
      headers: { Authorization: `Bearer ${token}`, 'TH-Client': CLIENT },
      credentials: 'omit',
    });
    if (!res.ok) throw Object.assign(new Error('preview'), { status: res.status });
    const blob = await res.blob();
    store.set(`preview:${id}`, blob).catch(() => {});
    return blob;
  });
}

/** @param {string} id @returns {Promise<Blob | null>} */
export const thumbOf = (id) => store.get(`thumb:${id}`).catch(() => null);
/** @param {string} id @param {Blob} blob */
export const keepThumb = (id, blob) => store.set(`thumb:${id}`, blob).catch(() => {});
/** @param {string} id @param {Blob} blob */
export const keepPreview = (id, blob) => store.set(`preview:${id}`, blob).catch(() => {});
