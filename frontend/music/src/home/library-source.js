// The v2 Library (switch.js): one screen. Under the library's own title header (scene_top_header):
// a bar (library-bar.js) of the kind chips (Playlists, Albums, Artists, Songs, Folders) and the sort
// line (Recent, Name, Added and the list or grid toggle). Under it the existing list of that kind, in
// place, with its rows, rail, menu (List Options), hold to select and levels as they are. Playlists
// starts with Liked songs (the songs rated like) and All music (All Songs), then the owner's playlists,
// the most recently changed first. The sort and the view are the lists' own List Options values
// (list-opts.js); "Recent" of albums, artists and folders, which List Options has no sort for, orders by
// the last song played and is kept beside them (v2recent).
import {categorySource, homeCategory, playlistsSource, allSongsSource, groupMeta, plural} from '../list/sources.js';
import {applyZoom, listOpts, openListOptions, saveListOpts} from '../list/list-opts.js';
import './library-bar.js';
import {likedSource} from './home-source.js';
import {WORDS} from './switch.js';

export const LIBRARY_CHIPS = [
  {id: 'playlists', title: WORDS.playlists}, {id: 'albums', title: WORDS.albums}, {id: 'artists', title: WORDS.artists},
  {id: 'songs', title: WORDS.songs}, {id: 'folders', title: WORDS.folders},
];

// Per kind: its List Options key, the sort values Recent / Name / Added stand for (null: by last played,
// kept as v2recent), and the zoom levels of the list and grid views.
const KINDS = {
  playlists: {key: 'cat:playlists', sorts: {recent: 3, name: 0, added: 1}, list: 0, grid: 5, make: (c, l, n) => playlistsSource(c, l, n)},
  albums: {key: 'cat:albums', sorts: {recent: null, name: 0, added: 2}, list: 0, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(3))},
  artists: {key: 'cat:artists', sorts: {recent: null, name: 0, added: 1}, list: 4, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(4))},
  songs: {key: 'tracks:all', sorts: {recent: 7, name: 1, added: 12}, list: 3, grid: 2, make: (c, l, n) => allSongsSource(c, l, n)},
  folders: {key: 'cat:folders', sorts: {recent: null, name: 0, added: 2}, list: 0, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(1))},
};
const SORTS = ['recent', 'name', 'added'];

const lastOf = g => { let m = 0; for (const t of g.tracks ?? []) if ((t.lastPlayed || 0) > m) m = t.lastPlayed; return m; };

/** The sort the kind's saved options stand for: recent, name, added, or null (another List Options sort). */
function sortNow(kind) {
  const k = KINDS[kind], o = listOpts(k.key);
  if (o.v2recent) return 'recent';
  // Playlists, never sorted by the owner, show the most recent first.
  if (o.sort === undefined) return kind === 'playlists' ? 'recent' : 'name';
  return SORTS.find(id => k.sorts[id] === o.sort) ?? null;
}

