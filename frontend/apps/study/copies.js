// @ts-check
// Books kept on this phone (STUDY.md §2.3). A book not kept yet opens from byte ranges asked of the
// Worker (with the owner's session), so page 1 shows as soon as its ranges are in; meanwhile the
// whole file comes in the background, 8 MiB a range, each range kept as its own file in this site's
// private files (OPFS `study/<id>.parts/`), then joined into `study/<id>.pdf`. A dropped download
// goes on from the ranges it has. Every open after that reads the phone's copy, with no network. A
// copy whose size isn't the book's is no copy. The phone that added a book keeps the file it picked.
// Without OPFS the book is read by ranges and not kept. Signing out removes the folder with the rest
// (th/session.js).
import { CONFIG } from '/config.js';
import { ApiError } from '/th/api.js';
import { signedIn } from '/th/client.js';
import { holdAwake } from './wake.js';

export const DIR = 'study';
/** The background download's range, and a kept piece's size. */
export const CHUNK = 8 * 1024 * 1024;
const FIRST = 262_144;
const WAITS = [1_000, 3_000];
const fileName = (/** @type {string} */ id) => `${id}.pdf`;
const partsName = (/** @type {string} */ id) => `${id}.parts`;
const opfs = () => typeof navigator.storage?.getDirectory === 'function';
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Why a book couldn't be opened or kept: `space` (the phone is full), `gone` (not in the library) or `offline`. */
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

