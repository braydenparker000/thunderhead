// @ts-check
// The editor's photos on this phone (docs/design/EDITOR.md, storage): each original (a RAF, or a JPEG) is copied into the
// browser's private file system (OPFS) with the camera's own JPEG beside it (for a JPEG, a smaller copy of itself) and, once edited, a small picture
// of the edit for its Library tile; the photo's record and its edit live in IndexedDB. Nothing leaves the phone. Persistent storage is asked for so Chrome
// keeps all of it when space runs low.
import { shot } from '../../engine/exif.js';

const DB = 'th-editor';
/** @typedef {{ id: string, name: string, size: number, taken: number, added: number, film: string, rating: number, flag: 'none' | 'pick' | 'reject', edited?: boolean, source?: string,
 *   editFile?: string, backed?: string, kind?: 'jpeg' | 'stack', stamp?: number, deleted?: number, shot?: { camera: string, lens: string, iso: number, time: number, f: number, mm: number } }} Photo `taken`: when, by the camera's clock where its
 *   Exif says, else the file's time; `stamp`: the file's own time (an import knows a file it has by it); `shot`: what the camera wrote of the shot (engine/exif.js);
 *   `kind`: what the original is when it is not a RAF (a JPEG; frames stacked into one, app/stack.js); `source`: where it came from or is backed up to (`photos:<id>`, the owner's library in Drive);
 *   `editFile`: its edit's backup in Drive; `backed`: a mark of the edit as last backed up (app/backup.js); `deleted`: when it was deleted, while it can
 *   still be brought back (`remove`) */
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
/** @type {Photo[]} */
let bin = [];   // photos deleted lately: out of the Library, still on the phone (`remove`, `restore`)
const urls = /** @type {Map<string, string>} */ (new Map()), tiles = /** @type {Map<string, string>} */ (new Map());   // each photo's camera JPEG; its edit, small, where there is one
/** Every photo, newest first (loaded once at start, then kept in step). */
export const photos = () => cache;
let safe = false;
/** Whether the browser has promised to keep these photos (asked at start): without it, it may clear them when
 * the phone runs low on space. */
export const kept = () => safe;
/** Files with no record. An original with none (its record was lost, or the page closed between the copy and the
 * record) is still the owner's photo: it is given a record again and shows in the Library as "Recovered", never
 * deleted. Only what is no picture at all goes, and a camera JPEG or tile whose original is gone. Files under an
 * hour old (`age`, in ms) are left alone: another tab may be copying them now. Returns how many photos came back. */
export async function sweep(age = 3600e3) {
  const known = new Set(/** @type {Photo[]} */ (await tx('photos', (s) => s.getAll())).map((p) => p.id));
  let back = 0;
  for (const folder of ['raw', 'jpg', 'thumb']) {
    const d = await dir(folder);
    for await (const [name, h] of /** @type {any} */ (d).entries()) {
      const id = name.replace(/\.\w+$/, '');
      if (h.kind !== 'file' || known.has(id)) continue;
      const file = /** @type {File} */ (await h.getFile());
      if (Date.now() - file.lastModified < age) continue;
      if (folder === 'raw' && (await adopt(id, name, file).catch(() => false))) { known.add(id); back++; continue; }
      await d.removeEntry(name).catch(() => {});
    }
  }
  if (back) { cache.sort((a, b) => b.taken - a.taken); dispatchEvent(new Event('th-editor-photos')); }
  return back;
}
/** Photos brought in before the shot's own data was kept get it now, once, from their Exif (and their place in
 * the Library by the camera's clock). Returns how many. */
async function fill() {
  let n = 0;
  for (const p of cache.filter((x) => !x.shot)) {
    const { at, ...made } = shot(await jpegHead(p.id));
    await update(p.id, { shot: made, stamp: p.stamp ?? p.taken, taken: p.source ? p.taken : at || p.taken }); n++;   // one handed over keeps the time it came with
  }
  if (n) cache.sort((a, b) => b.taken - a.taken);
  return n;
}
export async function init() {
  safe = (await navigator.storage?.persist?.().catch(() => false)) || false;
  const all = /** @type {Photo[]} */ (await tx('photos', (s) => s.getAll())).sort((a, b) => b.taken - a.taken);
  cache = all.filter((p) => !p.deleted); bin = all.filter((p) => p.deleted);
  empty(bin.filter((p) => Date.now() - (p.deleted || 0) > KEEP_DAYS * 864e5).map((p) => p.id)).catch((e) => console.warn('photos: deleted ones not cleared', e));
  sweep().catch(() => {});
  fill().then((n) => { if (n) dispatchEvent(new Event('th-editor-photos')); }, () => {});   // the Library reads the roll again
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

const RAF = /\.raf$/i, JPEG = /\.jpe?g$/i;
/** The name a photo's original is kept under. @param {string} id @param {Photo['kind']} [kind] */
const orig = (id, kind) => `${id}.${kind === 'jpeg' ? 'jpg' : kind === 'stack' ? 'stk' : 'raf'}`;
/** A picture file made small (1600 pixels on its longer side), for its tile and for the screen while it opens. @param {Blob} file */
async function reduced(file) {
  const bm = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bm.width, bm.height)), c = new OffscreenCanvas(Math.max(1, Math.round(bm.width * k)), Math.max(1, Math.round(bm.height * k)));
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
  g.imageSmoothingQuality = 'high'; g.drawImage(bm, 0, 0, c.width, c.height); bm.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
