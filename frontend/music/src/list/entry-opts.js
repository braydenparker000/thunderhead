// Per-list options (List Options and pinch zoom; owner audit 2026-11-26). A list kind's options are
// saved under its kind key in cp-list-opts ("cat:albums", "tracks:album", "sub:artist" …), as they
// always were. An entry's list (this album's songs, this artist's page, this playlist, this genre's
// albums, this folder …) has a key of its own, the kind key, "@" and the entry's id
// ("tracks:album@kite weather|orchard lamps"): its sort (with Reverse) is saved for it alone, in the
// "@" map of cp-list-opts, and a list with none of its own takes its kind's, so the sort saved before
// (per kind) stays as every entry's default. Zoom belongs to the kind (owner, 2026-11-26): zooming one
// album's songs zooms every album's, one artist page every artist page; a zoom an entry stored for
// itself before (zoom, zv in the "@" map) is dropped when read. The other options (Show Titles Only,
// Compact Header, Max Items …) stay per kind too. The "@" map keeps its entries in the order they
// were last used, and at most ENTRY_CAP of them: the least recently used go first. No DOM here.

export const ENTRY_MAP = '@';
export const ENTRY_CAP = 300;
/** The options an entry's list keeps for itself; the rest are its kind's. */
export const OWN_OPTS = ['sort'];
/** What an entry once kept for itself and no longer does (dropped on read). */
const STALE_OPTS = ['zoom', 'zv'];

const lc = s => String(s ?? '').toLowerCase();

/** An entry's stable id: a playlist's id, a folder's path, an album's name and artist, else its name. */
export function entryId(g) {
  if (!g) return '';
  if (g.pl?.id != null) return String(g.pl.id);
  if (g.path != null) return String(g.path);
  if (g.kind === 'album') return lc(g.title) + '|' + lc(g.artist);
  return lc(g.title);
}

/** An entry list's key (the kind key alone for no entry). */
export const entryKey = (key, g) => {
  const id = g && typeof g === 'object' ? entryId(g) : g == null ? '' : String(g);
  return id === '' ? key : key + '@' + id;
};

/** The kind key of a list key ("tracks:album@x" → "tracks:album"). */
export const baseKey = key => { const i = String(key).indexOf('@'); return i < 0 ? key : key.slice(0, i); };

const own = o => o && typeof o === 'object' && !Array.isArray(o) ? o : null;
const copy = o => o ? {...o} : null;

/** A list's options from the stored map: its kind's, with its own sort over them. */
export function readOpts(all, key) {
  const base = baseKey(key), kind = own(all?.[base]) ?? {};
  if (base === key) return kind;
  const mine = own(own(all?.[ENTRY_MAP])?.[key]);
  if (!mine) return kind;
  const out = {...kind};
  for (const k of OWN_OPTS) if (mine[k] !== undefined) out[k] = mine[k];
  return out;
}

/**
 * Drops what entries stored for themselves before zoom went back to the kind (in place): true when
 * something went (the caller stores the map again); an entry left with nothing goes too.
 */
export function dropStale(all) {
  const map = own(all?.[ENTRY_MAP]);
  if (!map) return false;
  let changed = false;
  for (const [key, o] of Object.entries(map)) {
    if (!own(o)) continue;
    for (const k of STALE_OPTS) if (k in o) { delete o[k]; changed = true; }
    if (!Object.keys(o).length) { delete map[key]; changed = true; }
  }
  return changed;
}

/**
 * What is stored for this key, for putting back: a kind key's options; for an entry, its own options
 * and its kind's ({kind, mine}), since a zoom changed from an entry's list is its kind's.
 */
export function ownOpts(all, key) {
  const base = baseKey(key);
  if (base === key) return copy(own(all?.[key]));
  return {kind: copy(own(all?.[base])), mine: copy(own(own(all?.[ENTRY_MAP])?.[key]))};
}

function entries(all) {
  if (!own(all[ENTRY_MAP])) all[ENTRY_MAP] = {};
  return all[ENTRY_MAP];
}

/** Keeps the map to ENTRY_CAP entries, dropping the least recently used (the first). */
function trim(map, cap) {
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - cap; i++) delete map[keys[i]];
}

/**
 * Saves a patch for a list into the stored map (in place; returns it): an entry's sort as its own
 * (undefined removes it), the rest (zoom too) on its kind. The entry becomes the most recently used.
 */
export function writeOpts(all, key, patch, cap = ENTRY_CAP) {
  const base = baseKey(key);
  const kindPatch = {}, ownPatch = {};
  for (const [k, v] of Object.entries(patch ?? {})) (base !== key && OWN_OPTS.includes(k) ? ownPatch : kindPatch)[k] = v;
  if (base === key || Object.keys(kindPatch).length) {
    const o = {...(own(all[base]) ?? {}), ...kindPatch};
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    all[base] = o;
  }
  if (base !== key && Object.keys(ownPatch).length) {
    const map = entries(all), o = {...(own(map[key]) ?? {}), ...ownPatch};
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    delete map[key];
    if (Object.keys(o).length) map[key] = o;
    trim(map, cap);
  }
  return all;
}

/** Puts back what ownOpts read (null: nothing stored). */
export function putOpts(all, key, saved) {
  const base = baseKey(key);
  const put = (k, o) => { if (o) all[k] = {...o}; else delete all[k]; };
  if (base === key) { put(key, saved); return all; }
  put(base, saved?.kind);
  const map = entries(all), mine = saved?.mine;
  delete map[key];
  if (mine && Object.keys(mine).length) map[key] = {...mine};
  return all;
}

/** Marks an entry's own options as just used (moved last); false when nothing changed. */
export function touchOpts(all, key) {
  const map = own(all?.[ENTRY_MAP]);
  if (baseKey(key) === key || !map?.[key]) return false;
  const keys = Object.keys(map);
  if (keys[keys.length - 1] === key) return false;
  const o = map[key];
  delete map[key];
  map[key] = o;
  return true;
}
