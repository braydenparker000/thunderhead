// @ts-check
// The looks kept on this phone that are not camera profiles: `.cube` files brought in (engine/cube.js) and the
// owner's own, saved from an edit. They live in their own IndexedDB database; nothing leaves the phone.
import { parseCube } from '../../engine/cube.js';

/** @typedef {{ id: string, kind: 'cube' | 'mine', name: string, added: number, cube?: import('../../engine/cube.js').Cube, st?: import('./past.js').State }} Look */
const open = () => /** @type {Promise<IDBDatabase>} */ (new Promise((res, rej) => {
  const r = indexedDB.open('th-looks', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('looks', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
/** @param {(s: IDBObjectStore) => IDBRequest} fn */
const tx = async (fn, mode = /** @type {IDBTransactionMode} */ ('readonly')) => {
  const d = await open();
  return new Promise((res, rej) => { const r = fn(d.transaction('looks', mode).objectStore('looks')); r.onsuccess = () => { d.close(); res(r.result); }; r.onerror = () => { d.close(); rej(r.error); }; });
};
let all = /** @type {Look[]} */ ([]);
/** Read once, before the first photo opens. */
export const ready = tx((s) => s.getAll()).then((l) => { all = /** @type {Look[]} */ (l).sort((a, b) => a.added - b.added); }, () => {});
/** @param {'cube' | 'mine'} kind */
export const list = (kind) => all.filter((l) => l.kind === kind);
/** @param {string} [id] */
export const get = (id) => all.find((l) => l.id === id) || null;
const keep = async (/** @type {Look} */ l) => { await tx((s) => s.put(l), 'readwrite'); all = all.filter((x) => x.id !== l.id).concat(l); return l; };
const newId = (/** @type {string} */ k) => `${k}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
/** Brings a `.cube` file in. Throws with the reason when it cannot be read. @param {File} file */
export const addCube = async (file) => keep({ id: newId('c'), kind: 'cube', name: file.name.replace(/\.cube$/i, ''), added: Date.now(), cube: parseCube(await file.text()) });
/** Keeps an edit as a look of the owner's own. @param {string} name @param {import('./past.js').State} st */
export const addMine = (name, st) => keep({ id: newId('m'), kind: 'mine', name, added: Date.now(), st });
/** @param {string} id */
export async function remove(id) { await tx((s) => s.delete(id), 'readwrite'); all = all.filter((l) => l.id !== id); }
