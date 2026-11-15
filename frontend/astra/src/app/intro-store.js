// What Astra has learned about each series' opening and ending, kept in
// IndexedDB (database `astra-intro`): localStorage is too small for sound
// fingerprints and is shared with everything else. One record per series
// (type + id) holds up to eight episodes: the fingerprint of each one's first
// six and last four minutes, the segments found and when. Once two different
// pairs of episodes agree on the opening, its fingerprint alone is kept as
// the series' intro, so a new episode is matched against that first.
// Every call resolves; without IndexedDB nothing is known and nothing is kept.

import {mergeFingerprints, sliceFingerprint} from '../engine/fingerprint.js';

const DB = 'astra-intro', STORE = 'series';
export const MAX_SERIES = 60, MAX_EPISODES = 8;
const AGREE = 3;   // seconds two pairs' intro lengths may differ by and still agree

export const seriesKey = s => `${s?.type || ''}:${s?.id || ''}`;

/** Fills in the types an episode's segments lack from `found`; the ones it has are kept unless `replace`. */
export function mergeSegments(have = [], found = [], replace = false) {
  const out = new Map((have || []).map(s => [s.type, s]));
  for (const s of found || []) if (replace || !out.has(s.type)) out.set(s.type, {type: s.type, start: s.start, end: s.end});
  return [...out.values()].sort((a, b) => a.start - b.start);
}

/**
 * Adds one save to a series record (pure, for tests): the episode's
 * fingerprint and segments, what the match taught about the other episode,
 * the intro once two pairs agree, and at most MAX_EPISODES episodes.
 */
export function applySave(rec, key, video, {fingerprint, segments, duration, pairs = []} = {}, now = Date.now()) {
  rec = rec || {key, used: now, episodes: {}, confirms: [], intro: null};
  rec.used = now;
  const ep = rec.episodes[video] || (rec.episodes[video] = {fingerprint: null, segments: [], duration: null, at: now});
  if (fingerprint?.spans?.length) ep.fingerprint = ep.fingerprint ? mergeFingerprints(ep.fingerprint, fingerprint) : fingerprint;
  if (segments?.length) ep.segments = mergeSegments(ep.segments, segments, true);
  if (duration > 0) ep.duration = duration;
  ep.used = now;
  ep.at = segments?.length ? now : ep.at;
  for (const p of pairs) {
    const other = rec.episodes[p.video];
    if (other && p.segments?.length) other.segments = mergeSegments(other.segments, p.segments);
    const mine = segments?.find(s => s.type === 'intro');
    if (!mine || !p.segments?.some(s => s.type === 'intro')) continue;
    const pair = [video, p.video].sort().join('\n'), len = mine.end - mine.start;
    if (!rec.confirms.some(c => c.pair === pair)) rec.confirms.push({pair, len});
    rec.confirms = rec.confirms.slice(-8);
    const agreeing = new Set(rec.confirms.filter(c => Math.abs(c.len - len) <= AGREE).map(c => c.pair));
    if (!rec.intro && agreeing.size >= 2 && ep.fingerprint) {
      const print = sliceFingerprint(ep.fingerprint, mine.start, mine.end);
      if (print.spans.length) rec.intro = {fingerprint: print, start: mine.start, end: mine.end};
    }
  }
  const order = Object.keys(rec.episodes).filter(v => v !== video).sort((a, b) => (rec.episodes[b].used || 0) - (rec.episodes[a].used || 0));
  for (const v of order.slice(MAX_EPISODES - 1)) delete rec.episodes[v];
  return rec;
}

/** Candidates to match a new episode against (pure): the series intro first, then episodes most recently used first. */
export function candidatesOf(rec, except) {
  if (!rec) return [];
  const out = [];
  if (rec.intro?.fingerprint) out.push({video: null, slice: true, fingerprint: rec.intro.fingerprint, segments: [{type: 'intro', start: rec.intro.start, end: rec.intro.end}]});
  const eps = Object.entries(rec.episodes || {}).filter(([v, e]) => v !== except && e.fingerprint?.spans?.length)
    .sort((a, b) => (b[1].used || 0) - (a[1].used || 0));
  for (const [video, e] of eps) out.push({video, fingerprint: e.fingerprint, segments: e.segments || [], duration: e.duration || null});
  return out;
}

/** The store: `indexedDB` may be passed (or missing) for tests. */
export function introStore({indexedDB = globalThis.indexedDB} = {}) {
  let opening = null;
  const open = () => opening || (opening = new Promise(res => {
    try {
      if (!indexedDB) return res(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'key'}).createIndex('used', 'used');
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); opening = null; }; res(db); };
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch { res(null); }
  }));
  // One request in its own transaction; null on any failure.
  const request = async (mode, make) => {
    const db = await open();
    if (!db) return null;
    return new Promise(res => {
      try {
        const tx = db.transaction(STORE, mode), req = make(tx.objectStore(STORE));
        let value = null;
        req.onsuccess = () => { value = req.result ?? null; };
        tx.oncomplete = () => res(value);
        tx.onerror = tx.onabort = () => res(null);
      } catch { res(null); }
    });
  };
  const read = series => request('readonly', s => s.get(seriesKey(series)));

  return {
    /** This episode's segments when they were found before, else null. */
    async known(series, video) {
      const segs = (await read(series))?.episodes?.[video]?.segments;
      return segs?.length ? segs : null;
    },
    /** [{video, fingerprint, segments, slice?}] to match `exceptVideo` against. */
    async candidates(series, exceptVideo) { return candidatesOf(await read(series), exceptVideo); },
    /** Keeps an episode's fingerprint and segments; `pairs` are [{video, segments}] the match found for the other episodes. */
    async save(series, video, data) {
      const db = await open();
      if (!db || !video) return false;
      const ok = await new Promise(res => {
        try {
          const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), key = seriesKey(series);
          const get = store.get(key);
          get.onsuccess = () => store.put(applySave(get.result, key, video, data));
          tx.oncomplete = () => res(true);
          tx.onerror = tx.onabort = () => res(false);
        } catch { res(false); }
      });
      if (ok) await dropOldSeries(db);
      return ok;
    },
  };
}

/** Keeps the MAX_SERIES most recently saved series. */
function dropOldSeries(db) {
  return new Promise(res => {
    try {
      const tx = db.transaction(STORE, 'readwrite'), index = tx.objectStore(STORE).index('used');
      const count = index.count();
      count.onsuccess = () => {
        let extra = count.result - MAX_SERIES;
        if (extra <= 0) return;
        const cur = index.openCursor();
        cur.onsuccess = () => { const c = cur.result; if (c && extra-- > 0) { c.delete(); c.continue(); } };
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => res();
    } catch { res(); }
  });
}