/** Bytes [begin, end) of a book from the Worker, by a Range request. @param {string} id @param {number} begin @param {number} end */
async function fetchRange(id, begin, end) {
  /** @type {Response} */
  let r;
  try {
    r = await signedIn(async (token) => {
      const res = await fetch(`${CONFIG.api.replace(/\/+$/, '')}/v1/library/books/${encodeURIComponent(id)}/file`, {
        headers: { Authorization: `Bearer ${token}`, Range: `bytes=${begin}-${end - 1}` },
        credentials: 'omit',
        cache: 'no-store',
      });
      if (res.status === 401) throw new ApiError(401, (await res.json().catch(() => null))?.error ?? { code: 'unauthorized', message: 'HTTP 401', request_id: '' });
      return res;
    });
  } catch {
    throw new KeepError('offline');
  }
  if (r.status === 404) throw new KeepError('gone');
  if (r.status !== 206 && r.status !== 200) throw new KeepError('offline');
  const all = new Uint8Array(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
  // A server that ignored the range sent the whole file.
  const got = r.status === 200 ? all.subarray(begin, end) : all;
  if (got.length !== end - begin) throw new KeepError('offline');
  return got;
}

/** fetchRange, tried again after 1 s and 3 s unless the book is gone. @param {string} id @param {number} begin @param {number} end */
async function fetchRetry(id, begin, end) {
  for (let i = 0; ; i++) {
    try {
      return await fetchRange(id, begin, end);
    } catch (e) {
      if (i >= WAITS.length || /** @type {KeepError} */ (e).why === 'gone') throw e;
      await sleep(WAITS[i]);
    }
  }
}

/** The pieces of a book already kept, by number. @param {{ id: string, bytes: number }} book @returns {Promise<Map<number, File>>} */
async function pieces(book) {
  /** @type {Map<number, File>} */
  const out = new Map();
  try {
    const dir = await (await folder(false)).getDirectoryHandle(partsName(book.id));
    for await (const [name, h] of /** @type {any} */ (dir).entries()) {
      const i = Number(name);
      const f = await h.getFile();
      if (Number.isInteger(i) && f.size === Math.min(CHUNK, book.bytes - i * CHUNK)) out.set(i, f);
    }
  } catch {}
  return out;
}

/** Bytes [begin, end): from the pieces kept, else from the Worker. @param {{ id: string, bytes: number }} book @param {number} begin @param {number} end */
async function bytesAt(book, begin, end) {
  const have = opfs() ? await pieces(book) : new Map();
  const first = Math.floor(begin / CHUNK);
  const last = Math.floor((end - 1) / CHUNK);
  const parts = [];
  for (let i = first; i <= last; i++) {
    const f = have.get(i);
    if (!f) return fetchRetry(book.id, begin, end);
    parts.push(f.slice(Math.max(0, begin - i * CHUNK), Math.min(CHUNK, end - i * CHUNK)));
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

/**
 * pdf.js reading a book not kept yet, in ranges; its first 256 KB are fetched here, so a book that
 * can't be reached fails at once (KeepError). `failed` hears a later range that couldn't come.
 * @param {any} lib @param {{ id: string, bytes: number }} book @param {() => void} failed
 */
export async function ranges(lib, book, failed) {
  const head = await bytesAt(book, 0, Math.min(book.bytes, FIRST));
  class FromLibrary extends lib.PDFDataRangeTransport {
    constructor() {
      super(book.bytes, head);
    }

    /** @param {number} begin @param {number} end */
    requestDataRange(begin, end) {
      bytesAt(book, begin, end).then((b) => this.onDataRange(begin, b), failed);
    }
  }
  return new FromLibrary();
}

/** Downloads running in this visit, by book. @type {Map<string, Promise<File | null>>} */
const running = new Map();
/** What each running download has, 0–1. @type {Map<string, number>} */
export const kept01 = new Map();

/**
 * Keeps a book on this phone in the background, going on from the pieces it has; the screen stays on
 * meanwhile. Resolves with the copy, or null without OPFS; rejects with a KeepError.
 * @param {{ id: string, bytes: number }} book @param {(done: number) => void} [progress]
 */
export function keep(book, progress = () => {}) {
  const had = running.get(book.id);
  if (had) return had;
  const run = (async () => {
    if (!opfs()) return null;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est?.quota && est.quota - (est.usage ?? 0) < 2 * book.bytes) throw new KeepError('space');
    const dir = await folder(true);
    const parts = await dir.getDirectoryHandle(partsName(book.id), { create: true });
    const have = await pieces(book);
    const n = Math.ceil(book.bytes / CHUNK);
    const size = (/** @type {number} */ i) => Math.min(CHUNK, book.bytes - i * CHUNK);
    let got = [...have.keys()].reduce((s, i) => s + size(i), 0);
    const tell = () => {
      kept01.set(book.id, got / book.bytes);
      progress(got / book.bytes);
    };
    tell();
    const awake = holdAwake();
    try {
      for (let i = 0; i < n; i++) {
        if (have.has(i)) continue;
        const bytes = await fetchRetry(book.id, i * CHUNK, i * CHUNK + size(i));
        const out = await (await parts.getFileHandle(String(i), { create: true })).createWritable();
        await out.write(bytes);
        await out.close();
        got += bytes.length;
        tell();
      }
      // Joined into the copy, then the pieces go.
      const handle = await dir.getFileHandle(fileName(book.id), { create: true });
      const out = await handle.createWritable();
      try {
        for (let i = 0; i < n; i++) await out.write(await (await parts.getFileHandle(String(i))).getFile());
        await out.close();
      } catch {
        await out.abort().catch(() => {});
        throw new KeepError('space');
      }
      await dir.removeEntry(partsName(book.id), { recursive: true }).catch(() => {});
      navigator.storage.persist?.().catch(() => {});
      return handle.getFile();
    } finally {
      awake();
      running.delete(book.id);
      kept01.delete(book.id);
    }
  })();
  running.set(book.id, run);
  return run;
}

/** The phone that added a book keeps the file it picked, so it never downloads it.
 * @param {string} id @param {Blob} file */
export async function keepFile(id, file) {
  if (!opfs()) return;
  try {
    const handle = await (await folder(true)).getFileHandle(fileName(id), { create: true });
    const out = await handle.createWritable();
    await out.write(file);
    await out.close();
    navigator.storage.persist?.().catch(() => {});
  } catch {}
}

/** Removes this phone's copy and any pieces of one (the book stays in the library). @param {string} id */
export async function remove(id) {
  const dir = await folder(false).catch(() => null);
  await dir?.removeEntry(fileName(id)).catch(() => {});
  await dir?.removeEntry(partsName(id), { recursive: true }).catch(() => {});
}
