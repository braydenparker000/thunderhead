// A catalogue refresh keeps the owner where they are (owner 2026-11-25): before, every library change
// (bus_library) threw the list back to Home. Now each level of the navigation stack is made again from
// the new library in place, and the shown one keeps its place by its top row's song or group (not by
// pixels: rows may have come or gone above it). A level whose entry is gone (an album, artist, folder
// with none of its songs left) and those above it are left; the deepest level still there shows, at
// its own saved scroll. Home is always there.

const lc = s => String(s ?? '').toLowerCase();
// The library's named categories, by group kind (library.js).
const NAMED = {artist: 'artists', albumArtist: 'albumArtists', genre: 'genres', composer: 'composers'};
// What a level carries from how it was opened.
const CARRY = ['savedScroll', 'openedFrom', 'fromSearch', 'searchParent'];

/** A row's identity across a rebuild: its song, group, folder, subhead or home category. */
export function rowKey(src, i) {
  const r = src.pageRows?.[i] ?? src.rows?.[i];
  if (r) return r.sep != null ? 's:' + r.sep : r.track ? 't:' + r.track.id : r.group ? groupKey(r.group) : null;
  if (src.items) return src.items[i] ? 'c:' + src.items[i].id : null;
  if (src.folders) return i < src.folders.length ? 'f:' + src.folders[i].path : src.tracks?.[i - src.folders.length] ? 't:' + src.tracks[i - src.folders.length].id : null;
  if (src.groups) return src.groups[i] ? groupKey(src.groups[i]) : null;
  return src.tracks?.[i] ? 't:' + src.tracks[i].id : null;
}

const groupKey = g => ['g', g.kind, lc(g.artist), g.path ?? g.pl?.id ?? lc(g.title)].join('\u0000');

/** The list's top row now: its key and how far into it the list is scrolled (the header showing: pixels). */
export function topRow(list) {
  const s = list.source;
  if (!s?.count) return null;
  const g = list.geometry(), y = list.scrollY - g.headerH;
  if (y <= 0) return {key: null, y: list.scrollY};
  const i = Math.max(0, Math.min(s.count - 1, list.indexAtY(g, y)));
  return {key: rowKey(s, i), off: y - list.itemTop(g, i), y: list.scrollY};
}

/** Scrolls the list's (new) source so the same row is on top again; pixels when it is gone. */
export function restoreTop(list, top) {
  if (!top) return;
  const s = list.source;
  if (top.key != null) {
    for (let i = 0; i < s.count; i++) {
      if (rowKey(s, i) !== top.key) continue;
      const g = list.geometry();
      list.scrollTo(g.headerH + list.itemTop(g, i) + Math.min(top.off, list.itemHeightAt(g, i)));
      return;
    }
  }
  list.scrollTo(top.y);
}

/**
 * An entry's songs from the new library, in place on the group the level's rebuild holds: a named
 * category's entry (artist, genre, folder, year …) as the library groups it now, songs added since
 * included; an album (or one artist's share of it) the songs of it still there. False when none are.
 */
export function refreshGroup(lib, g) {
  if (!g?.tracks) return true;
  let tracks = null;
  if (NAMED[g.kind]) tracks = lib[NAMED[g.kind]]?.().find(x => lc(x.title) === lc(g.title))?.tracks ?? null;
  else if (g.kind === 'folder' && g.path != null) tracks = lib.folders?.().find(x => x.path === g.path)?.tracks ?? null;
  else if (g.kind === 'year') tracks = lib.tracks.filter(t => (t.year ? String(t.year) : 'Unknown year') === g.title);
  if (!tracks) {
    const shown = new Set(lib.tracks);
    tracks = g.tracks.map(t => lib.byId?.get(t.id)).filter(t => t && shown.has(t));
  }
  if (!tracks.length) return false;
  g.tracks = tracks;
  delete g._added;
  delete g._year;
  return true;
}

/** A level made again from the new library; null when what it shows is gone. */
export function rebuildLevel(ctx, src) {
  if (!src?.rebuild) return null;
  const lib = ctx.library;
  for (const g of [src.parentGroup, src.group]) if (g && !refreshGroup(lib, g)) return null;
  if (src.node && !src.isRoot && !lib.folderTree?.().nodes.has(src.node.path)) return null;
  let fresh = null;
  try { fresh = src.rebuild(); } catch { return null; }
  if (!fresh) return null;
  for (const k of CARRY) if (src[k] !== undefined) fresh[k] = src[k];
  return fresh;
}

/** The list widget's stack made again in place after a library change, the shown level where it was. */
export function keepPlace(lw) {
  const old = lw.stack, list = lw.libList;
  if (!old.length) return;
  const top = old[old.length - 1];
  const onList = list.source === top && !lw.searchShown;
  const at = onList ? topRow(list) : null;
  const stack = [];
  for (const src of old) {
    const fresh = rebuildLevel(lw.ctx, src);
    if (!fresh) break;
    stack.push(fresh);
  }
  const same = src => stack[old.indexOf(src)] ?? null;
  if (lw.startSource) lw.startSource = same(lw.startSource);
  if (lw.preparedLib) lw.preparedLib = same(lw.preparedLib);
  if (!stack.length) { lw.stack = []; if (lw.mode === 'list') lw.openHome(); return; }
  lw.stack = stack;
  if (!onList) return;
  const shown = stack[stack.length - 1];
  list.setSource(shown);
  if (stack.length === old.length) restoreTop(list, at);
  else list.scrollTo(shown.savedScroll ?? 0);
}
