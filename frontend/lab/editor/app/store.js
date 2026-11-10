// @ts-check
// The editor's photos on this phone (docs/design/EDITOR.md, storage): each original RAF is copied into the
// browser's private file system (OPFS) with the camera's own JPEG beside it and, once edited, a small picture
// of the edit for its Library tile; the photo's record and its edit live in IndexedDB. Nothing leaves the phone. Persistent storage is asked for so Chrome
// keeps all of it when space runs low.

const DB = 'th-editor';
/** @typedef {{ id: string, name: string, size: number, taken: number, added: number, film: string, rating: number, flag: 'none' | 'pick' | 'reject', edited?: boolean }} Photo */
/** @typedef {Record<string, number | string>} Edit */

const open = () => /** @type {Promise<IDBDatabase>} */ (new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('photos', { keyPath: 'id' }); r.result.createObjectStore('edits'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
/** @param {'photos' | 'edits'} store @param {(s: IDBObjectStore) => IDBRequest} fn */
const tx = async (store, fn, mode = /** @type {IDBTransactionMode} */ ('readonly')) => {
  const d = await open();
  return new Promise((res, rej) => { const r = fn(d.transaction(store, mode).objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
};
const dir = async (/** @type {string} */ name) => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
/** @param {string} folder @param {string} name @param {Blob | ArrayBuffer} data */
async function write(folder, name, data) {
  const f = await (await dir(folder)).getFileHandle(name, { create: true }), w = await f.createWritable();
  await w.write(data); await w.close();
}

/** @type {Photo[]} */
let cache = [];
const urls = /** @type {Map<string, string>} */ (new Map()), tiles = /** @type {Map<string, string>} */ (new Map());   // each photo's camera JPEG; its edit, small, where there is one
/** Every photo, newest first (loaded once at start, then kept in step). */
export const photos = () => cache;
export async function init() {
  navigator.storage?.persist?.().catch(() => {});
  cache = /** @type {Photo[]} */ (await tx('photos', (s) => s.getAll())).sort((a, b) => b.taken - a.taken);
  await Promise.all(cache.map(async (p) => {
    await jpegUrl(p.id);
    if (p.edited) try { tiles.set(p.id, URL.createObjectURL(await (await (await dir('thumb')).getFileHandle(`${p.id}.jpg`)).getFile())); } catch {}
  }));
  return cache;
}

/** The camera's JPEG inside a RAF: its offset and length at bytes 84 and 88, big-endian. @param {ArrayBuffer} buf */
export function embedded(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 92 || new TextDecoder().decode(new Uint8Array(buf, 0, 8)) !== 'FUJIFILM') return null;
  const off = v.getUint32(84), len = v.getUint32(88);
  return off + len <= buf.byteLength ? new Blob([new Uint8Array(buf, off, len)], { type: 'image/jpeg' }) : null;
}

/** Copies RAFs onto the phone; `step(done, total)` after each. @param {File[]} files @param {(k: number, n: number) => void} step */
export async function add(files, step) {
  const raws = files.filter((f) => /\.raf$/i.test(f.name));
  let k = 0;
  for (const f of raws) {
    const buf = await f.arrayBuffer(), jpg = embedded(buf), id = crypto.randomUUID();
    await write('raw', `${id}.raf`, buf);
    if (jpg) { await write('jpg', `${id}.jpg`, jpg); urls.set(id, URL.createObjectURL(jpg)); }
    /** @type {Photo} */
    const p = { id, name: f.name, size: f.size, taken: f.lastModified, added: Date.now(), film: '', rating: 0, flag: 'none' };
    await tx('photos', (s) => s.put(p), 'readwrite');
    cache = [p, ...cache].sort((a, b) => b.taken - a.taken);
    step(++k, raws.length);
  }
  return raws.length;
}

/** @param {string} id @param {Partial<Photo>} patch */
export async function update(id, patch) {
  const p = cache.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  await tx('photos', (s) => s.put(p), 'readwrite');
}

/** An object URL for the photo's camera JPEG (kept for the session). @param {string} id */
export async function jpegUrl(id) {
  if (!urls.has(id)) {
    try { urls.set(id, URL.createObjectURL(await (await (await dir('jpg')).getFileHandle(`${id}.jpg`)).getFile())); } catch { urls.set(id, '/lab/editor/assets/sample.jpg'); }
  }
  return urls.get(id);
}
/** The first bytes of the photo's camera JPEG: its Exif is in them. @param {string} id */
export async function jpegHead(id) {
  try { return new Uint8Array(await (await (await (await dir('jpg')).getFileHandle(`${id}.jpg`)).getFile()).slice(0, 1 << 17).arrayBuffer()); } catch { return new Uint8Array(0); }
}
/** The photo's Library tile: its edit where one was kept, else the camera's JPEG (init and add load them all). @param {string} id */
export const urlNow = (id) => tiles.get(id) || urls.get(id) || '/lab/editor/assets/sample.jpg';
/** Keeps a small picture of the photo as edited, for its tile; null when it is back as imported. @param {string} id @param {Blob | null} blob */
export async function saveTile(id, blob) {
  const old = tiles.get(id);
  if (old) URL.revokeObjectURL(old);
  tiles.delete(id);
  if (blob) { await write('thumb', `${id}.jpg`, blob); tiles.set(id, URL.createObjectURL(blob)); } else await (await dir('thumb')).removeEntry(`${id}.jpg`).catch(() => {});
  await update(id, { edited: !!blob });
}
/** Deletes photos from this phone for good: the RAF, its JPEG and tile, its record and its edit. @param {string[]} ids */
export async function remove(ids) {
  for (const id of ids) {
    for (const [folder, name] of [['raw', `${id}.raf`], ['jpg', `${id}.jpg`], ['thumb', `${id}.jpg`]]) await (await dir(folder)).removeEntry(name).catch(() => {});
    await tx('photos', (s) => s.delete(id), 'readwrite'); await tx('edits', (s) => s.delete(id), 'readwrite');
    for (const m of [urls, tiles]) { const u = m.get(id); if (u?.startsWith('blob:')) URL.revokeObjectURL(u); m.delete(id); }
  }
  cache = cache.filter((p) => !ids.includes(p.id));
}
/** How many bytes this site keeps on the phone (the photos are nearly all of it). */
export const usage = async () => (await navigator.storage?.estimate?.())?.usage ?? cache.reduce((s, p) => s + p.size, 0);
/** The original RAF. @param {string} id */
export const raw = async (id) => (await (await (await dir('raw')).getFileHandle(`${id}.raf`)).getFile()).arrayBuffer();

/** The saved edit, if any. @param {string} id @returns {Promise<Edit | undefined>} */
export const loadEdit = (id) => tx('edits', (s) => s.get(id));
/** @param {string} id @param {Edit} edit */
export const saveEdit = (id, edit) => tx('edits', (s) => s.put(edit, id), 'readwrite');
