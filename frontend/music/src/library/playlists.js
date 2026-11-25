// User playlists, kept in the library's state store (pl:<id>): name, track
// ids in order, created and modified times. New playlists are named by the
// owner, "Playlist N" (playlist_root_word) offered; a name is trimmed, at most
// NAME_MAX characters, and one already in use takes " 2", " 3"… (owner,
// 2026-11-25). Adding follows the insert position (top, bottom, shuffled into
// the list); duplicates are added unless told to skip them (the Add to
// Playlist dialog asks, or skips with pl_no_dups). Removing and clearing
// return what went and a deleted playlist can be restored, so an Undo puts
// them back. Playlists imported from files keep the file name (path) and may
// hold unresolved entries (path:<path>, playlist-files.js) that do not play.

import {autoResolve, UNRESOLVED} from './playlist-files.js';

export const INSERT_BOTTOM = 0, INSERT_TOP = 1, INSERT_SHUFFLED = 2;
export const SORT_NAME = 0, SORT_ADDED = 0x40000001, SORT_NUM_TRACKS = 0x40000002, SORT_MODIFIED = 0x40000003;
export const NAME_MAX = 100;
// Names in use are compared without letter case or accents.
const SAME = new Intl.Collator(undefined, {sensitivity: 'base'});

export class Playlists {
  constructor(ctx, library) {
    this.ctx = ctx;
    this.library = library;
    this.items = [];
    ctx.playlists = this;
    // pl_auto_resolve: a changed library resolves waiting entries again.
    ctx.bus.subscribe('bus_library', () => { if (this.items.length) autoResolve(ctx); });
  }

  async load() {
    const db = this.library.db;
    if (!db?.stateEntries) return;
    const rows = await db.stateEntries('pl:').catch(() => []);
    this.items = rows.map(([, v]) => v).filter(p => p && p.id && Array.isArray(p.ids));
    this.changed();
  }

  changed(pl = null) {
    this.ctx.bus.post('bus_data', 'msg_playlists_changed', this, {playlist: pl});
  }

  save(pl) {
    pl.modified = Date.now();
    this.library.db?.setState('pl:' + pl.id, pl).catch(() => {});
    this.changed(pl);
  }

  sorted(mode = SORT_NAME) {
    const list = [...this.items];
    if (mode === SORT_ADDED) return list.sort((a, b) => b.created - a.created);
    if (mode === SORT_MODIFIED) return list.sort((a, b) => b.modified - a.modified);
    // As the rows count them: the songs in the library.
    if (mode === SORT_NUM_TRACKS) return list.sort((a, b) => this.count(b) - this.count(a));
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
  }

  get(id) {
    return this.items.find(p => p.id === id) ?? null;
  }

  /** The next free "Playlist N". */
  defaultName() {
    const root = this.ctx.res?.stringByName('playlist_root_word') ?? 'Playlist';
    let n = this.items.length + 1;
    while (this.nameUsed(`${root} ${n}`)) n++;
    return `${root} ${n}`;
  }

  /** Whether another playlist than `except` has the name. */
  nameUsed(name, except = null) {
    return this.items.some(p => p !== except && SAME.compare(p.name ?? '', name) === 0);
  }

  /**
   * A name as it is kept: trimmed, at most NAME_MAX characters, and one another playlist
   * than `except` has with " 2", " 3"… after it. Null for an empty name.
   */
  uniqueName(name, except = null) {
    const base = String(name ?? '').trim().slice(0, NAME_MAX).trim();
    if (!base) return null;
    if (!this.nameUsed(base, except)) return base;
    for (let n = 2; ; n++) {
      const tail = ' ' + n, out = base.slice(0, NAME_MAX - tail.length).trimEnd() + tail;
      if (!this.nameUsed(out, except)) return out;
    }
  }

  /** A new empty playlist with the name (made unique), else the next free "Playlist N". */
  create(name = null) {
    name = this.uniqueName(name) ?? this.defaultName();
    const now = Date.now();
    const pl = {id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, ids: [], created: now, modified: now};
    this.items.push(pl);
    this.save(pl);
    return pl;
  }