export function librarySource(ctx, list, nav, chip = ctx.libraryChip ?? 'playlists') {
  const kind = KINDS[chip] ? chip : 'playlists', k = KINDS[kind];
  const sub = list.host.substyle, dp = n => Math.round(n * ctx.dpr);
  const sort = sortNow(kind), o = listOpts(k.key);
  const src = k.make(ctx, list, nav);
  // Playlists show as a list until the owner picks a view.
  if (kind === 'playlists' && o.zoom === undefined) applyZoom(src, sub, src.zoomKind, k.key, k.list);
  if (kind === 'playlists' && o.sort === undefined && src.groups) {
    src.groups.sort((a, b) => (b.pl?.modified ?? 0) - (a.pl?.modified ?? 0));
    src.sections = null;
  }
  if (sort === 'recent' && k.sorts.recent === null && src.groups) {
    src.groups = [...src.groups].sort((a, b) => lastOf(b) - lastOf(a));
    src.sections = null;
  }
  if (kind === 'playlists') withLikedAndAll(ctx, list, nav, src);
  src.title = WORDS.library;
  src.icon = null;
  // The tab's root: no "up" title over its header.
  src.backDecor = null;
  src.header = {type: 'text', scene: 'scene_top_header'};
  src.headerHeight = sub.dim('topTextHeaderSize', dp(76)) + ctx.windowInsets.top;
  src.bindHeader = v => {
    v.findViewById('title')?.setText(WORDS.library);
    v.findViewById('line2')?.setText('');
    v.track = null;
    v.findViewById('aa_image')?.setArt?.(null);
    v.findViewById('aa_image')?.setDrawable?.(null);
  };
  const grid = (src.columns ?? 1) > 1;
  const reopen = () => ctx.listWidget?.replaceTop(librarySource(ctx, list, nav, kind));
  src.subhead = {type: 'libraryBar', scene: null, height: dp(96)};
  src.bindSubhead = v => v.bindRow?.({
    chips: LIBRARY_CHIPS, active: kind, grid,
    sortTitle: WORDS[sort ?? 'name'] ?? WORDS.name,
    pick: id => { ctx.libraryChip = id; ctx.listWidget?.replaceTop(librarySource(ctx, list, nav, id)); ctx.listWidget?.libList.scrollTo(0); },
    nextSort: () => {
      const id = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length], v2 = k.sorts[id];
      saveListOpts(k.key, v2 === null ? {v2recent: true} : {sort: v2, v2recent: false});
      reopen();
    },
    options: () => openListOptions(ctx, k.make(ctx, list, nav), reopen),
    toggleView: () => { saveListOpts(k.key, {zoom: grid ? k.list : k.grid, ...(kind === 'songs' ? {zv: 2} : {})}); reopen(); },
  });
  src.isLibraryV2 = true;
  src.libraryChip = kind;
  src.rebuild = () => librarySource(ctx, list, nav, kind);
  return src;
}

/** Playlists' first rows: Liked songs (with its count) and All music (songs and albums), then the playlists. */
function withLikedAndAll(ctx, list, nav, src) {
  const lib = ctx.library, liked = lib.tracks.filter(t => t.rating === 5);
  const albums = lib.shelves?.().albums.length ?? 0;
  const lead = [];
  if (liked.length) lead.push({v2: 'liked', kind: 'playlist', title: WORDS.liked, tracks: liked});
  lead.push({v2: 'all', kind: 'playlist', title: WORDS.allMusic, tracks: lib.tracks, albums});
  const groups = (src.groups ?? []).filter(g => g.pl);
  src.groups = [...lead, ...groups];
  // An empty Playlists (its quiet line) now has rows.
  Object.defineProperty(src, 'count', {get: () => src.groups.length, configurable: true});
  src.typeAt = () => undefined;
  src.isSeparator = () => false;
  // Not playlists: a playlist's selection menu (rename, delete) is not for them.
  src.unselectable = i => !!src.groups[i]?.v2;
  src.sections = null;
  const bind = src.bindItem.bind(src), click = src.onItemClick.bind(src);
  src.bindItem = (v, i) => {
    const g = src.groups[i];
    if (!g?.v2) { bind(v, i); return; }
    const first = g.tracks.find(t => t.art || t.thumb || t.artId) ?? g.tracks[0];
    const albums = `${g.albums} ${g.albums === 1 ? 'album' : 'albums'}`;
    const meta = g.v2 === 'all' ? `${g.tracks.length} | ${albums}` : groupMeta(g);
    const line2 = g.v2 === 'all' ? `${plural(ctx, 'songs_d', g.tracks.length)} · ${albums}` : plural(ctx, 'songs_d', g.tracks.length);
    v.bind({id: 'v2:' + g.v2, group: true, title: g.title, artist: line2, meta, metaIcon: '?meta_songs_12dp', art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  src.onItemClick = i => {
    const g = src.groups[i];
    if (g?.v2 === 'liked') nav.open(likedSource(ctx, list, nav, g.tracks));
    else if (g?.v2 === 'all') nav.open(allSongsSource(ctx, list, nav));
    else click(i);
  };
}
