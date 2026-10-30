// @ts-check
// Study's data (STUDY.md §1, §2): the library routes through the shared client, and what this
// phone keeps in IndexedDB `th-study` (covers, the last place per book, an upload's progress, the
// scripture table); the books themselves are kept in OPFS (copies.js). Signing out drops `th-study` with the rest (th/session.js).
import { api, signedIn } from '/th/client.js';
import { kv } from '/th/idb.js';
import { CONFIG } from '/config.js';
import { ApiError } from '/th/api.js';

/** @typedef {import('../../../shared/contract/library.ts').Book} Book */
/** @typedef {import('../../../shared/contract/library.ts').BookCreateRequest} BookCreateRequest */
/** @typedef {import('../../../shared/contract/library.ts').BookCreateResponse} BookCreateResponse */
/** @typedef {import('../../../shared/contract/library.ts').Position} Position */
/** @typedef {import('../../../shared/contract/library.ts').LibrarySearchResponse} LibrarySearchResponse */

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

/** This phone's last place in a book (saved 2 s after the page settles). @param {string} bookId
 * @returns {Promise<{ pdf_page: number, scroll_frac: number, at: number } | undefined>} */
export const localPlace = (bookId) => local.get(`place:${bookId}`);
/** @param {string} bookId @param {{ pdf_page: number, scroll_frac: number, at: number }} p */
export const saveLocalPlace = (bookId, p) => local.set(`place:${bookId}`, p);
/** A cover drawn from the first page (a data URL). @param {string} bookId @returns {Promise<string | undefined>} */
export const cover = (bookId) => local.get(`cover:${bookId}`);
/** @param {string} bookId @param {string} dataUrl */
export const saveCover = (bookId, dataUrl) => local.set(`cover:${bookId}`, dataUrl);

/** @typedef {import('./scripture/parse.js').ScriptureTable} ScriptureTable */
/** @typedef {import('../../../shared/contract/library.ts').VerseResponse} VerseResponse */
/** @typedef {import('../../../shared/contract/library.ts').VerseTextResponse} VerseTextResponse */

/** This visit's copy of the table, so an unchanged one is the same object. @type {{ etag: string, table: ScriptureTable } | undefined} */
let kept;

/** The owner's private scripture table: this phone's copy (offline too), checked by its ETag; null
 * before the mind has stored one. @returns {Promise<ScriptureTable | null>} */
export async function scripture() {
  /** @type {{ etag: string, table: ScriptureTable } | undefined} */
  const had = kept ?? (await local.get('scripture').catch(() => undefined));
  try {
    // Fetched here, not through api.call, for its ETag and 304; a refused sign-in still signs out.
    const res = await signedIn(async (token) => {
      const r = await fetch(`${CONFIG.api.replace(/\/+$/, '')}/v1/library/scripture`, {
        headers: { Authorization: `Bearer ${token}`, ...(had ? { 'If-None-Match': had.etag } : {}) },
        credentials: 'omit',
        cache: 'no-store',
      });
      if (r.status === 401) throw new ApiError(401, (await r.json().catch(() => null))?.error ?? { code: 'unauthorized', message: 'HTTP 401', request_id: '' });
      return r;
    });
    if (res.status === 304 && had) return (kept = had).table;
    if (res.status === 404) {
      kept = undefined;
      await local.del('scripture').catch(() => {});
      return null;
    }
    if (!res.ok) return had?.table ?? null;
    const table = /** @type {ScriptureTable} */ (await res.json());
    kept = { etag: res.headers.get('ETag') ?? '', table };
    await local.set('scripture', kept).catch(() => {});
    return table;
  } catch {
    return had?.table ?? null;
  }
}

/** "Cited in your books" and the owner's highlights on a verse. @param {string} code @param {number} ch
 * @param {number | null} v1 @param {number | null} v2 @param {boolean} all @returns {Promise<VerseResponse>} */
export const verse = (code, ch, v1, v2, all) =>
  signedIn((t) =>
    api.call(`/v1/library/verses/${id(code)}/${ch}${v1 ? `?v=${v1}${v2 && v2 !== v1 ? `-${v2}` : ''}${all ? '&all=1' : ''}` : all ? '?all=1' : ''}`, { token: t }),
  );

/** A chapter of the owner's own copy, or null when it isn't there. @param {string} code @param {number} ch
 * @returns {Promise<Record<string, string> | null>} */
export async function verseText(code, ch) {
  try {
    /** @type {VerseTextResponse} */
    const r = await signedIn((t) => api.call(`/v1/library/scripture/text/${id(code)}/${ch}`, { token: t }));
    return r.verses;
  } catch {
    return null;
  }
}
