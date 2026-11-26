// The v2 Library (switch.js): one screen. Under the library's own title header (scene_top_header):
// a bar (library-bar.js) of the kind chips (Playlists, Albums, Artists, Songs, Folders) and the sort
// line (Recent, Name, Added and the list or grid toggle). Under it the existing list of that kind, in
// place, with its rows, rail, menu (List Options), hold to select and levels as they are. Playlists
// starts with Liked songs (the songs rated like) and All music (All Songs), then the owner's playlists,
// the most recent first. The sort and the view are the lists' own List Options values (list-opts.js),
// so pinch zoom, the toggle and List Options change the same one; "Recent", which List Options has no
// sort for (but for songs: by played at), orders by the last song played, a playlist by the later of
// that and its last change (rules.js), and is kept beside them (v2recent).
import {categorySource, homeCategory, playlistsSource, allSongsSource, groupMeta, plural} from '../list/sources.js';
import {applyZoom, listOpts, openListOptions, saveListOpts, SORTS as SORT_TABLE, REVERSE} from '../list/list-opts.js';
import './library-bar.js';
import {likedSource} from './lists.js';
import {likedSongs, playlistRecent, lastPlayOf} from './rules.js';
import {WORDS} from './switch.js';

export const LIBRARY_CHIPS = [
  {id: 'playlists', title: WORDS.playlists}, {id: 'albums', title: WORDS.albums}, {id: 'artists', title: WORDS.artists},
  {id: 'songs', title: WORDS.songs}, {id: 'folders', title: WORDS.folders},
];

// Per kind: its List Options key, the sort values Recent / Name / Added stand for (null: by last played,
// kept as v2recent), and the zoom levels of the list and grid views.
const KINDS = {
  playlists: {key: 'cat:playlists', sorts: {recent: null, name: 0, added: 1}, list: 0, grid: 5, make: (c, l, n) => playlistsSource(c, l, n)},
  albums: {key: 'cat:albums', sorts: {recent: null, name: 0, added: 2}, list: 0, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(3))},
  artists: {key: 'cat:artists', sorts: {recent: null, name: 0, added: 1}, list: 4, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(4))},
  songs: {key: 'tracks:all', sorts: {recent: 7, name: 1, added: 12}, list: 3, grid: 2, make: (c, l, n) => allSongsSource(c, l, n)},
  folders: {key: 'cat:folders', sorts: {recent: null, name: 0, added: 2}, list: 0, grid: 5, make: (c, l, n) => categorySource(c, l, n, homeCategory(1))},
};
const SORTS = ['recent', 'name', 'added'];

// Recent: a playlist's change or its songs' last play (rules.js), anything else its songs' last play.
const recentOf = g => (g.pl ? playlistRecent(g.pl, g.tracks ?? []) : lastPlayOf(g.tracks ?? []));

/** The sort the kind's saved options stand for: recent, name, added, or null (another List Options sort). */
function sortNow(kind) {
  const k = KINDS[kind], o = listOpts(k.key);
  // (Recent stands while the List Options sort is the one it was chosen over: a sort chosen there since wins.)
  if (o.v2recent && (o.sort ?? null) === (o.v2recentAt ?? null)) return 'recent';
  // Playlists, never sorted by the owner, show the most recent first.
  if (o.sort === undefined) return kind === 'playlists' ? 'recent' : 'name';
  return SORTS.find(id => k.sorts[id] === o.sort) ?? null;
}

/** A sort List Options chose that is none of the three: its own name there. */
function sortLabel(ctx, src) {
  const t = SORT_TABLE[src.sortKind]?.find(x => x.value === ((src.sortValue ?? 0) & ~REVERSE));
  return (t && ctx.res.stringByName(t.label)) || WORDS.name;
}

export function librarySource(ctx, list, nav, chip = ctx.libraryChip ?? 'playlists') {
  const kind = KINDS[chip] ? chip : 'playlists', k = KINDS[kind];
  const sub = list.host.substyle, dp = n => Math.round(n * ctx.dpr);
  const sort = sortNow(kind), o = listOpts(k.key);
  const src = k.make(ctx, list, nav);
  // Playlists show as a list until the owner picks a view.
  if (kind === 'playlists' && o.zoom === undefined) applyZoom(src, sub, src.zoomKind, k.key, k.list);
  if (sort === 'recent' && k.sorts.recent === null && src.groups) {
    const at = new Map(src.groups.map(g => [g, recentOf(g)]));
    src.groups = [...src.groups].sort((a, b) => at.get(b) - at.get(a));
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
    sortTitle: sort ? WORDS[sort] : sortLabel(ctx, src),
    pick: id => {
      const lw = ctx.listWidget;
      if (id === kind) { lw?.libList.scrollTo(0); return; }
      ctx.homeTabs?.leaveChip('library', kind);
      ctx.libraryChip = id;
      lw?.replaceTop(librarySource(ctx, list, nav, id));
      lw?.libList.scrollTo(ctx.homeTabs?.chipScroll('library', id) ?? 0);
    },
    nextSort: () => {
      const id = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length], v2 = k.sorts[id];
      saveListOpts(k.key, v2 === null ? {v2recent: true, v2recentAt: listOpts(k.key).sort ?? null} : {sort: v2, v2recent: false});
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
  const lib = ctx.library, liked = likedSongs(lib.tracks);
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
    if (g?.v2 === 'liked') nav.open(likedSource(ctx, list, nav));
    else if (g?.v2 === 'all') nav.open(allSongsSource(ctx, list, nav));
    else click(i);
  };
}