  rename(pl, name) {
    const next = this.uniqueName(name, pl);
    if (!next || next === pl.name) return;
    pl.name = next;
    this.save(pl);
  }

  remove(pl) {
    this.items = this.items.filter(p => p !== pl);
    this.library.db?.deleteState?.('pl:' + pl.id).catch?.(() => {});
    this.changed(pl);
  }

  /**
   * A deleted playlist back whole: the same record (id, name, songs, created), saved as a
   * change, so the sync sends it again and drops the deletion it had queued (th/music/sync.js).
   */
  restore(pl) {
    if (!pl || this.get(pl.id)) return;
    this.items.push(pl);
    this.save(pl);
  }

  /** How many of tracks the playlist already holds. */
  duplicates(pl, tracks) {
    const have = new Set(pl.ids);
    return tracks.filter(t => have.has(t.id)).length;
  }

  /**
   * Adds tracks at the insert position; returns how many were added. skipDups leaves out the
   * songs the playlist holds (pl_no_dups when not given).
   */
  add(pl, tracks, pos = INSERT_BOTTOM, {skipDups = this.ctx.settings?.pl_no_dups === true} = {}) {
    const have = new Set(pl.ids);
    const ids = tracks.map(t => t.id).filter(id => !skipDups || !have.has(id));
    if (!ids.length) return 0;
    if (pos === INSERT_TOP) pl.ids.unshift(...ids);
    else if (pos === INSERT_SHUFFLED) {
      for (const id of ids) pl.ids.splice(Math.floor(Math.random() * (pl.ids.length + 1)), 0, id);
    } else pl.ids.push(...ids);
    this.save(pl);
    return ids.length;
  }

  /** Removes the entries at indices; returns them as [index, id] in order (for putBack). */
  removeAt(pl, indices) {
    const drop = new Set(indices), gone = [];
    pl.ids.forEach((id, i) => { if (drop.has(i)) gone.push([i, id]); });
    if (!gone.length) return gone;
    pl.ids = pl.ids.filter((_, i) => !drop.has(i));
    this.save(pl);
    return gone;
  }

  /** The entries removeAt returned, each at its place again. */
  putBack(pl, gone) {
    if (!gone?.length) return;
    for (const [i, id] of gone) pl.ids.splice(Math.min(i, pl.ids.length), 0, id);
    this.save(pl);
  }

  /** The playlist's entries in a new order (drag reordering, Save this order). */
  reorder(pl, ids) {
    pl.ids = ids;
    this.save(pl);
  }

  move(pl, from, to) {
    const [id] = pl.ids.splice(from, 1);
    pl.ids.splice(to, 0, id);
    this.save(pl);
  }

  /** How many of the playlist's songs are in the library (what its rows count). */
  count(pl) {
    const byId = this.library.byId;
    let n = 0;
    for (const id of pl.ids) if (byId?.has(id)) n++;
    return n;
  }

  /** The playlist's tracks that are in the library (missing entries skipped). */
  tracksOf(pl) {
    const byId = this.library.byId;
    return pl.ids.map(id => byId.get(id)).filter(Boolean);
  }
}

/**
 * The rows of a playlist as shown: its entries in the library ({track, at: index in pl.ids}), in
 * its own order, or in a Re-Sort view's ({value, rank}: rank, Random's drawn places by song id;
 * otherwise sort(entries, value), resort-dialog.js resortEntries). Nothing stored changes.
 */
export function shownEntries(pl, byId, view = null, sort = null) {
  const entries = [];
  pl.ids.forEach((id, at) => { const track = byId?.get(id); if (track) entries.push({track, at}); });
  if (!view) return entries;
  const rank = view.rank, last = Number.MAX_SAFE_INTEGER;
  if (rank) return entries.sort((a, b) => (rank.get(a.track.id) ?? last) - (rank.get(b.track.id) ?? last));
  return sort?.(entries, view.value) ?? entries;
}

/** Save this order: the entries in the order shown (their indices), those not shown after them. */
export function orderShown(pl, entryIndex) {
  const shown = new Set(entryIndex);
  return [...entryIndex.map(i => pl.ids[i]), ...pl.ids.filter((_, i) => !shown.has(i))];
}
