// Per-list options (List Options and pinch zoom; owner audit 2026-11-26). A list kind's options are
// saved under its kind key in cp-list-opts ("cat:albums", "tracks:album", "sub:artist" …), as they
// always were. An entry's list (this album's songs, this artist's page, this playlist, this genre's
// albums, this folder …) has a key of its own, the kind key, "@" and the entry's id
// ("tracks:album@kite weather|orchard lamps"): its sort (with Reverse) and zoom are saved for it
// alone, in the "@" map of cp-list-opts, and a list with none of its own takes its kind's, so the
// options saved before (per kind) stay as every entry's default. The other options (Show Titles
// Only, Compact Header, Max Items …) stay per kind. The "@" map keeps its entries in the order they
// were last used, and at most ENTRY_CAP of them: the least recently used go first. No DOM here.

export const ENTRY_MAP = '@';
export const ENTRY_CAP = 300;
/** The options an entry's list keeps for itself; the rest are its kind's. */
export const OWN_OPTS = ['sort', 'zoom', 'zv'];

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

/** A list's options from the stored map: its kind's, with its own sort and zoom over them. */
export function readOpts(all, key) {
  const base = baseKey(key), kind = own(all?.[base]) ?? {};
  if (base === key) return kind;
  const mine = own(own(all?.[ENTRY_MAP])?.[key]);
  if (!mine) return kind;
  const out = {...kind};
  for (const k of OWN_OPTS) if (mine[k] !== undefined) out[k] = mine[k];
  // A zoom of its own is read with its own version (zv), never its kind's.
  if (mine.zoom !== undefined && mine.zv === undefined) delete out.zv;
  return out;
}

/** What is stored for this key itself (an entry's own options, or the kind's), for putting back. */
export function ownOpts(all, key) {
  const base = baseKey(key);
  const o = base === key ? own(all?.[key]) : own(own(all?.[ENTRY_MAP])?.[key]);
  return o ? {...o} : null;
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
 * Saves a patch for a list into the stored map (in place; returns it): an entry's sort and zoom
 * as its own (undefined removes one), the rest on its kind. The entry becomes the most recently used.
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

/** Puts back what ownOpts read (null: nothing of its own). */
export function putOpts(all, key, saved) {
  const base = baseKey(key);
  if (base === key) { if (saved) all[key] = {...saved}; else delete all[key]; return all; }
  const map = entries(all);
  delete map[key];
  if (saved && Object.keys(saved).length) map[key] = {...saved};
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
