// @ts-check
// The engine's profiles (docs/engineering/ENGINE-RESEARCH.md): the owner's private set of camera-matching
// profiles (a zip of DCPs, Adobe RGB tables and look XMPs) is loaded once, kept in this browser's own
// storage (IndexedDB), never on the site, and turned into the list the profile picker shows.
import { parseDcp, parseRgbTable } from './dcp.js';

/** Unzips a stored or deflated zip in the browser. @param {ArrayBuffer} buf @returns {Promise<Map<string, ArrayBuffer>>} */
export async function unzip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out = new Map();
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file.');
  let p = v.getUint32(e + 16, true);
  for (let i = 0, count = v.getUint16(e + 10, true); i < count; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), local = v.getUint32(p + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), raw = u8.slice(start, start + size);
    if (!name.endsWith('/')) out.set(name.split('/').pop(), method === 0 ? raw.buffer : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nl + xl + cl;
  }
  return out;
}

const DB = 'th-engine', STORE = 'profiles';
const db = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
/** @param {'get' | 'put'} op @param {ArrayBuffer} [value] */
const idb = async (op, value) => { const d = /** @type {IDBDatabase} */ (await db()); return new Promise((res, rej) => {
  const s = d.transaction(STORE, op === 'put' ? 'readwrite' : 'readonly').objectStore(STORE), r = op === 'put' ? s.put(value, 'set') : s.get('set');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };

/** Keeps the zip on this phone. @param {ArrayBuffer} buf */
export const saveSet = (buf) => idb('put', buf);
/** The stored zip, if any. @returns {Promise<ArrayBuffer | undefined>} */
export const storedSet = () => /** @type {any} */ (idb('get'));

/** The picker's entries: each base profile, and each look (a base profile plus an RGB table).
 * @param {Map<string, ArrayBuffer>} files @param {string} model the camera, e.g. "Fujifilm X-E5" */
export function catalogue(files, model) {
  /** @type {{ id: string, label: string, profile: import('./dcp.js').Profile, table: null | ReturnType<typeof parseRgbTable> }[]} */
  const list = [], byName = new Map();
  for (const [name, buf] of files) {
    if (!name.endsWith('.dcp')) continue;
    const p = parseDcp(buf);
    byName.set(p.name, p);
    list.push({ id: name, label: p.name.replace(/^Camera /, ''), profile: p, table: null });
  }
  for (const [name, buf] of files) {
    if (!name.endsWith('.xmp')) continue;
    const text = new TextDecoder().decode(buf), base = /crs:CameraProfile="([^"]+)"/.exec(text)?.[1], label = /Camera ([^.]+)\.xmp$/.exec(name)?.[1];
    const tableFile = [...files.keys()].find((k) => k === `table ${label}.bin`);
    if (base && label && tableFile && byName.has(base)) list.push({ id: name, label, profile: byName.get(base), table: parseRgbTable(/** @type {ArrayBuffer} */ (files.get(tableFile))) });
  }
  // Adobe Standard first (the base), then the film simulations in the camera's own order
  const order = ['Adobe Standard', 'PROVIA', 'Velvia', 'ASTIA', 'CLASSIC CHROME', 'REALA ACE', 'Pro Neg Hi', 'Pro Neg Std', 'CLASSIC Neg', 'NOSTALGIC Neg', 'ETERNA', 'BLEACH BYPASS', 'ACROS', 'Monochrome', 'Sepia'];
  const rank = (/** @type {string} */ l) => { const i = order.findIndex((o) => l.toUpperCase().startsWith(o.toUpperCase())); return i < 0 ? 99 : i; };
  return list.filter((e) => !model || !e.profile.model || e.profile.model === model || /X-H2/.test(e.profile.model) || /Adobe Standard/.test(e.label)).sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}
