// @ts-check
// Study's data (STUDY.md §1, §2): the library routes through the shared client, a book's signed
// link (in memory only, never in the address bar, a link, a log or a sense; re-signed on a 403 or
// once it is near its end), and what this phone keeps in IndexedDB `th-study` (covers, the last
// place per book, an upload's progress). Signing out drops `th-study` with the rest (th/session.js).
import { api, signedIn } from '/th/client.js';
import { kv } from '/th/idb.js';

/** @typedef {import('../../../shared/contract/library.ts').Book} Book */
/** @typedef {import('../../../shared/contract/library.ts').BookCreateRequest} BookCreateRequest */
/** @typedef {import('../../../shared/contract/library.ts').BookCreateResponse} BookCreateResponse */
/** @typedef {import('../../../shared/contract/library.ts').Position} Position */
/** @typedef {import('../../../shared/contract/library.ts').LibrarySearchResponse} LibrarySearchResponse */
/** @typedef {import('../../../shared/contract/music.ts').MediaSignResponse} MediaSignResponse */

export const local = kv('th-study');
const id = encodeURIComponent;

/** @returns {Promise<Book[]>} */
export const books = async () => (await signedIn((t) => api.call('/v1/library/books', { token: t }))).items;
/** @param {string} bookId @returns {Promise<Book>} */
export const book = async (bookId) => (await signedIn((t) => api.call(`/v1/library/books/${id(bookId)}`, { token: t }))).book;
/** @param {BookCreateRequest} body @returns {Promise<BookCreateResponse>} */
export const create = (body) => signedIn((t) => api.call('/v1/library/books', { method: 'POST', token: t, body }));
/** @param {string} bookId @returns {Promise<Book>} */
export const complete = async (bookId) =>
  (await signedIn((t) => api.call(`/v1/library/books/${id(bookId)}/complete`, { method: 'POST', token: t }))).book;
/** @param {string} bookId @returns {Promise<Book>} */
export const retry = async (bookId) =>
  (await signedIn((t) => api.call(`/v1/library/books/${id(bookId)}/retry`, { method: 'POST', token: t }))).book;
/** @param {string} bookId @param {{ title?: string, author?: string | null }} body @returns {Promise<Book>} */
export const edit = async (bookId, body) =>
  (await signedIn((t) => api.call(`/v1/library/books/${id(bookId)}`, { method: 'PATCH', token: t, body }))).book;
/** @param {string} q @param {string | null} bookId @param {string | null} cursor @returns {Promise<LibrarySearchResponse>} */
export const search = (q, bookId, cursor) => {
  const p = new URLSearchParams({ q, limit: '50' });
  if (bookId) p.set('book_id', bookId);
  if (cursor) p.set('cursor', cursor);
  return signedIn((t) => api.call(`/v1/library/search?${p}`, { token: t }));
};

/** The newest place wins on the server; `keepalive` lets it leave as the page goes away.
 * @param {string} bookId @param {{ pdf_page: number, scroll_frac: number, at: number }} body @param {boolean} [keepalive]
 * @returns {Promise<Position>} */
export const putPosition = async (bookId, body, keepalive = false) =>
  (await signedIn((t) => api.call(`/v1/library/positions/${id(bookId)}`, { method: 'PUT', token: t, body, keepalive }))).position;

/** @type {Map<string, { url: string, until: number }>} */
const signed = new Map();

/** A book's signed link, kept in memory until 10 minutes before it ends; `fresh` signs again.
 * @param {string} bookId @param {boolean} [fresh] @returns {Promise<string>} */
export async function signedUrl(bookId, fresh = false) {
  const had = signed.get(bookId);
  if (had && !fresh && had.until - Date.now() > 10 * 60_000) return had.url;
  /** @type {MediaSignResponse} */
  const r = await signedIn((t) => api.call('/v1/media/sign', { method: 'POST', token: t, body: { refs: [`book:${bookId}`] } }));
  const item = r.items[0];
  if (!item) throw Object.assign(new Error('not signable'), { code: r.errors[0]?.code ?? 'not_found' });
  signed.set(bookId, { url: item.url, until: item.expires_at });
  return item.url;
}

/** This phone's last place in a book (saved 2 s after the page settles). @param {string} bookId
 * @returns {Promise<{ pdf_page: number, scroll_frac: number, at: number } | undefined>} */
export const localPlace = (bookId) => local.get(`place:${bookId}`);
/** @param {string} bookId @param {{ pdf_page: number, scroll_frac: number, at: number }} p */
export const saveLocalPlace = (bookId, p) => local.set(`place:${bookId}`, p);
/** A cover drawn from the first page (a data URL). @param {string} bookId @returns {Promise<string | undefined>} */
export const cover = (bookId) => local.get(`cover:${bookId}`);
/** @param {string} bookId @param {string} dataUrl */
export const saveCover = (bookId, dataUrl) => local.set(`cover:${bookId}`, dataUrl);