/** Copies one original onto the phone and keeps its record. A file that is not what its name says throws, with
 * nothing kept. @param {File} file @param {Partial<Photo>} [more] */
async function copyIn(file, more = {}) {
  const id = crypto.randomUUID(), kind = JPEG.test(file.name) || file.type === 'image/jpeg' ? /** @type {const} */ ('jpeg') : undefined;
  let jpg = /** @type {Blob | null} */ (null);
  if (kind) { jpg = await reduced(file); await write('raw', orig(id, kind), file); }
  else { const buf = await file.arrayBuffer(); jpg = embedded(buf); if (!jpg && more.source) throw new Error('not a RAF'); await write('raw', orig(id), buf); }
  if (jpg) { await write('jpg', `${id}.jpg`, jpg); urls.set(id, URL.createObjectURL(jpg)); }
  const { at, ...made } = shot(new Uint8Array(await (kind ? file : jpg || new Blob()).slice(0, 1 << 17).arrayBuffer()));   // a JPEG's own Exif; a RAF's is in the camera's JPEG inside it
  /** @type {Photo} */
  const p = { id, name: file.name, size: file.size, taken: at || file.lastModified, stamp: file.lastModified, shot: made, added: Date.now(), film: '', rating: 0, flag: 'none', ...(kind ? { kind } : {}), ...more };
  await tx('photos', (s) => s.put(p), 'readwrite');
  return p;
}

/** Gives an original that has no record one again, where it lies (no copy). False for a file that is no picture.
 * @param {string} id @param {string} name its file's name @param {File} file */
async function adopt(id, name, file) {
  const kind = /\.jpg$/.test(name) ? /** @type {const} */ ('jpeg') : undefined;
  if (!kind && !/\.raf$/.test(name)) return false;   // a stack cannot be told from its file alone: it is left where it is
  const jpg = kind ? await reduced(file) : embedded(await file.arrayBuffer());
  if (!jpg) return false;
  await write('jpg', `${id}.jpg`, jpg); urls.set(id, URL.createObjectURL(jpg));
  const { at, ...made } = shot(new Uint8Array(await (kind ? file : jpg).slice(0, 1 << 17).arrayBuffer()));
  /** @type {Photo} */
  const p = { id, name: `Recovered ${id.slice(0, 8)}.${kind ? 'jpg' : 'RAF'}`, size: file.size, taken: at || file.lastModified, stamp: file.lastModified, shot: made, added: Date.now(), film: '', rating: 0, flag: 'none', ...(kind ? { kind } : {}) };
  await tx('photos', (s) => s.put(p), 'readwrite');
  cache = [p, ...cache];
  return true;
}

/** Copies RAFs and JPEGs onto the phone; `step(done, total)` after each. A file already here (the same name, size
 * and time) is not copied twice, so picking a set again after an import was cut off carries on where it stopped.
 * Returns how many were copied, how many were here already, and how many could not be read.
 * @param {File[]} files @param {(k: number, n: number) => void} step */
export async function add(files, step) {
  const ours = files.filter((f) => RAF.test(f.name) || JPEG.test(f.name));
  let k = 0, had = 0, bad = 0;
  for (const f of ours) {
    const same = (/** @type {Photo} */ p) => p.name === f.name && p.size === f.size && (p.stamp ?? p.taken) === f.lastModified, gone = bin.find(same);
    if (gone) { await restore([gone.id]); had++; }   // deleted lately and picked again: brought back, not copied twice
    else if (cache.some(same)) had++;
    else try { const p = await copyIn(f); cache = [p, ...cache].sort((a, b) => b.taken - a.taken); } catch { bad++; }
    step(++k, ours.length);
  }
  return { added: ours.length - had - bad, had, bad };
}

/** Keeps a photo made here from others (a stack, app/stack.js): its file, the camera JPEG of the photo it was made
 * from for its tile and its Exif, and its record. @param {string} name @param {BlobPart[]} parts its file @param {string} from the photo whose JPEG it takes @param {Partial<Photo>} more */
export async function addMade(name, parts, from, more) {
  const id = crypto.randomUUID(), file = new Blob(parts);
  await write('raw', orig(id, 'stack'), file);
  try { const jpg = await (await (await dir('jpg')).getFileHandle(`${from}.jpg`)).getFile(); await write('jpg', `${id}.jpg`, jpg); urls.set(id, URL.createObjectURL(jpg)); } catch { /* it has none: the tile is the sample's until the stack is edited */ }
  /** @type {Photo} */
  const p = { id, name, size: file.size, taken: Date.now(), added: Date.now(), film: '', rating: 0, flag: 'none', kind: 'stack', ...more };
  await tx('photos', (s) => s.put(p), 'readwrite');
  cache = [p, ...cache].sort((a, b) => b.taken - a.taken);
  return p;
}

