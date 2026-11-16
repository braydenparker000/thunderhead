// A film remembered. Describing a film reads its header and its index (Matroska's Cues, an MP4's moov), which
// costs a round trip to its start and one or two to its end each time it opens. The ranges describing it
// read, with their bytes, are kept in IndexedDB (database `astra-films`), at most 4 MB a film and 60 films,
// the least recently opened dropped first. A film is known by its size and a SHA-256 of its first 64 KiB,
// never by its address (which carries secrets). On the next open, once the first answer has given the size
// and the first 64 KiB have arrived, the probe's reads are answered from what was kept; anything else is
// fetched as usual. A kept range is used only when the size and the hash match and its own checksum holds;
// a damaged entry is dropped and replaced, and storage that fails or is missing changes nothing.

import {HASH_CHUNK, headKey} from './file-hash.js';
import {BLOCK, missing, assemble} from './source-blocks.js';

export const HEAD = HASH_CHUNK; // the bytes that name the film, always read from the host
export const MEMORY = {maxFilm: 4e6, maxFilms: 60, wait: 1500}; // bytes a film, films, ms the lookup may take
let shared;

/** The browser's store, or null where there is no IndexedDB or no WebCrypto. */
export function filmStore() {
  if (shared === undefined) shared = typeof indexedDB === 'object' && indexedDB && globalThis.crypto?.subtle ? idbStore(indexedDB) : null;
  return shared;
}

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** {get(key), put(entry), drop(key)} over IndexedDB: `films` holds the entries, `used` when each was last opened. */
export function idbStore(idb, name = 'astra-films') {
  let db = null;
  const open = () => db ??= new Promise((resolve, reject) => {
    const r = idb.open(name, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('films', {keyPath: 'key'}); r.result.createObjectStore('used', {keyPath: 'key'}); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blocked'));
  });
  const run = async (mode, fn) => {
    const t = (await open()).transaction(['films', 'used'], mode);
    const done = new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
    const out = await fn(t.objectStore('films'), t.objectStore('used'));
    await done;
    return out;
  };
  return {
    get: key => run('readwrite', async (films, used) => {
      const film = await req(films.get(key));
      if (film) used.put({key, used: Date.now()});
      return film ?? null;
    }),
    put: entry => run('readwrite', async (films, used) => {
      films.put(entry); used.put({key: entry.key, used: Date.now()});
      const all = await req(used.getAll());
      all.sort((a, b) => a.used - b.used);
      for (const old of all.slice(0, Math.max(0, all.length - MEMORY.maxFilms))) { films.delete(old.key); used.delete(old.key); }
    }),
    drop: key => run('readwrite', async (films, used) => { films.delete(key); used.delete(key); }),
  };
}

const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const within = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]);

/** Looks the film up once its first 64 KiB are here, and lays what was kept where reads find it. Never rejects. */
export async function recall(source) {
  try {
    const head = await source.read(0, HEAD);
    const key = source.filmKey = await headKey(source.size, head);
    const film = await within(source.memory.get(key), MEMORY.wait);
    if (!film || source.closed) return;
    const ranges = await check(film, key, source.size);
    if (!ranges) { source.memory.drop(key).catch(() => {}); return; }
    source.keptRanges = ranges;
    source.kept = ranges.flatMap(({start, bytes}) => {
      const recs = [];
      for (let at = start, end = start + bytes.length; at < end;) {
        const index = Math.floor(at / BLOCK), off = at - index * BLOCK, n = Math.min(BLOCK - off, end - at);
        recs.push({index, bytes: bytes.subarray(at - start, at - start + n), skew: off, from: off, filled: off + n});
        at += n;
      }
      return recs;
    });
  } catch {}
}

/** The entry's ranges when it is whole and is this film's, else null. */
async function check(film, key, size) {
  if (film?.key !== key || film.size !== size || !Array.isArray(film.ranges)) return null;
  let total = 0;
  for (const r of film.ranges) {
    if (!Number.isSafeInteger(r?.start) || !(r.bytes instanceof Uint8Array) || r.start < HEAD || r.start + r.bytes.length > size) return null;
    if ((total += r.bytes.length) > MEMORY.maxFilm || r.sum !== await digest(r.bytes)) return null;
  }
  return film.ranges.map(r => ({start: r.start, bytes: r.bytes}));
}

/** Ranges joined where they touch or overlap, in order. */
function merge(ranges) {
  const out = [];
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out;
}

/** Describing the film is over: what it read past the first 64 KiB is kept, unless all of it already was. */
export function remember(source) {
  const key = source.filmKey, size = source.size, old = source.keptRanges || [];
  const read = merge(source.probeReads.map(([s, e]) => [Math.max(s, HEAD), Math.min(e, size)]).filter(([s, e]) => e > s));
  source.probeReads = [];
  if (!key || read.every(([s, e]) => old.some(r => r.start <= s && r.start + r.bytes.length >= e))) return;
  const ranges = [];
  let total = 0;
  for (const [s, e] of merge([...old.map(r => [r.start, r.start + r.bytes.length]), ...read])) {
    if (total + e - s > MEMORY.maxFilm || missing(source, s, e) < e) continue;
    ranges.push({start: s, bytes: assemble(source, s, e).slice()}); total += e - s;
  }
  if (!ranges.length) return;
  (async () => {
    for (const r of ranges) r.sum = await digest(r.bytes);
    await source.memory.put({key, size, ranges});
  })().catch(() => {});
}
