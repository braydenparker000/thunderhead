// @ts-check
// Books kept on this phone (STUDY.md §2.3). The first open downloads the whole PDF through the
// Worker with the owner's session and keeps it in this site's private files (OPFS `study/`);
// every open after that reads it from there, with no network. A copy whose size isn't the book's
// is no copy. Without OPFS the book is read from memory and not kept. Signing out removes the
// folder with the rest (th/session.js).
import { CONFIG } from '/config.js';
import { ApiError } from '/th/api.js';
import { signedIn } from '/th/client.js';

export const DIR = 'study';
const fileName = (/** @type {string} */ id) => `${id}.pdf`;

/** Why a book couldn't be kept: `space` (the phone is full), `gone` (not in the library) or `offline`. */
export class KeepError extends Error {
  /** @param {'space' | 'gone' | 'offline'} why */
  constructor(why) {
    super(why);
    this.why = why;
  }
}

/** @param {boolean} create */
async function folder(create) {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
}

/** This phone's copy of a book, or null. @param {{ id: string, bytes: number }} book @returns {Promise<File | null>} */
export async function kept(book) {
  try {
    const f = await (await (await folder(false)).getFileHandle(fileName(book.id))).getFile();
    return f.size === book.bytes ? f : null;
  } catch {
    return null;
  }
}

/** The whole file from the Worker, as a response. @param {string} id */
async function download(id) {
  try {
    return await signedIn(async (token) => {
      const r = await fetch(`${CONFIG.api.replace(/\/+$/, '')}/v1/library/books/${encodeURIComponent(id)}/file`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        cache: 'no-store',
      });
      if (r.status === 401) throw new ApiError(401, (await r.json().catch(() => null))?.error ?? { code: 'unauthorized', message: 'HTTP 401', request_id: '' });
      return r;
    });
  } catch {
    throw new KeepError('offline');
  }
}

/**
 * Downloads a book once and keeps it; `progress` hears 0–1 as it comes.
 * @param {{ id: string, bytes: number }} book @param {(done: number) => void} progress @returns {Promise<Blob>}
 */
export async function keep(book, progress) {
  const opfs = typeof navigator.storage?.getDirectory === 'function';
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est?.quota && est.quota - (est.usage ?? 0) < 2 * book.bytes) throw new KeepError('space');
  const res = await download(book.id);
  if (res.status === 404) throw new KeepError('gone');
  if (!res.ok || !res.body) throw new KeepError('offline');
  const reader = res.body.getReader();
  if (!opfs) {
    /** @type {BlobPart[]} */
    const parts = [];
    let got = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      parts.push(r.value);
      got += r.value.length;
      progress(Math.min(1, got / book.bytes));
    }
    if (got !== book.bytes) throw new KeepError('offline');
    return new Blob(parts, { type: 'application/pdf' });
  }
  const dir = await folder(true);
  const handle = await dir.getFileHandle(fileName(book.id), { create: true });
  const out = await handle.createWritable();
  let got = 0;
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      await out.write(r.value);
      got += r.value.length;
      progress(Math.min(1, got / book.bytes));
    }
    if (got !== book.bytes) throw new KeepError('offline');
    await out.close();
  } catch {
    await out.abort().catch(() => {});
    await dir.removeEntry(fileName(book.id)).catch(() => {});
    throw new KeepError('offline');
  }
  navigator.storage.persist?.().catch(() => {});
  return handle.getFile();
}

/** Removes this phone's copy (the book stays in the library). @param {string} id */
export async function remove(id) {
  try {
    await (await folder(false)).removeEntry(fileName(id));
  } catch {}
}
