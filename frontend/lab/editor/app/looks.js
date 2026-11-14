// @ts-check
// The looks kept on this phone that are not camera profiles: `.cube` files brought in (engine/cube.js) and the
// owner's own, saved from an edit. They live in their own IndexedDB database; nothing leaves the phone.
import { parseCube } from '../../engine/cube.js';

/** @typedef {{ id: string, kind: 'cube' | 'mine', name: string, added: number, pack?: string, cube?: import('../../engine/cube.js').Cube, st?: import('./past.js').State }} Look */
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
// A look brought in a second time (a pack picked again) is not kept twice: the same name and the same contents.
const same = (/** @type {Look} */ l) => all.some((x) => x.kind === l.kind && x.name === l.name && (l.cube ? x.cube?.n === l.cube.n && l.cube.d.every((v, i) => v === x.cube?.d[i]) : JSON.stringify(x.st) === JSON.stringify(l.st)));
/** Brings a `.cube` file in; null when it is here already. Throws with the reason when it cannot be read.
 * @param {{ name: string, text: () => Promise<string> }} file @param {string} [pack] the pack it came in */
export const addCube = async (file, pack) => { const l = /** @type {Look} */ ({ id: newId('c'), kind: 'cube', name: file.name.replace(/\.cube$/i, ''), added: Date.now(), pack, cube: parseCube(await file.text()) }); return same(l) ? null : keep(l); };
/** Keeps an edit as a look of the owner's own. @param {string} name @param {import('./past.js').State} st
 * @param {string} [pack] the pack it came in @param {boolean} [once] brought in from a file: null when it is here already */
export const addMine = async (name, st, pack, once = false) => { const l = /** @type {Look} */ ({ id: newId('m'), kind: 'mine', name, added: Date.now(), pack, st }); return once && same(l) ? null : keep(l); };
/** @param {string} id */
export async function remove(id) { await tx((s) => s.delete(id), 'readwrite'); all = all.filter((l) => l.id !== id); }
/** The looks a pack brought in. @param {string} [pack] */
export const inPack = (pack) => (pack ? all.filter((l) => l.pack === pack) : []);
