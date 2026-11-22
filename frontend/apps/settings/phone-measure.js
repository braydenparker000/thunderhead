// @ts-check
// Measures what this browser keeps for the site (MENU-AND-SETTINGS.md §6.11), row by row
// (phone-stores.js), for real: every cache entry's size (its Content-Length, else its body's), every
// IndexedDB record's (its strings, numbers, blobs and buffers, summed), every private file's, every
// localStorage key's (key and value, two bytes a character). It works in pieces (40 entries, then a
// turn of the page's loop), so the page never freezes, and never creates what it reads: only caches
// that `caches.keys()` names are opened, a database is opened without an upgrade, and folders are not made.
import { OTHER, STORES } from './phone-stores.js';

/** @typedef {import('./phone-stores.js').Store} Store */
/** @typedef {{ caches: string[], idb: string[], opfs: string[], local: boolean }} Found */

const PIECE = 40;
/** A turn of the page's loop, so taps and drawing go on between pieces. */
export const breathe = () => new Promise((r) => setTimeout(r, 0));

/** What exists on this phone; anything the browser lacks or refuses is empty. @returns {Promise<Found>} */
export async function discover() {
  const caches_ = globalThis.caches ? await caches.keys().catch(() => []) : [];
  /** @type {string[]} */
  let idb = [];
  if (globalThis.indexedDB) {
    const all = typeof indexedDB.databases === 'function' ? await indexedDB.databases().catch(() => null) : null;
    if (all) idb = all.map((d) => d.name ?? '').filter(Boolean);
    else {
      // No list: the databases the site names, each only if it is there.
      const named = [...new Set(STORES.flatMap((s) => s.units.idb ?? []))];
      for (const n of named) { const db = await openOnly(n); if (db) { idb.push(n); db.close(); } }
    }
  }
  /** @type {string[]} */
  const opfs = [];
  try {
    const root = /** @type {any} */ (await navigator.storage.getDirectory());
    for await (const name of root.keys()) opfs.push(name);
  } catch {}
  let local = false;
  try { local = localStorage.length > 0; } catch {}
  return { caches: caches_, idb, opfs, local };
}

/** Each row with the units it measures, in STORES order; what no row names goes to Other.
 * @param {Found} f @returns {{ store: Store, units: Found }[]} */
export function assign(f) {
  const taken = { caches: new Set(), idb: new Set(), opfs: new Set() };
  const rows = STORES.map((store) => {
    const u = store.units;
    const units = {
      caches: u.caches ? f.caches.filter((n) => /** @type {RegExp} */ (u.caches).test(n)) : [],
      idb: (u.idb ?? []).filter((n) => f.idb.includes(n)),
      opfs: u.opfs ? f.opfs.filter((n) => /** @type {RegExp} */ (u.opfs).test(n)) : [],
      local: Boolean(u.local && f.local),
    };
    units.caches.forEach((n) => taken.caches.add(n));
    units.idb.forEach((n) => taken.idb.add(n));
    units.opfs.forEach((n) => taken.opfs.add(n));
    return { store, units };
  });
  const other = { caches: f.caches.filter((n) => !taken.caches.has(n)), idb: f.idb.filter((n) => !taken.idb.has(n)), opfs: f.opfs.filter((n) => !taken.opfs.has(n)), local: false };
  return [...rows, { store: OTHER, units: other }].filter((r) => r.units.caches.length || r.units.idb.length || r.units.opfs.length || r.units.local);
}

/** A stored value's bytes: strings by length, blobs and buffers by size, objects by keys and values. @param {unknown} v */
export function sizeOf(v, depth = 0) {
  if (v == null) return 1;
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number' || typeof v === 'bigint' || v instanceof Date) return 8;
  if (typeof v === 'boolean') return 1;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (typeof v !== 'object' || depth > 12) return 0;
  let n = 0;
  if (v instanceof Map) for (const [k, x] of v) n += sizeOf(k, depth + 1) + sizeOf(x, depth + 1);
  else if (v instanceof Set) for (const x of v) n += sizeOf(x, depth + 1);
  else if (Array.isArray(v)) for (const x of v) n += sizeOf(x, depth + 1);
  else for (const [k, x] of Object.entries(v)) n += k.length + sizeOf(x, depth + 1);
  return n;
}

/** Opens a database as it is, never creating or upgrading it. @param {string} name @returns {Promise<IDBDatabase | null>} */
function openOnly(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** One piece of a store from after `after`: [key, value][] (at most PIECE). @param {IDBDatabase} db @param {string} s @param {IDBValidKey | undefined} after */
function piece(db, s, after) {
  return new Promise((resolve, reject) => {
    /** @type {[IDBValidKey, unknown][]} */
    const out = [];
    const tx = db.transaction(s, 'readonly');
    const req = tx.objectStore(s).openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      out.push([c.key, c.value]);
      if (out.length < PIECE) c.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** @param {string} name @param {{ keys?: string[], skip?: string[] }} only */
async function measureDb(name, { keys, skip }) {
  const db = await openOnly(name);
  let bytes = 0, items = 0;
  if (!db) return { bytes, items };
  const starts = (/** @type {IDBValidKey} */ k, /** @type {string[]} */ ps) => typeof k === 'string' && ps.some((p) => k.startsWith(p));
  try {
    for (const s of [...db.objectStoreNames]) {
      /** @type {IDBValidKey | undefined} */
      let after;
      for (;;) {
        const got = await piece(db, s, after);
        for (const [k, v] of got) {
          if ((keys && !starts(k, keys)) || (skip && starts(k, skip))) continue;
          bytes += sizeOf(k) + sizeOf(v);
          items++;
        }
        if (got.length < PIECE) break;
        after = got[got.length - 1][0];
        await breathe();
      }
    }
  } finally {
    db.close();
  }
  return { bytes, items };
}

/** @param {string} name */
async function measureCache(name) {
  const cache = await caches.open(name), reqs = await cache.keys();
  let bytes = 0;
  for (let i = 0; i < reqs.length; i++) {
    const res = await cache.match(reqs[i]);
    const len = Number(res?.headers.get('content-length'));
    bytes += len > 0 ? len : res ? (await res.blob()).size : 0;
    if (i % PIECE === PIECE - 1) await breathe();
  }
  return { bytes, items: reqs.length };
}

/** Files under a private-file entry, summed. @param {any} handle @param {{ bytes: number, items: number }} t */
async function measureEntry(handle, t) {
  if (handle.kind === 'file') {
    t.bytes += (await handle.getFile()).size;
    if (++t.items % PIECE === 0) await breathe();
    return;
  }
  for await (const child of handle.values()) await measureEntry(child, t);
}

function measureLocal() {
  let bytes = 0, items = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) ?? '';
    bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    items++;
  }
  return { bytes, items };
}

/** A row's bytes and items. @param {Store} store @param {Found} units */
export async function measure(store, units) {
  const t = { bytes: 0, items: 0 };
  const add = (/** @type {{ bytes: number, items: number }} */ m) => { t.bytes += m.bytes; t.items += m.items; };
  for (const n of units.caches) add(await measureCache(n));
  for (const n of units.idb) add(await measureDb(n, store.units));
  if (units.opfs.length) {
    const root = /** @type {any} */ (await navigator.storage.getDirectory());
    for (const n of units.opfs) {
      const h = await root.getDirectoryHandle(n).catch(() => root.getFileHandle(n));
      await measureEntry(h, t);
    }
  }
  if (units.local) add(measureLocal());
  return t;
}