/** One original handed over by another part of the app (Photos' Edit, apps/photos/to-editor.js), kept under
 * where it came from (`photos:<id>`) so the same photo is copied once and its edit is found again.
 * Works before `init`. @param {string} source @returns {Promise<string | null>} its id here, if it is here */
export async function fromSource(source) {
  const all = /** @type {Photo[]} */ (await tx('photos', (s) => s.getAll()));
  return all.find((p) => p.source === source)?.id ?? null;
}
/** @param {File} file @param {string} source @param {Partial<Photo>} [more] what is already known of it (a backup's rating, flag and marks)
 * @returns {Promise<string>} the photo's id here */
export async function addFrom(file, source, more = {}) {
  const had = await fromSource(source);
  if (had) return had;
  return (await copyIn(file, { taken: file.lastModified, ...more, source })).id;   // the time it comes with is the library's own for it
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
/** The first bytes of the photo's camera JPEG (of a JPEG itself: its small copy carries none): its Exif is in them. @param {string} id */
export async function jpegHead(id) {
  const own = cache.find((x) => x.id === id)?.kind === 'jpeg';
  try { return new Uint8Array(await (await (await (await dir(own ? 'raw' : 'jpg')).getFileHandle(`${id}.jpg`)).getFile()).slice(0, 1 << 17).arrayBuffer()); } catch { return new Uint8Array(0); }
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
/** How long a deleted photo can still be brought back. */
export const KEEP_DAYS = 7;
/** Deletes photos: they leave the Library at once and can be brought back for KEEP_DAYS (`restore`), after which
 * they go from this phone for good (`init`), or at once with `empty`. @param {string[]} ids */
export async function remove(ids) {
  for (const p of cache.filter((x) => ids.includes(x.id))) { p.deleted = Date.now(); await tx('photos', (s) => s.put(p), 'readwrite'); bin.push(p); }
  cache = cache.filter((p) => !ids.includes(p.id));
}
/** The photos deleted and not yet gone. */
export const deleted = () => bin;
/** Brings deleted photos back, with their edits. @param {string[]} [ids] all of them when not given */
export async function restore(ids) {
  for (const p of bin.filter((x) => !ids || ids.includes(x.id))) { delete p.deleted; await tx('photos', (s) => s.put(p), 'readwrite'); cache.push(p); }
  bin = bin.filter((p) => p.deleted); cache.sort((a, b) => b.taken - a.taken);
}
/** Takes deleted photos from this phone for good: the original, its JPEG and tile, its record and its edit.
 * @param {string[]} [ids] every deleted photo when not given */
export async function empty(ids) {
  for (const { id } of bin.filter((x) => !ids || ids.includes(x.id))) {
    for (const [folder, name] of [['raw', `${id}.raf`], ['raw', `${id}.jpg`], ['raw', `${id}.stk`], ['jpg', `${id}.jpg`], ['thumb', `${id}.jpg`]]) await (await dir(folder)).removeEntry(name).catch(() => {});
    await tx('photos', (s) => s.delete(id), 'readwrite'); await tx('edits', (s) => s.delete(id), 'readwrite');
    for (const m of [urls, tiles]) { const u = m.get(id); if (u?.startsWith('blob:')) URL.revokeObjectURL(u); m.delete(id); }
    bin = bin.filter((p) => p.id !== id);
  }
}
/** How many bytes this site keeps on the phone (the photos are nearly all of it). */
export const usage = async () => (await navigator.storage?.estimate?.())?.usage ?? cache.reduce((s, p) => s + p.size, 0);
/** The original as a file on disk, under its own name (nothing is read until something reads it). @param {string} id */
export async function rawFile(id) {
  const p = cache.find((x) => x.id === id), f = await (await (await dir('raw')).getFileHandle(orig(id, p?.kind))).getFile();
  return new File([f], p?.name || orig(id, p?.kind), { type: p?.kind === 'jpeg' ? 'image/jpeg' : '', lastModified: p?.taken || f.lastModified });
}
/** Every saved edit, by photo id. @returns {Promise<Map<string, Edit>>} */
export async function edits() {
  const d = await open();
  return new Promise((res, rej) => {
    const out = new Map(), q = d.transaction('edits').objectStore('edits').openCursor();
    q.onsuccess = () => { const c = q.result; if (c) { out.set(String(c.key), c.value); c.continue(); } else res(out); };
    q.onerror = () => rej(q.error);
  });
}
/** The original RAF. @param {string} id */
export const raw = async (id) => (await (await (await dir('raw')).getFileHandle(`${id}.raf`)).getFile()).arrayBuffer();

/** The saved edit, if any. @param {string} id @returns {Promise<Edit | undefined>} */
export const loadEdit = (id) => tx('edits', (s) => s.get(id));
/** @param {string} id @param {Edit} edit */
export const saveEdit = (id, edit) => tx('edits', (s) => s.put(edit, id), 'readwrite');
