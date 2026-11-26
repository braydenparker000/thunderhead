// Library list sources: the library home (category tiles) and category /
// track lists, with the reference's zoom-level geometry (pd.P0 / bk0.P0):
//   home, default (zoom 1): one column of textItemSize rows, scene_top_header header;
//   zoom 0: scene_grid, 2 columns
//   tracks/categories, zoom 0: scene_small, 1 column, itemSizeSmall rows
// Home categories follow the reference order and default visibility mask
// (library_lists = 1048511: all but "Albums by Artist"), without Streams and
// Bookmarks, which can hold nothing here.

const HOME = [
  {id: 0, title: 'all_songs', icon: '?all_songs', kind: 'all'},
  {id: 1, title: 'folders', icon: '?folders', kind: 'folders'},
  {id: 2, title: 'folders_hier', icon: '?folders_hier', kind: 'folders'},
  {id: 3, title: 'albums', icon: '?albums', kind: 'albums'},
  // Singles and Possible duplicates (owner 2026-11-21; library/shelves.js), icons of the same family.
  {id: 20, title: 'singles', icon: '@drawable/singles_colored', kind: 'singles'},
  {id: 4, title: 'artists', icon: '?artists', kind: 'artists'},
  {id: 5, title: 'album_artists', icon: '?album_artists', kind: 'albumArtists'},
  {id: 6, title: 'albums_by_artist', icon: '?albums_by_artist', kind: 'albums'},
  {id: 7, title: 'genres', icon: '?genres', kind: 'genres'},
  {id: 17, title: 'years', icon: '?years', kind: 'years'},
  {id: 8, title: 'composers', icon: '?composers', kind: 'composers'},
  {id: 9, title: 'playlists', icon: '?playlists', kind: 'playlists'},
  // Streams (18) and Bookmarks (19) can never hold anything here: not offered (owner, 2026-11-25),
  // and a saved mask with their bits shows nothing for them.
  {id: 10, title: 'queue', icon: '?queue', kind: 'queue'},
  {id: 11, title: 'most_played', icon: '?most_played', kind: 'mostPlayed'},
  {id: 13, title: 'top_rated', icon: '?top_rated', kind: 'topRated'},
  {id: 15, title: 'low_rated', icon: '?low_rated', kind: 'lowRated'},
  {id: 12, title: 'recently_played', icon: '?recently_played', kind: 'recentlyPlayed'},
  {id: 14, title: 'recently_added', icon: '?recently_added', kind: 'recent'},
  {id: 16, title: 'long_files', icon: '?long_files', kind: 'long'},
  {id: 21, title: 'possible_duplicates', icon: '@drawable/possible_duplicates_colored', kind: 'duplicates'},
];

/**
 * Singles' and Possible duplicates' badges: drawables made like the reference's category ones (a
 * tinted *_alt badge, icons.js), in tints its categories already use (raw files', bookmarks').
 */
function shelfIcons(res) {
  const d = res?.model?.drawables;
  if (!d || d.singles_colored) return;
  for (const [name, tint] of [['singles', '#ff6073ac'], ['possible_duplicates', '#ff5474db']]) {
    d[name + '_alt'] = d.albums_alt;
    d[name + '_colored'] = [[['bitmap', {'android:src': `@drawable/${name}_alt`, 'android:tint': tint}], 'sw2dp']];
  }
}
const DEFAULT_HOME_MASK = 1048511;
// Not rows of the home nor offered in its List Options (owner, 2026-11-26): the Queue and Recently played
// are Up next and History in the playing song's menu. Their lists still open (homeCategory: the player's
// source list, the v2 Home's "See all", a start category saved before).
const OFF_HOME = new Set(['queue', 'recentlyPlayed']);
// Notes under categories in List Options (th1.c()).
const HOME_HINTS = {album_artists: 'summary_album_artists', albums_by_artist: 'summary_albums_by_artists'};

/** A library category by id (library_home). */
export const homeCategory = id => HOME.find(c => c.id === id) ?? null;
import {applyZoom, homeMask, listOpts, REVERSE, zoomGeometry} from './list-opts.js';
import {baseKey, entryKey} from './entry-opts.js';
import {STAT_LISTS, statTracks} from './stat-lists.js';
import {albumRows, albumSongLine2, artistLine2, artistShelf, entryShelf, SHELF_WORDS} from '../library/shelves.js';
import {albumLabel, trackNumbers, trackTitle} from '../library/labels.js';
import {SEARCH_CATS, searchOrder} from '../widgets/search.js';
import {GONE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {searchHistory, removeSearch, clearSearchHistory} from '../library/search-history.js';
import {listKeyOf, categoryKey, KEEP_LIST, KEEP_TRACK} from '../library/list-memory.js';
import {smartSongs} from '/th/music/search.js';
import {letters, sectionsFor} from './sections.js';
import {resortEntries} from '../widgets/resort-dialog.js';
import {shownEntries} from '../library/playlists.js';
import {WORDS} from '../widgets/playlist-edit.js';
import {sortedSteps, sortedTracks} from './sort-cache.js';
import {SEARCH_TEXT} from './search-prep.js';
import {WORDS as QUEUE_WORDS} from '../widgets/up-next.js';

// The search categories after "All" (jj1.v1 order).
const SEARCH_KINDS = SEARCH_CATS.slice(1);

// Text order as the library's SQL collation: case-insensitive, digits by character ("Song D29" before "Song D3").
// One collator for all comparisons (localeCompare with options builds one per call).
const BASE = new Intl.Collator(undefined, {sensitivity: 'base'}), PLAIN = new Intl.Collator();
const cmpStr = (a, b) => BASE.compare(a ?? '', b ?? '');
const byTrackNo = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0);

/** Track orders by sort value (reference values; newest/most first for dates and counts). */
const TRACK_SORT = {
  0: (a, b) => (a.track || 0) - (b.track || 0) || cmpStr(a.title, b.title),
  13: (a, b) => byTrackNo(a, b) || cmpStr(a.title, b.title),
  1: (a, b) => cmpStr(a.title, b.title),
  2: (a, b) => cmpStr(a.fileName, b.fileName),
  14: (a, b) => cmpStr(a.path ?? a.fileName, b.path ?? b.fileName),
  8: (a, b) => cmpStr(a.artist, b.artist) || cmpStr(a.album, b.album) || byTrackNo(a, b),
  9: (a, b) => cmpStr(a.album, b.album) || byTrackNo(a, b),
  3: (a, b) => (a.year || 0) - (b.year || 0) || cmpStr(a.title, b.title),
  15: (a, b) => (a.year || 0) - (b.year || 0) || cmpStr(a.album, b.album) || byTrackNo(a, b),
  12: (a, b) => (b.added || 0) - (a.added || 0),
  4: (a, b) => (b.modified || b.added || 0) - (a.modified || a.added || 0),
  5: (a, b) => (b.rating || 0) - (a.rating || 0) || cmpStr(a.title, b.title),
  10: (a, b) => (a.durationMs || 0) - (b.durationMs || 0),
  7: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
  6: (a, b) => (b.plays || 0) - (a.plays || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0),
};

const gAdded = g => (g._added ??= Math.max(0, ...g.tracks.map(t => t.added || 0)));
const gYear = g => (g._year ??= Math.min(...g.tracks.map(t => t.year || 9999)));
// no_sort_field off (the default): album, artist, album artist and composer
// names sort without a leading "the", "a" or "an" (the library's sort fields).
const ARTICLE = /^(the|a|an)\s+/i;
const ARTICLE_KEYS = new Set(['cat:albums', 'cat:artists', 'cat:albumArtists', 'cat:composers', 'cat:albums_by_artist']);
// The second level's album lists sort like albums (te1).
const articled = key => ARTICLE_KEYS.has(baseKey(key)) || key.startsWith('sub:');
let articles = false;
const sortKey = s => (articles ? (s ?? '').replace(ARTICLE, '') : s);
const byName = (a, b) => cmpStr(sortKey(a.title), sortKey(b.title));
const GROUP_SORT = {
  0: byName,
  added: (a, b) => (b.pl?.created ?? gAdded(b)) - (a.pl?.created ?? gAdded(a)) || byName(a, b),
  // A playlist counts the songs its row counts (those in the library), not its entries.
  count: (a, b) => b.tracks.length - a.tracks.length || byName(a, b),
  year: (a, b) => gYear(a) - gYear(b) || byName(a, b),
  artist: (a, b) => cmpStr(sortKey(a.artist ?? a.tracks[0]?.artist), sortKey(b.artist ?? b.tracks[0]?.artist)) || byName(a, b),
  albumArtist: (a, b) => cmpStr(sortKey(a.tracks[0]?.albumArtist || a.tracks[0]?.artist), sortKey(b.tracks[0]?.albumArtist || b.tracks[0]?.artist)) || byName(a, b),
  modified: (a, b) => (b.pl?.modified ?? gAdded(b)) - (a.pl?.modified ?? gAdded(a)) || byName(a, b),
  pathCs: (a, b) => { const x = a.path ?? a.title, y = b.path ?? b.title; return x < y ? -1 : x > y ? 1 : 0; },
  path: (a, b) => cmpStr(a.path ?? a.title, b.path ?? b.title),
};
const GROUP_SORT_FOR = {
  albums: {0: '0', 3: 'artist', 1: 'year', 2: 'added', 4: 'count'},
  albumArtists: {0: '0', 3: 'albumArtist', 1: 'year', 2: 'added', 4: 'count'},
  names: {0: '0', 1: 'added', 2: 'count'},
  folders: {0: '0', 1: 'pathCs', 5: 'path', 2: 'added', 3: 'modified', 4: 'count'},
  playlists: {0: '0', 1: 'added', 3: 'modified', 2: 'count'},
  years: {0: '0', 1: 'added', 2: 'count'},
};

/**
 * Applies a list's saved options (List Options): zoom geometry and, with a
 * sort kind, the order of its rows and the rail's sections for that order
 * (sections.js). A list without a sort kind has no sections (the plain thumb)
 * unless it gives its own order's (Singles, Possible duplicates).
 */
export function withOptions(src, list, {key, zoomKind, sortKind = null, defaultSort = 0, defaultZoom = null}) {
  applyZoom(src, list.host.substyle, zoomKind, key, defaultZoom);
  if (!sortKind) return src;
  const value = listOpts(key).sort ?? defaultSort;
  src.sortKind = sortKind;
  src.sortValue = value;
  const v = value & ~REVERSE, rev = (value & REVERSE) !== 0;
  if (src.groups) {
    const cmp = GROUP_SORT[GROUP_SORT_FOR[sortKind]?.[v] ?? '0'] ?? byName;
    articles = articled(key) && !src.ctx?.pref?.('no_sort_field');
    try { src.groups = [...src.groups].sort(cmp); } finally { articles = false; }
    if (rev) src.groups.reverse();
    // The rail follows the sort field (without "the", "a", "an" where the sort leaves them out).
    src.sections = sectionsFor({group: GROUP_SORT_FOR[sortKind]?.[v] ?? '0', reversed: rev, articles: articled(key) && !src.ctx?.pref?.('no_sort_field'), yearTitles: sortKind === 'years'});
  } else if (src.tracks) {
    let t;
    if (v === 11) {
      t = [...src.tracks];
      for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    } else t = sortedTracks(src.tracks, v, TRACK_SORT[v] ?? TRACK_SORT[0]); // (a copy; the order kept per library)
    if (rev) t.reverse();
    src.tracks = t;
    src.sections = sectionsFor({value: v, reversed: rev});
  }
  return src;
}

function dims(list) {
  const sub = list.host.substyle;
  return {
    textItemSize: sub.dim('textItemSize', 0),
    compactTextItemSize: sub.dim('compactTextItemSize', 0),
    topTextHeaderSize: sub.dim('topTextHeaderSize', 0),
    textHeaderSize: sub.dim('textHeaderSize', 0),
    itemSizeSmall: sub.dim('itemSizeSmall', 0),
    itemSize: sub.dim('itemSize', 0),
    headerSize: sub.dim('headerSize', 0),
  };
}

function str(ctx, name, fallback = SHELF_WORDS[name] ?? name) {
  return ctx.res.stringByName(name, ctx.theme) ?? fallback;
}

/** A quantity string (plurals): "one" for 1, else "other", with %d filled in. */
export function plural(ctx, name, n) {
  const e = ctx.res.entry('plurals', name);
  const raw = (n === 1 ? e?.one : null) ?? e?.other ?? '%d';
  const text = ctx.res.string(raw, ctx.theme) ?? String(raw);
  return text.replace(/%d/g, String(n));
}

/** "m:ss" or "h:mm:ss" (the library's dur_meta). */
function durationMeta(ms) {
  const sec = Math.round((ms || 0) / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Category rows and entry headers (xc.e / mo1881 over the categories'
// columns; notebook F79): line 2 is the category's C0 column (an album's
// artist, a folder's parent; none for names and playlists), the meta its m0
// "files | duration" (albums add " | year"; playlists pad the bar with two
// spaces) after the meta icon (wa1.M): the songs icon, or a folder's /
// playlist's List Memory flags (F46; playlist rows show List Position only).
const META_ICONS = ['?meta_songs_12dp', '?keep_list_pos_12dp', '?keep_track_pos_12dp', '?keep_list_track_pos_12dp'];
const groupMs = g => g.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);

/** An album's year (album_year; none when no track has one). Inferred: the earliest. */
function albumYear(g) {
  let y = 0;
  for (const t of g.tracks) if (t.year && (!y || t.year < y)) y = t.year;
  return y;
}

export function groupMeta(g) {
  const n = g.tracks.length, dur = durationMeta(groupMs(g));
  if (g.pl) return `${n}  |  ${dur}`;
  const y = g.kind === 'album' ? albumYear(g) : 0;
  return `${n} | ${dur}` + (y ? ` | ${y}` : '');
}

/** The parent folder of a folder path (folders.parent_label). */
const parentLabel = path => (path ?? '').replace(/\/+$/, '').split('/').slice(0, -1).join('/');

function groupLine2(ctx, g) {
  if (g.kind === 'album') return g.byArtist ? g.artist : albumRowArtist(ctx, g);
  if (g.kind === 'folder') return parentLabel(g.path);
  return '';
}

/** The meta icon of a category row (rows: true) or entry header. */
function metaIconOf(ctx, g, rows) {
  let bits = ctx.listMemory?.flags(listKeyOf(g)) ?? 0;
  if (rows && g.pl) bits &= KEEP_LIST;
  return META_ICONS[bits];
}

/** The library home: category tiles. */
export class HomeSource {
  constructor(ctx, list, nav) {
    this.ctx = ctx;
    this.nav = nav;
    shelfIcons(ctx.res);
    const mask = homeMask(+(ctx.settings.library_lists ?? DEFAULT_HOME_MASK));
    // Possible duplicates shows only when there are any.
    this.items = HOME.filter(c => !OFF_HOME.has(c.kind) && (mask & (1 << c.id)) !== 0 && (c.kind !== 'duplicates' || ctx.library?.shelves?.().duplicates.length));
    const d = dims(list);
    // The header's title (bk0: the Library string).
    this.title = str(ctx, 'library');
    this.itemType = 'text';
    this.itemScene = 'scene_grid';
    this.columns = 2;
    this.itemHeight = d.textItemSize;
    this.header = {type: 'text', scene: 'scene_top_header'};
    // The home's toolbar has only its menu (bk0: no songs of its own to play or select).
    this.menuOnlyToolbar = true;
    // addStatusBarHeightToHeaders: the header grows by the top inset.
    this.headerHeight = d.topTextHeaderSize + ctx.windowInsets.top;
    // No stored zoom: bk0.P0's default case, one column of textItemSize rows (level 1).
    withOptions(this, list, {key: 'home', zoomKind: 'home', defaultZoom: 1});
    this.homeCategories = HOME.filter(c => !OFF_HOME.has(c.kind)).map(c => ({...c, hint: HOME_HINTS[c.title] ?? null}));
    this.rebuild = () => new HomeSource(ctx, list, nav);
    // The library's home: Music's "tonight" card shows over it (th/music/tonight.js).
    this.home = true;
  }

  get count() { return this.items.length; }

  get menuLayout() { return 'merge_menu_items_lib'; }

  bindHeader(v) {
    v.findViewById('title')?.setText(this.title);
    v.findViewById('line2')?.setText('');
    v.track = null;
    v.findViewById('aa_image')?.setArt?.(null);
    v.findViewById('aa_image')?.setDrawable?.(null);
  }

  bindItem(v, i) {
    const c = this.items[i];
    v.findViewById('title')?.setText(str(this.ctx, c.title));
    v.findViewById('line2')?.setText('');
    // The row shows its category icon: no track's cover (nor one still loading for it).
    v.track = null;
    const icon = v.findViewById('aa_image');
    icon?.setArt?.(null);
    icon?.setDrawable?.(this.ctx.drawables.fromValue(c.icon, this.ctx.theme));
  }

  onItemClick(i) {
    this.nav.open(categorySource(this.ctx, this.nav.list, this.nav, this.items[i]));
  }
}

function groupsFor(lib, kind) {
  switch (kind) {
    // What an album is (shelves.js isAlbum), everywhere: a tagged release of ALBUM_MIN songs or more.
    case 'albums': return lib.shelves().albums;
    case 'artists': return lib.artists();
    case 'albumArtists': return lib.albumArtists();
    case 'genres': return lib.genres();
    case 'years': return group(lib.tracks, t => (t.year ? String(t.year) : 'Unknown year'), 'year');
    case 'composers': return lib.composers();
    case 'folders': return lib.folders();
    default: return null;
  }
}

function group(tracks, keyOf, kind) {
  const map = new Map();
  for (const t of tracks) {
    const k = keyOf(t);
    (map.get(k) ?? map.set(k, {kind, title: k, tracks: []}).get(k)).tracks.push(t);
  }
  return [...map.values()].sort((a, b) => PLAIN.compare(a.title, b.title));
}

// Statistics lists (from play counts, play times and ratings; like = 5, unlike = 1): stat-lists.js
// holds their filters, rankings and the rule of where Max Items cuts.
// Long Files: at least long_files_min_duration (15 minutes from the first run).
const DEFAULT_LONG_MS = 900000;

// Sort kinds and default track orders of the categories.
const GROUP_SORT_KIND = {albums: 'albums', artists: 'names', albumArtists: 'names', genres: 'names', composers: 'names', years: 'years', folders: 'folders'};
const TRACKS_DEFAULT_SORT = {all: 1, recent: STAT_LISTS.recent.sort, long: 10, mostPlayed: STAT_LISTS.mostPlayed.sort, recentlyPlayed: STAT_LISTS.recentlyPlayed.sort, topRated: STAT_LISTS.topRated.sort, lowRated: STAT_LISTS.lowRated.sort, album: 13, artist: 9, albumArtist: 9, genre: 8, composer: 8, year: 15, folder: 2};

/** All Songs' order made ahead, as steps (list/sort-cache.js; the list widget's idle preparing, a refreshed library's). */
export function allSongsOrderSteps(ctx, tracks = ctx.library?.tracks) {
  const v = (listOpts('tracks:all').sort ?? TRACKS_DEFAULT_SORT.all) & ~REVERSE;
  return v === 11 || !tracks ? null : sortedSteps(tracks, v, TRACK_SORT[v] ?? TRACK_SORT[0]);
}

/** The All Songs list (the source list of a queue that came from no list). */
export function allSongsSource(ctx, list, nav) {
  return categorySource(ctx, list, nav, HOME[0]);
}

export function categorySource(ctx, list, nav, cat) {
  const lib = ctx.library;
  shelfIcons(ctx.res);
  const title = str(ctx, cat.all ? 'all_artists' : cat.title);
  const tracks = (tracksIn, kind) => withOptions(new TrackSource(ctx, list, nav, title, tracksIn), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  let src;
  if (cat.kind === 'all') src = tracks(lib.tracks, 'all');
  else if (cat.kind === 'queue') {
    src = withOptions(new TrackSource(ctx, list, nav, title, [...(ctx.player?.userQueue ?? [])]), list, {key: 'tracks:queue', zoomKind: 'tracks'});
    src.kind = 'queue';
    // The reference's own selection menu for the Queue (Delete removes entries, Clear Queue beside Info).
    Object.defineProperty(src, 'selectionLayout', {value: 'merge_selection_menu_queue_items'});
    reorderable(src, map => ctx.player?.reorderQueue(map));
    if (!src.tracks.length) emptyLine(src, QUEUE_WORDS.queueEmpty);
  }
  else if (STAT_LISTS[cat.kind]) {
    const stat = STAT_LISTS[cat.kind], pick = statTracks(lib.tracks, stat, listOpts('tracks:' + cat.kind));
    src = tracks(pick.tracks, cat.kind);
    // Sorted by its own ranking: shown as ranked (the sort would only re-order ties differently).
    if (pick.ranked) src.tracks = pick.tracks;
    src.limitable = true;
    src.limit = pick.limit;
    // (List Options shows Max Items as not applying while it is sorted another way: limitApplies.)
    src.statList = stat;
    src.clearable = !!stat.clearable;
  }
  else if (cat.kind === 'singles') {
    // Releases of one or two songs and songs with no album, by artist then title.
    src = withOptions(new TrackSource(ctx, list, nav, title, lib.shelves().singles), list, {key: 'tracks:singles', zoomKind: 'tracks'});
    src.sections = letters(t => t?.artist);
  }
  else if (cat.kind === 'duplicates') src = duplicatesSource(ctx, list, nav, title);
  else if (cat.kind === 'playlists') return playlistsSource(ctx, list, nav);
  else if (cat.title === 'albums_by_artist') src = albumsByArtistSource(ctx, list, nav, title);
  else if (cat.title === 'folders_hier') return folderLevelSource(ctx, list, nav, lib.hierRoot(), cat);
  else if (cat.kind === 'long') {
    const min = listOpts('tracks:long').minDurationMs ?? DEFAULT_LONG_MS;
    src = tracks(lib.tracks.filter(t => t.durationMs >= min), 'long');
    src.kind = 'long';
    src.minDurationMs = min;
  }
  else {
    // Albums lists albums (shelves.js); Artists those with a body of work, then "All artists".
    const shelf = cat.id === 3 ? lib.shelves().albums : cat.kind === 'artists' && !cat.all ? lib.shelves().artists : null;
    const groups = shelf ?? groupsFor(lib, cat.kind);
    src = groups
      ? withOptions(new GroupSource(ctx, list, nav, title, groups), list, {key: 'cat:' + cat.kind, zoomKind: 'groups', sortKind: GROUP_SORT_KIND[cat.kind] ?? 'names'})
      : new TrackSource(ctx, list, nav, title, []);
    src.groupKind = cat.kind;
    src.homeCat = {id: cat.id, title: cat.title, icon: cat.icon, kind: cat.kind, ...(cat.all ? {all: true} : {})}; // found again after a restart (category-ref.js)
    if (cat.kind === 'artists' && !cat.all) allArtistsRow(ctx, list, nav, src, cat);
  }
  src.icon = cat.icon;
  src.rebuild = () => categorySource(ctx, list, nav, cat);
  // kc / b32: the up-nav title over the text header names the library.
  src.backDecor = 'item_top_text_back_decor';
  return src;
}

/**
 * Artists' last row, "All artists (N)": it opens every artist (the list as it was before the
 * shelves); a search from Artists searches every artist.
 */
function allArtistsRow(ctx, list, nav, src, cat) {
  const n = src.groups.length, every = ctx.library.artists().length, allCat = {...cat, all: true};
  const bind = src.bindItem.bind(src), click = src.onItemClick.bind(src), tracksAt = src.tracksAt.bind(src), section = src.sectionTitle.bind(src);
  Object.defineProperty(src, 'count', {get: () => n + 1});
  src.bindItem = (v, i) => (i < n ? bind(v, i) : v.bind({id: 'all_artists', group: true, title: `${str(ctx, 'all_artists')} (${every})`, artist: '', meta: '', metaIcon: null}));
  src.onItemClick = i => (i < n ? click(i) : nav.open(categorySource(ctx, list, nav, allCat)));
  src.tracksAt = i => (i < n ? tracksAt(i) : []);
  src.sectionTitle = i => (i < n ? section(i) : '');
  src.searchAll = () => categorySource(ctx, list, nav, allCat);
}

/**
 * Rows with subheads between them (item_separator_button, the search's section rows): each row is
 * {sep} or a song or entry row; the source's own bind, click and songs serve the others (by `at`).
 */
function sectioned(ctx, list, src, rows, {bind, click, tracks}) {
  src.pageRows = rows;
  src.separators = rows.flatMap((r, i) => (r.sep != null ? [i] : []));
  src.separatorHeight = list.host.substyle.dim('separatorSize', dims(list).itemSizeSmall);
  Object.defineProperty(src, 'count', {get: () => rows.length});
  src.isSeparator = i => rows[i]?.sep != null;
  src.typeAt = i => (rows[i]?.sep != null ? 'separator' : undefined);
  src.sectionTitle = i => rows[i]?.sep ?? rows[i]?.track?.title ?? rows[i]?.group?.title;
  src.tracksAt = i => (!rows[i] || rows[i].sep != null ? [] : tracks(rows[i]));
  src.indexOfTrack = t => rows.findIndex(r => r.track?.id === t.id);
  src.bindItem = (v, i) => {
    const r = rows[i];
    if (r.sep != null) { v.findViewById('title')?.setText(r.sep); v.findViewById('line2')?.setVisibility(GONE); return; }
    bind(v, r);
  };
  src.onItemClick = i => { const r = rows[i]; if (r && r.sep == null) click(r); };
  return src;
}

/** Track rows of a sectioned track list: they bind, play and select as the list's own rows. */
function trackRows(ctx, list, src, rows) {
  const bind = src.bindItem.bind(src), click = src.onItemClick.bind(src);
  return sectioned(ctx, list, src, rows, {bind: (v, r) => bind(v, r.at), click: r => click(r.at), tracks: r => [r.track]});
}

/**
 * Possible duplicates: each group of songs with the same title and artist (shelves.js) under a
 * subhead "title · artist · N", its songs as ordinary rows whose second line tells them apart
 * (album · format · bitrate · length). Nothing is changed by the list itself.
 */
function duplicatesSource(ctx, list, nav, title) {
  const tracks = [], rows = [];
  for (const d of ctx.library.shelves().duplicates) {
    rows.push({sep: `${d.title} · ${d.artist || str(ctx, 'unknown_artist_name', 'Unknown artist')} · ${d.tracks.length}`});
    for (const t of d.tracks) { rows.push({track: t, at: tracks.length}); tracks.push(t); }
  }
  const src = withOptions(new TrackSource(ctx, list, nav, title, tracks), list, {key: 'tracks:duplicates', zoomKind: 'tracks'});
  // By title, as the groups are (shelves.js); a subhead counts under its first song.
  src.sections = letters(t => t?.title);
  src.rowLabels = t => ({line2: [albumLabel(ctx, t), t.format, t.bitrate ? t.bitrate + 'kbps' : '', t.durationMs ? durationMeta(t.durationMs) : ''].filter(Boolean).join(' · '), meta: ''});
  return trackRows(ctx, list, src, rows);
}

/** An album's artist on its page: the album artist, else its first song's artist. */
const pageArtist = g => g.artist || g.tracks.find(t => t.albumArtist)?.albumArtist || g.tracks[0]?.artist || '';

/** An album page's header meta: "year · N songs · length", leaving out what is unknown. */
function albumPageMeta(ctx, g) {
  const y = albumYear(g), ms = groupMs(g);
  return [y ? String(y) : '', plural(ctx, 'songs_d', g.tracks.length), ms ? durationMeta(ms) : ''].filter(Boolean).join(' · ');
}

/**
 * An album's page (owner 2026-11-21): the header names the album, its artist and "year · N songs ·
 * length"; rows show the track number, title and length, and a second line only for a song by
 * someone other than the album's artist (else the level's one-line scene, same height). In disc
 * order (the default) an album of several discs has a "Disc N" subhead before each.
 */
function albumPage(ctx, list, src, g) {
  const artist = pageArtist(g);
  src.rowLabels = t => {
    const n = trackNumbers(ctx, t, true), name = trackTitle(ctx, t);
    // No track_num_type set: the number leads the title (track_num_type 3's form).
    const title = !(+ctx.pref?.('track_num_type')) && t.track > 0 ? `${t.track}. ${name}` : n.title(name);
    return {title, line2: albumSongLine2(t, artist), meta: n.meta(t.durationMs ? durationMeta(t.durationMs) : ''), num: n.num};
  };
  if (src.sortValue !== 13) return src;
  const {tracks, rows} = albumRows(src.tracks);
  src.tracks = tracks;
  if (!rows.some(r => r.disc)) return src;
  const disc = str(ctx, 'disc', 'Disc');
  return trackRows(ctx, list, src, rows.map(r => (r.disc ? {sep: `${disc} ${r.disc}`} : r)));
}

/** Category header: title, second line and the category icon. */
function bindCategoryHeader(src, v, line2) {
  v.findViewById('title')?.setText(src.title);
  v.findViewById('line2')?.setText(line2);
  v.findViewById('aa_image')?.setDrawable?.(src.icon ? src.ctx.drawables.fromValue(src.icon, src.ctx.theme) : null);
}

/**
 * An album row's artist (te1.C0): the album artist with
 * use_albumartist_albums, else the artist of its tracks.
 */
function albumRowArtist(ctx, g) {
  const t = g.tracks[0];
  if (ctx.pref?.('use_albumartist_albums') && t?.albumArtist) return t.albumArtist;
  return t?.artist || ctx.res?.stringByName('unknown_artist_name') || 'Unknown artist';
}

/** A category's entries (albums, artists, ...) as track-item rows. */
export class GroupSource {
  constructor(ctx, list, nav, title, groups) {
    this.ctx = ctx;
    this.nav = nav;
    this.title = title;
    this.groups = groups;
    const d = dims(list);
    this.itemType = 'track';
    this.itemScene = 'scene_small';
    this.columns = 1;
    this.itemHeight = d.itemSizeSmall;
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
  }

  get count() { return this.groups.length; }

  get menuLayout() { return this.isPlaylists ? 'merge_menu_items_playlists' : 'merge_menu_items_lib'; }

  get selectionLayout() { return this.isPlaylists ? 'merge_selection_menu_playlist_items' : 'merge_selection_menu_list_items_w_aa'; }
  tracksAt(i) { return this.groups[i]?.tracks ?? []; }

  sectionTitle(i) { return this.groups[i]?.title; }

  bindHeader(v) {
    bindCategoryHeader(this, v, '');
  }

  bindItem(v, i) {
    const g = this.groups[i];
    const first = g.tracks[0];
    // Artists and All artists: "N albums · N songs" (shelves.js artistLine2).
    const line2 = this.groupKind === 'artists' && g.kind === 'artist' ? artistLine2(g.tracks, this.ctx.library.shelves().albumOf, n => plural(this.ctx, 'songs_d', n)) : groupLine2(this.ctx, g);
    v.bind({id: 'group:' + g.kind + ':' + (g.artist ?? '') + ':' + g.title, group: true, title: g.title, artist: line2, art: first?.art, thumb: first?.thumb, artId: first?.artId, meta: groupMeta(g), metaIcon: metaIconOf(this.ctx, g, true)});
  }

  onItemClick(i) {
    const g = this.groups[i];
    // he.a(): artists, album artists, genres, composers and years open the entry's albums (u3).
    if (ALL_SONGS[g.kind]) this.nav.open(subAlbumsSource(this.ctx, this.nav.list, this.nav, g, this.icon));
    else this.nav.open(groupTracksSource(this.ctx, this.nav.list, this.nav, g, this.icon, this.parentGroup ?? null));
  }
}

// The second level's "All ... Songs" row per category (df1 / qe1 / ig1 / ... F0()).
const ALL_SONGS = {artist: 'all_artist_songs', albumArtist: 'all_album_artist_songs', genre: 'all_genre_songs', composer: 'all_composer_songs', year: 'all_year_songs'};

/**
 * An entry's albums (u3 over re1, the 2nd level category): an "All <category>
 * Songs" row (allTracksSubheadSize, scene_1, "N songs") under the header,
 * then the albums holding the entry's tracks (each with those tracks; albums
 * as the shelves count them), sorted like albums (<category>_albums_sort),
 * and the entry's other songs under "Singles" as on an artist's page. Its
 * menu is the tracks menu (v3.n).
 */
class SubAlbumsSource extends GroupSource {
  get menuLayout() { return 'merge_menu_items_tracks'; }
}

export function subAlbumsSource(ctx, list, nav, g, icon) {
  if (g.kind === 'artist') return artistPage(ctx, list, nav, g, icon);
  const {albums, singles} = entryShelf(g.tracks, ctx.library.shelves().albumOf);
  const src = withOptions(new SubAlbumsSource(ctx, list, nav, g.title, albums), list, {key: entryKey('sub:' + g.kind, g), zoomKind: 'groups', sortKind: 'albums'});
  src.groupKind = 'albums';
  src.secondLevel = true;
  src.parentGroup = g;
  src.icon = icon;
  src.subhead = {type: 'track', scene: 'scene_1', height: list.host.substyle.dim('allTracksSubheadSize', 0)};
  src.bindSubhead = v => {
    const first = g.tracks.find(t => t.artId || t.art || t.thumb) ?? g.tracks[0];
    v.bind({id: 'all:' + g.kind + ':' + g.title, group: true, title: str(ctx, ALL_SONGS[g.kind]), artist: plural(ctx, 'songs_d', g.tracks.length), meta: '', art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  // u3.f(-103): the entry's own files list.
  src.onSubheadClick = () => nav.open(groupTracksSource(ctx, list, nav, g, icon));
  src.rebuild = () => subAlbumsSource(ctx, list, nav, g, icon);
  if (singles.length) {
    const bind = src.bindItem.bind(src), click = src.onItemClick.bind(src);
    gridThenSingles(ctx, list, nav, src, g, icon, singles, {bind: (v, r) => bind(v, r.at), click: r => click(r.at)});
    // The albums' sort field does not name the Singles rows (songs by title, under their own subhead):
    // the plain thumb, so the rail never shows sections the rows do not follow.
    src.sections = null;
  }
  // u3: the entry's header (scene_header_1, the parents being tg1); year
  // albums (ug1) take the human sizes, the others headerSize / compactHeaderSize.
  entryHeader(ctx, list, src, g, {scene1: true, human: g.kind === 'year', compactW: g.kind === 'year', backDecor: 'item_text_back_decor'});
  return src;
}

/**
 * An artist's page (owner 2026-11-21): the header names the artist with "N albums · N songs"; "All
 * Artist Songs" stays the first row; then the albums holding their songs (shelves.js) as covers in
 * the list's grid (this artist's sub:artist zoom), newest first, each with "year · N songs"; then a
 * "Singles" subhead and their other songs as rows (their All Artist Songs zoom), each with its
 * release's name.
 */
function artistPage(ctx, list, nav, g, icon) {
  const {albums, singles} = artistShelf(g.tracks, ctx.library.shelves().albumOf);
  const src = withOptions(new SubAlbumsSource(ctx, list, nav, g.title, albums), list, {key: entryKey('sub:artist', g), zoomKind: 'groups'});
  src.groupKind = 'albums';
  src.secondLevel = true;
  src.parentGroup = g;
  src.icon = icon;
  const sub = list.host.substyle;
  src.subhead = {type: 'track', scene: 'scene_1', height: sub.dim('allTracksSubheadSize', 0)};
  src.bindSubhead = v => {
    const first = g.tracks.find(t => t.artId || t.art || t.thumb) ?? g.tracks[0];
    v.bind({id: 'all:' + g.kind + ':' + g.title, group: true, title: str(ctx, ALL_SONGS[g.kind]), artist: plural(ctx, 'songs_d', g.tracks.length), meta: '', art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  src.onSubheadClick = () => nav.open(groupTracksSource(ctx, list, nav, g, icon));
  src.rebuild = () => subAlbumsSource(ctx, list, nav, g, icon);
  const words = a => [albumYear(a) ? String(albumYear(a)) : '', plural(ctx, 'songs_d', a.tracks.length)].filter(Boolean).join(' · ');
  gridThenSingles(ctx, list, nav, src, g, icon, singles, {
    bind: (v, r) => {
      const a = r.group, first = a.tracks.find(t => t.artId || t.art || t.thumb) ?? a.tracks[0];
      v.bind({id: 'artist_album:' + a.artist + ':' + a.title, group: true, title: a.title, artist: words(a), meta: '', metaIcon: null, art: first?.art, thumb: first?.thumb, artId: first?.artId ?? a.artId});
    },
    click: r => nav.open(groupTracksSource(ctx, list, nav, r.group, icon, g)),
  });
  const albumsWord = albums.length === 1 ? 'album' : 'albums';
  entryHeader(ctx, list, src, g, {scene1: true, backDecor: 'item_text_back_decor', meta: `${albums.length} ${albumsWord} · ${plural(ctx, 'songs_d', g.tracks.length)}`});
  return src;
}

/**
 * A page's albums as covers in the list's grid, then the entry's other songs under a "Singles"
 * subhead as rows (an artist's page; an album artist's, genre's, composer's or year's albums with
 * songs on no album), each with its release's name, at the zoom of the entry's songs list when that
 * is a one-column level. Header Play / Shuffle: every song of the entry, as All … Songs lists them.
 */
function gridThenSingles(ctx, list, nav, src, g, icon, singles, {bind, click}) {
  const albums = src.groups, sub = list.host.substyle;
  src.tracks = singles;
  src.play = shuffle => {
    const all = groupTracksSource(ctx, list, nav, g, icon).tracks, p = ctx.player;
    if (!all.length) return false;
    ctx.bus.post('bus_player_cmd', 'cmd_player_set_shuffle', src, {arg1: shuffle ? 2 : 0});
    p.setQueue(all, shuffle ? Math.floor(Math.random() * all.length) : 0, null);
    p.play();
    return true;
  };
  const rowsZoom = {};
  applyZoom(rowsZoom, sub, 'tracks', entryKey('tracks:' + g.kind, g));
  const rowGeo = rowsZoom.columns === 1 ? {scene: rowsZoom.itemScene, scene1: rowsZoom.itemScene1, itemHeight: rowsZoom.itemHeight} : zoomGeometry(sub, 'tracks', 3);
  src.gridEnd = albums.length;
  src.rowScene = rowGeo.scene;
  src.rowScene1 = rowGeo.scene1 ?? null;
  src.rowHeight = rowGeo.itemHeight;
  const rows = albums.map((a, at) => ({group: a, at}));
  if (singles.length) rows.push({sep: str(ctx, 'singles')}, ...singles.map((t, at) => ({track: t, at})));
  const playSong = TrackSource.prototype.onItemClick;
  return sectioned(ctx, list, src, rows, {
    bind: (v, r) => (r.track ? v.bind(r.track, false, false, {line2: r.track.album ? albumLabel(ctx, r.track) : ''}) : bind(v, r)),
    click: r => (r.track ? playSong.call(src, r.at) : click(r)),
    tracks: r => (r.track ? [r.track] : r.group.tracks),
  });
}

/**
 * Albums by Artist (ue1: the artist_albums table): one row per album and
 * artist (a track's artist, unsplit), the album with that artist's tracks;
 * album sorts (albums_by_artist_sort). A row opens those tracks (ve1).
 */
export function albumsByArtistSource(ctx, list, nav, title) {
  const unknown = ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
  const rows = [];
  for (const a of ctx.library.shelves().albums) {
    const byArtist = new Map();
    for (const t of a.tracks) {
      const name = t.artist || unknown, k = name.toLowerCase();
      let r = byArtist.get(k);
      if (!r) byArtist.set(k, r = {kind: 'album', byArtist: true, title: a.title, artist: name, artId: t.artId, tracks: []});
      r.tracks.push(t);
      r.artId ||= t.artId;
    }
    rows.push(...byArtist.values());
  }
  const src = withOptions(new GroupSource(ctx, list, nav, title, rows), list, {key: 'cat:albums_by_artist', zoomKind: 'groups', sortKind: 'albums'});
  src.groupKind = 'albumsByArtist';
  return src;
}

/** Tracks as rows; a tap plays from that track (List Item Action: play and go to main UI). */
export class TrackSource {
  constructor(ctx, list, nav, title, tracks) {
    this.ctx = ctx;
    this.nav = nav;
    this.title = title;
    this.tracks = tracks;
    const d = dims(list);
    this.itemType = 'track';
    this.itemScene = 'scene_small';
    this.columns = 1;
    this.itemHeight = d.itemSizeSmall;
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
  }

  get count() { return this.tracks.length; }

  get menuLayout() { return 'merge_menu_items_tracks'; }

  sectionTitle(i) { return this.tracks[i]?.title; }

  get selectionLayout() { return 'merge_selection_menu_list_tracks_items'; }
  tracksAt(i) { return this.tracks[i] ? [this.tracks[i]] : []; }

  bindHeader(v) {
    bindCategoryHeader(this, v, String(this.tracks.length));
  }

  bindItem(v, i) {
    const t = this.tracks[i];
    v.bind(t, !!this.numbered, !!this.albumArtistList, this.rowLabels?.(t) ?? null);
  }

  onItemClick(i) {
    const p = this.ctx.player;
    // An entry of the Queue: the Queue plays from it (and goes on through its entries), not a copy of it as another list.
    if (this.kind === 'queue' && p.playQueueAt?.(i, p.state === STATE_PLAYING)) {
      p.play();
      if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
      return;
    }
    // This list becomes the playing track's source list (album-art tap / swipe down).
    this.ctx.listWidget?.rememberQueueSource(this);
    const category = this.ctx.listWidget?.categoryFor(this) ?? null;
    // list_action_resets off: the playing track goes on in its new list.
    if (p.track && this.tracks[i] === p.track && !this.ctx.pref?.('list_action_resets')) p.adoptQueue(this.tracks, i, category);
    // A manual track change: it crossfades per fade_manual_advance while playing.
    else if (!p.selectInList(this.tracks, i, category)) p.setQueue(this.tracks, i, category, p.state === STATE_PLAYING);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }
}

const PAGE_ICON = {artist: '?artists', albumArtist: '?album_artists', genre: '?genres', composer: '?composers', year: '?years', album: '?albums', folder: '?folders'};
const NAMED_GROUPS = {artist: 'artists', albumArtist: 'albumArtists', genre: 'genres', composer: 'composers'};

/**
 * The page the library opens for a song's artist, album artist, genre, composer or year (the
 * entry's albums: an artist's page, …), album (its songs) or folder (the Folders list's), from the
 * library's own groups; null when the song is not in the library.
 */
export function libraryPageOf(ctx, list, nav, kind, t) {
  const lib = ctx.library;
  if (!t || !lib?.tracks?.includes(t)) return null;
  if (NAMED_GROUPS[kind]) {
    const groups = lib[NAMED_GROUPS[kind]]?.() ?? [];
    const first = (lib.namesOf?.(t, kind)?.names?.[0] ?? '').toLowerCase();
    const g = groups.find(x => x.title.toLowerCase() === first && x.tracks.includes(t)) ?? groups.find(x => x.tracks.includes(t));
    return g ? subAlbumsSource(ctx, list, nav, g, PAGE_ICON[kind]) : null;
  }
  if (kind === 'year') {
    const title = t.year ? String(t.year) : 'Unknown year';
    return subAlbumsSource(ctx, list, nav, {kind: 'year', title, tracks: lib.tracks.filter(x => (x.year ? String(x.year) : 'Unknown year') === title)}, PAGE_ICON.year);
  }
  const g = kind === 'album' ? lib.albums().find(a => a.tracks.includes(t)) : kind === 'folder' ? lib.folders().find(f => f.tracks.includes(t)) : null;
  return g ? groupTracksSource(ctx, list, nav, g, PAGE_ICON[kind]) : null;
}

/** The list row of a song on a page: its own row, else the row of the album or entry holding it. */
export function rowOfTrack(src, t) {
  if (!src || !t) return -1;
  const i = src.indexOfTrack ? src.indexOfTrack(t) : src.tracks?.findIndex(x => x.id === t.id) ?? -1;
  if (i >= 0) return i;
  const holds = g => !!g?.tracks?.some(x => x.id === t.id);
  if (src.pageRows) return src.pageRows.findIndex(r => holds(r.group));
  return src.groups?.findIndex(holds) ?? -1;
}

/**
 * The current track's artist / album / folder / genre / year (track menu actions, Info): the page
 * the library opens for it (libraryPageOf); a song not in the library (the play queue's) gets its
 * entry's songs from the queue as a track list.
 */
export function currentCategorySource(ctx, list, nav, kind, track = null) {
  const t = track ?? ctx.player?.track;
  if (!t) return null;
  const page = libraryPageOf(ctx, list, nav, kind, t);
  if (page) return page;
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player.queue;
  const key = {
    artist: x => x.artist || 'Unknown artist',
    album: x => (x.album || '') + '\u0000' + (x.albumArtist || x.artist || ''),
    folder: x => x.folder || '/',
    genre: x => x.genre || 'Unknown genre',
  }[kind];
  if (!key) return null;
  const k = key(t);
  const tracks = pool.filter(x => key(x) === k);
  const title = kind === 'album' ? t.album || 'Unknown album' : kind === 'folder' ? (k.split('/').pop() || k) : k;
  const src = withOptions(new TrackSource(ctx, list, nav, title, tracks), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  src.rebuild = () => currentCategorySource(ctx, list, nav, kind, t);
  // Track numbers belong to album and folder track lists (wf1 entities).
  src.numbered = kind === 'album' || kind === 'folder';
  const g = {kind, title, tracks, path: kind === 'folder' ? k : undefined, artist: kind === 'album' ? t.albumArtist || t.artist || '' : undefined};
  if (ALL_SONGS_CATEGORY[kind]) {
    entryHeader(ctx, list, src, g, {scene1: true, human: HUMAN_SONGS.has(kind), compactW: HUMAN_SONGS.has(kind)});
    src.backTitle = str(ctx, ALL_SONGS_CATEGORY[kind]);
  } else entryHeader(ctx, list, src, g, kind === 'album' ? {line2: pageArtist(g), meta: albumPageMeta(ctx, g)} : {});
  src.group = g;
  src.icon = {artist: '?artists', album: '?albums', folder: '?folders', genre: '?genres'}[kind];
  return kind === 'album' ? albumPage(ctx, list, src, g) : src;
}

/**
 * Search results for a query in a category: songs match title, artist or
 * album; other categories list matching groups (each opens its tracks).
 */
/** Search categories in chip order (the bits of the search mask). */
/**
 * The empty search: the search history (item_search_history rows) and, after
 * them, Clear Search History. A tap on a term searches it; its clear button
 * removes it.
 */
// The search list's header (merge_item_text_header, scene_search_header):
// searchHeaderSize (targetSearchHeaderSize when targeted) tall, under the
// search panel, with the list buttons at its foot and no title.
function searchHeader(ctx, list, src, targeted) {
  const sub = list.host.substyle, d = dims(list);
  src.header = {type: 'text', scene: 'scene_search_header'};
  src.isSearch = true;
  src.headerHeight = sub.dim(targeted ? 'targetSearchHeaderSize' : 'searchHeaderSize', d.textHeaderSize) + ctx.windowInsets.top;
}

function historySource(ctx, list, nav, title) {
  const terms = searchHistory();
  const src = new TrackSource(ctx, list, nav, title, []);
  searchHeader(ctx, list, src, false);
  src.isHistory = true;
  if (!terms.length) return src;
  const rerun = () => ctx.listWidget?.showSearch?.();
  const n = terms.length;
  Object.defineProperty(src, 'count', {get: () => n + 1});
  src.typeAt = i => (i < n ? 'history' : 'clearHistory');
  src.isSeparator = () => false;
  src.tracksAt = () => [];
  src.sectionTitle = i => terms[i] ?? '';
  src.selectable = false;
  src.bindItem = (v, i) => {
    const b = v.findViewById('line2');
    if (i < n) {
      v.findViewById('title')?.setText(terms[i]);
      b?.setText('');
      if (b && !b._clearIcon) { b._clearIcon = ctx.drawables.fromValue('?clear', ctx.theme); }
      b?.setDrawable?.(b._clearIcon);
      if (b) b.onClick = () => { removeSearch(terms[i]); rerun(); };
    } else {
      b?.setText(str(ctx, 'clear_search_history'));
      if (b) b.onClick = () => { clearSearchHistory(); rerun(); };
    }
  };
  src.onItemClick = i => { if (i < n) ctx.bus.post('list', 'cmd_list_search_text', src, {string: terms[i]}); };
  return src;
}

/**
 * Search (jj1 / kj1 / vo1; notebook F64): the categories the chips select, in
 * jj1.v1 order, each with its matches under a subheader row
 * (item_separator_button, separatorSize high) and sorted by its name, case
 * folded (COLLATE NOCASE). The query splits on whitespace, ":", "-" and "_";
 * every word must occur in the entry's fields joined together (l2.B: LIKE
 * %word% over field||field); more than 64 words find nothing. Fields:
 * Albums album and artist, All Songs title, album and artist (title only
 * with search_track_titles_only; the file name for the title with
 * title_filename), the others their name. Albums are the shelves' (shelves.js
 * isAlbum); a shorter release's songs are found as songs. Streams are not
 * offered (owner decision).
 */
// Search caches: items' lower-cased search texts, and the last query's hits per kind.
// (SEARCH_TEXT: made ahead in idle time too, list/search-prep.js.)
const LAST_SEARCH = {q: null, mode: -1, hits: null};

export function searchSource(ctx, list, nav, query, mask = -1, target = null) {
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player?.queue ?? [];
  const title = str(ctx, 'search', 'Search');
  // list_zoom_search (jj1): the six one-column levels of track lists; the
  // one-line scenes when the search covers one one-line category alone.
  const oneLine = target ? !!target.groups?.[0] && ONE_LINE_KINDS.has(target.groups[0].kind) : SEARCH_KINDS.filter((c, i) => mask & (1 << i)).every(c => ONE_LINE_KINDS.has(c.kind)) && SEARCH_KINDS.some((c, i) => mask & (1 << i));
  const bare = src => {
    searchHeader(ctx, list, src, !!target);
    const sub = list.host.substyle;
    applyZoom(src, sub, 'search', 'search');
    if (oneLine) { const g = zoomGeometry(sub, 'search', src.zoomLevel, true); src.itemScene = g.scene; src.itemHeight = g.itemHeight; }
    src.rebuild = () => searchSource(ctx, list, nav, query, mask, target);
    src.searchTarget = target;
    return src;
  };
  // At least two characters (one in a targeted search, or for Japanese,
  // Korean and Chinese); shorter, an untargeted search lists its history and
  // a targeted one nothing (kj1.B).
  const q = String(query ?? '').trim();
  const minLen = target || /^(ja|ko|zh)\b/i.test(globalThis.navigator?.language ?? '') ? 1 : 2;
  const words = q.split(/[\s:\-_]+/).filter(Boolean).map(w => w.toLowerCase());
  if (!words.length || q.length < minLen) return target ? bare(new TrackSource(ctx, list, nav, title, [])) : historySource(ctx, list, nav, title);
  if (words.length > 64 || (!target && !mask)) return bare(new TrackSource(ctx, list, nav, title, []));
  const has = (...fields) => { const s = fields.map(f => f ?? '').join('').toLowerCase(); return words.every(w => s.includes(w)); };
  const fileTitles = !!ctx.pref?.('title_filename'), titlesOnly = !!ctx.pref?.('search_track_titles_only');
  const fileName = t => { const p = t.fileName || t.path || ''; return p.slice(p.lastIndexOf('/') + 1); };
  const line1 = t => (fileTitles ? fileName(t) : t.title);
  // Each item's lower-cased search text is made once (per field set);
  // sorting compares precomputed keys.
  const mode = (fileTitles ? 1 : 0) | (titlesOnly ? 2 : 0);
  const textOf = (o, make) => {
    const c = SEARCH_TEXT.get(o);
    if (c?.mode === mode) return c.s;
    const v = make().toLowerCase();
    SEARCH_TEXT.set(o, {mode, s: v});
    return v;
  };
  const matches = s => words.every(w => s.includes(w));
  const byKey = (list, keyOf) => list.map(x => [(keyOf(x) ?? '').toLowerCase(), x]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[1]);
  const trackText = t => textOf(t, () => (titlesOnly ? line1(t) ?? '' : (line1(t) ?? '') + (t.album ?? '') + (t.artist ?? '')));
  const groupText = (g, withArtist) => textOf(g, () => (g.title ?? '') + (withArtist ? g.artist ?? '' : ''));
  // Typing on: a query that extends the last one narrows its hits (every
  // word of the longer query holds a word of the shorter one).
  const prev = LAST_SEARCH.mode === mode && LAST_SEARCH.q != null && q.toLowerCase().startsWith(LAST_SEARCH.q) ? LAST_SEARCH.hits : null;
  const hits = new Map();
  const narrow = (kind, all, text) => {
    // Only hits taken from this very list (the library's tracks or groups as now).
    const p = prev?.get(kind);
    const out = (p?.all === all ? p.out : all).filter(x => matches(text(x)));
    hits.set(kind, {all, out});
    return out;
  };
  const found = kind => {
    switch (kind) {
      // Better search (th/music/search.js): every hit kept, typos and accents forgiven, best first.
      case 'songs': return smartSongs(pool, q, byKey(narrow(kind, pool, trackText), line1), line1, titlesOnly);
      case 'albums': return byKey(narrow(kind, groupsFor(lib, 'albums') ?? [], g => groupText(g, true)), g => g.title);
      case 'playlists': return byKey((ctx.playlists?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: ctx.playlists.tracksOf(pl), pl})).filter(g => has(g.title)), g => g.title);
      default: return byKey(narrow(kind, lib?.tracks?.length ? groupsFor(lib, kind) ?? [] : [], g => groupText(g, false)), g => g.title);
    }
  };
  if (target) return bare(targetedRows(ctx, list, nav, title, target, {has, line1, titlesOnly}));
  const rows = [], separators = [];
  // Sections in the chosen category order (searchOrder); bit i stays category i.
  searchOrder().forEach(i => {
    const c = SEARCH_KINDS[i];
    if ((mask & (1 << i)) === 0) return;
    const kindHits = found(c.kind);
    if (!kindHits.length) return;
    separators.push(rows.length);
    rows.push({sep: str(ctx, c.title)});
    for (const h of kindHits) rows.push(c.kind === 'songs' ? {track: h} : {group: h, kind: c.kind});
  });
  Object.assign(LAST_SEARCH, {q: q.toLowerCase(), mode, hits});
  if (!rows.length) return bare(new TrackSource(ctx, list, nav, title, []));
  const src = bare(new GroupSource(ctx, list, nav, title, rows.filter(r => r.group).map(r => r.group)));
  src.rebuild = () => searchSource(ctx, list, nav, query, mask, target);
  const d = dims(list);
  src.rows = rows;
  src.separators = separators;
  src.separatorHeight = list.host.substyle.dim('separatorSize', d.itemSizeSmall);
  src.tracks = rows.filter(r => r.track).map(r => r.track);
  Object.defineProperty(src, 'count', {get: () => rows.length});
  src.isSeparator = i => !!rows[i]?.sep;
  src.typeAt = i => (rows[i]?.sep ? 'separator' : undefined);
  src.tracksAt = i => (rows[i]?.track ? [rows[i].track] : rows[i]?.group?.tracks ?? []);
  src.sectionTitle = i => rows[i]?.track?.title ?? rows[i]?.group?.title ?? rows[i]?.sep;
  const groupIndex = new Map(rows.filter(r => r.group).map((r, k) => [r, k]));
  const bindGroup = src.bindItem.bind(src), openGroup = src.onItemClick.bind(src);
  src.bindItem = (v, i) => {
    const r = rows[i];
    if (r.sep) { v.findViewById('title')?.setText(r.sep); v.findViewById('line2')?.setVisibility(GONE); return; }
    if (r.track) v.bind(r.track);
    else bindGroup(v, groupIndex.get(r));
  };
  // A tap on an entry opens it; a tap on a song plays the found songs from
  // it (vo1.f: the songs category filtered by the search).
  src.onItemClick = i => {
    const r = rows[i];
    if (!r || r.sep) return;
    if (r.group) { openGroup(groupIndex.get(r)); return; }
    ctx.player.setQueue(src.tracks, src.tracks.indexOf(r.track));
    ctx.player.play();
    if ((ctx.settings.list_item_action ?? 1) === 1) ctx.bus.post('bus_gui', 'cmd_nav_to_main', src);
  };
  return src;
}

/** Playlists category: each playlist (name, track count) opens its tracks. */
// One-line category types (tg1): their search rows take the one-line scenes.
const ONE_LINE_KINDS = new Set(['playlists', 'genres', 'years', 'composers', 'playlist', 'genre', 'year', 'composer']);

/**
 * A search within one list (targeted search, ste; vo1.T0 / kj1.B): the
 * list's own rows that match, in the list's own order. Folders Hierarchy
 * searches its subfolders (by name) and the songs directly in it, the songs
 * under a "Folder Songs" header (a header shows only before a second
 * category); a category list its entries (albums by album and artist); a
 * track list its songs. Each row is the target's own row: it binds, opens
 * and plays as in that list (a song plays the list from it).
 */
function targetedRows(ctx, list, nav, title, target, {has, line1, titlesOnly}) {
  const songHit = t => (titlesOnly ? has(line1(t)) : has(line1(t), t.album, t.artist));
  const cats = [];
  // A page with subheads (an album's discs, an artist's page, Possible duplicates): its own rows.
  if (target.pageRows) {
    cats.push({items: target.pageRows.flatMap((r, i) => (r.sep == null && (r.track ? songHit(r.track) : has(r.group.title)) ? [{...(r.track ? {track: r.track} : {group: r.group}), at: i}] : []))});
  } else if (target.folders) {
    cats.push({items: target.folders.flatMap((f, i) => (has(f.name) ? [{group: {tracks: subtreeFiles(f)}, at: i}] : []))});
    cats.push({title: str(ctx, 'folder_songs'), items: target.tracks.flatMap((t, k) => (songHit(t) ? [{track: t, at: target.folders.length + k}] : []))});
  } else if (target.groups) {
    cats.push({items: target.groups.flatMap((g, i) => (has(g.title, g.kind === 'album' || g.kind === 'albums' ? g.artist : '') ? [{group: g, at: i}] : []))});
  } else {
    cats.push({items: (target.tracks ?? []).flatMap((t, k) => (songHit(t) ? [{track: t, at: k}] : []))});
  }
  const rows = [], separators = [];
  cats.forEach((c, n) => {
    if (!c.items.length) return;
    if (n > 0 && c.title) { separators.push(rows.length); rows.push({sep: c.title}); }
    rows.push(...c.items);
  });
  const src = new GroupSource(ctx, list, nav, title, []);
  src.rows = rows;
  src.separators = separators;
  src.separatorHeight = list.host.substyle.dim('separatorSize', dims(list).itemSizeSmall);
  src.tracks = rows.filter(r => r.track).map(r => r.track);
  Object.defineProperty(src, 'count', {get: () => rows.length});
  src.isSeparator = i => !!rows[i]?.sep;
  src.typeAt = i => (rows[i]?.sep ? 'separator' : undefined);
  src.tracksAt = i => (rows[i]?.sep ? [] : target.tracksAt?.(rows[i].at) ?? []);
  src.sectionTitle = i => rows[i]?.sep ?? target.sectionTitle?.(rows[i].at);
  src.bindItem = (v, i) => {
    const r = rows[i];
    if (r.sep) { v.findViewById('title')?.setText(r.sep); v.findViewById('line2')?.setVisibility(GONE); return; }
    target.bindItem(v, r.at);
  };
  src.onItemClick = i => { const r = rows[i]; if (r && !r.sep) target.onItemClick(r.at); };
  return src;
}

export function playlistsSource(ctx, list, nav) {
  const P = ctx.playlists;
  const groups = (P?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: P.tracksOf(pl), pl}));
  const src = withOptions(new GroupSource(ctx, list, nav, str(ctx, 'playlists'), groups), list, {key: 'cat:playlists', zoomKind: 'groups', sortKind: 'playlists'});
  src.icon = '?playlists';
  src.isPlaylists = true;
  src.backDecor = 'item_top_text_back_decor';
  src.onItemClick = i => { const s2 = playlistSource(ctx, list, nav, src.groups[i]?.pl); if (s2) nav.open(s2); };
  src.rebuild = () => playlistsSource(ctx, list, nav);
  if (!groups.length) emptyLine(src, WORDS.noPlaylists);
  return src;
}

/**
 * A playlist's tracks in playlist order, or as Re-Sort shows them (view: {value, rank}, the sort
 * value and, for Random, each song's place), which changes nothing stored (owner, 2026-11-25).
 * Rows move by drag in the playlist's own order only. An empty playlist shows one quiet line.
 */
export function playlistSource(ctx, list, nav, pl, view = null) {
  const P = ctx.playlists;
  if (!P || !pl) return null;
  // Entries whose track left the library are skipped; entryIndex maps rows to entries.
  const entries = shownEntries(pl, ctx.library.byId, view, (e, value) => resortEntries(ctx, e, value));
  const tracks = entries.map(e => e.track), entryIndex = entries.map(e => e.at);
  // Playlist order (no sort options; zoom applies).
  const src = withOptions(new TrackSource(ctx, list, nav, pl.name, tracks), list, {key: entryKey('tracks:playlist', String(pl.id)), zoomKind: 'tracks'});
  src.icon = '?playlists';
  src.playlist = pl;
  src.entryIndex = entryIndex;
  src.view = view;
  // si1: under Playlists (tg1), title only; a tap on the title renames it.
  entryHeader(ctx, list, src, {kind: 'playlist', title: pl.name, tracks, pl}, {scene1: true});
  src.onTitleClick = () => ctx.bus.post('list', 'cmd_list_pl_rename', src, {});
  src.rebuild = () => playlistSource(ctx, list, nav, pl, src.view);
  if (!tracks.length) emptyLine(src, WORDS.empty);
  if (view) return src;
  // Rows move between the shown entries' places; missing entries stay put.
  reorderable(src, map => {
    const ids = pl.ids.slice();
    entryIndex.forEach((at, slot) => { ids[at] = pl.ids[entryIndex[map[slot]]]; });
    // The shown list already has the new order; it is not rebuilt.
    src.ownChange = true;
    P.reorder(pl, ids);
    src.ownChange = false;
  });
  return src;
}

/** An empty list's one row: a quiet line in the hint text (power-list.js EMPTY_ROW), not a song or an entry. */
function emptyLine(src, text) {
  const rows = () => src.groups ?? src.tracks;
  // (Configurable: the v2 Library's Playlists puts its own rows over an empty one, home/library-source.js.)
  Object.defineProperty(src, 'count', {get: () => rows().length || 1, configurable: true});
  src.typeAt = i => (rows().length || i !== 0 ? undefined : 'emptyLine');
  src.isSeparator = i => !rows().length && i === 0;
  const bind = src.bindItem.bind(src);
  src.bindItem = (v, i) => (src.isSeparator(i) ? v.findViewById('item_empty_list_text')?.setText(text) : bind(v, i));
  src.sectionTitle = i => rows()[i]?.title;
  // No rail over the line (a letter sort's column would stand beside nothing: power-list.js scrollerMode).
  if (!rows().length) src.sections = null;
}

/**
 * Drag reordering in selection mode (the playlist and queue lists, F59):
 * applyOrder(map) puts row map[slot] at each slot and stores the order.
 */
function reorderable(src, store) {
  src.reorderable = true;
  src.applyOrder = map => {
    const old = src.tracks;
    src.tracks = map.map(i => old[i]);
    store(map);
  };
}

/**
 * Entry headers (c32 / g32, u3, h60; notebook F79). A category entry's songs,
 * an entry's albums and a Folders Hierarchy folder show the track item as
 * their header: in scene_header the entry's art fills it with the title,
 * line 2 and meta (with its icon) at its foot; scene_header_1 (title only)
 * when the parent category is a "human" one (tg1: artists, album artists,
 * genres, composers, years, playlists). Height (g32.F0, u3.F0, h60.F0; plus
 * the top inset): headerSize, or humanCatHeaderSize (at most the list's
 * width) for the artist-like lists (gh1). Compact Header (xh1.W0) takes
 * compactHeaderSize, or compactHumanCatHeaderSize where the reference picks
 * it (compactW). Over it lies the back decor (backDecor): the up-nav title.
 */
function entryHeader(ctx, list, src, g, {scene1 = false, human = false, compactW = false, backDecor = 'item_back_decor', line2 = null, meta = null, metaIcon = null} = {}) {
  const sub = list.host.substyle, compact = !!src.compactHeader;
  const humanSize = Math.min(sub.dim('humanCatHeaderSize', 0), list.host.width || Infinity);
  const size = compact ? sub.dim(compactW ? 'compactHumanCatHeaderSize' : 'compactHeaderSize', 0) : human ? humanSize : sub.dim('headerSize', 0);
  src.header = {type: 'track', scene: scene1 ? 'scene_header_1' : 'scene_header'};
  src.headerHeight = size + ctx.windowInsets.top;
  src.compactable = true;
  src.backDecor = backDecor;
  // List Memory belongs to folders and playlists (jh1).
  src.memoryKey = listKeyOf(g);
  src.bindHeader = v => {
    const first = g.tracks.find(t => t.artId || t.art || t.thumb) ?? g.tracks[0];
    v.bind({id: 'hdr:' + g.kind + ':' + (g.path ?? g.pl?.id ?? g.artist ?? '') + ':' + g.title, group: true, title: g.title, artist: line2 ?? groupLine2(ctx, g), meta: meta ?? groupMeta(g), metaIcon: metaIcon ?? metaIconOf(ctx, g, false), art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  return src;
}

// The categories of the "All … Songs" lists (their back decor names them, df1.j0()).
const ALL_SONGS_CATEGORY = {artist: 'artists', albumArtist: 'album_artists', genre: 'genres', composer: 'composers', year: 'years'};
// gh1 lists: the artist-like entries' songs (df1, qe1, kf1) and albums of album artists and composers (pe1, jf1).
const HUMAN_SONGS = new Set(['artist', 'albumArtist', 'composer']);

/**
 * A category entry's tracks (album, artist, ...), with that list kind's
 * options; parentGroup is the entry whose albums list it came from.
 */
export function groupTracksSource(ctx, list, nav, g, icon, parentGroup = null) {
  const kind = g.kind ?? 'group';
  // This entry's own sort (its kind's until it has one) and its kind's zoom (entry-opts.js).
  const src = withOptions(new TrackSource(ctx, list, nav, g.title, g.tracks), list, {key: entryKey('tracks:' + kind, g), zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  src.icon = icon;
  src.group = g;
  src.rebuild = () => groupTracksSource(ctx, list, nav, g, icon, parentGroup);
  src.numbered = kind === 'album' || kind === 'folder';
  if (ALL_SONGS_CATEGORY[kind]) {
    // df1 / qe1 / ig1 / kf1 / zj1: under the category itself (tg1).
    const human = HUMAN_SONGS.has(kind);
    entryHeader(ctx, list, src, g, {scene1: true, human, compactW: human});
    src.backTitle = str(ctx, ALL_SONGS_CATEGORY[kind]);
  } else entryHeader(ctx, list, src, g, {human: !!parentGroup && (parentGroup.kind === 'albumArtist' || parentGroup.kind === 'composer'), ...(kind === 'album' ? {line2: pageArtist(g), meta: albumPageMeta(ctx, g)} : {})});
  src.albumArtistList = kind === 'albumArtist';
  return kind === 'album' ? albumPage(ctx, list, src, g) : src;
}

/**
 * Folders Hierarchy (h60, FoldersAndFilesPage over cg1; notebook F76). The
 * top level (the root, or with root_hier_immediate the first folder with
 * tracks or several subfolders) lists its subfolders; a folder lists its
 * subfolders (name, parent folder, "files | duration" of the whole subtree)
 * and then its own files. A subfolder opens the next level, a file plays the
 * folder with the hierarchy's folders as categories (in path order). With
 * hier_files_zoom a folder with files only takes the Folders files zoom
 * level. Header Play starts at the folder (or its first folder with files)
 * and, unless hier_no_advance, sets Play All Categories; header Shuffle with
 * hier_flat_shf shuffles every song of the subtree, else songs and
 * categories with the subtree's folders first (cg1.W).
 */
class FolderLevelSource {
  constructor(ctx, list, nav, node, cat) {
    this.ctx = ctx;
    this.nav = nav;
    this.node = node;
    this.cat = cat;
    const lib = ctx.library, tree = lib.folderTree();
    this.tree = tree;
    this.isRoot = node === lib.hierRoot();
    this.title = this.isRoot ? str(ctx, 'folders_hier') : node.name;
    this.folders = node.folders;
    const d = dims(list);
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
    this.backDecor = 'item_top_text_back_decor';
    this.itemType = 'track';
    this.icon = '?folders_hier';
    // hier_files_zoom (m30.k0): a folder with files only takes the folder files zoom.
    const {key, zoomKind} = hierOpts(ctx, node);
    // Its files in the level's own sort (List Options; file name by default), its folders by name.
    const files = withOptions({ctx, tracks: [...node.files]}, list, {key, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT.folder});
    this.tracks = files.tracks;
    this.numbered = true;
    applyZoom(this, list.host.substyle, zoomKind, key);
    this.sortKind = 'tracks';
    this.sortValue = files.sortValue;
    // h60.e0: a folder has the track header (headerSize / compactHeaderSize)
    // with the parent folder's name as its up-nav title (item_back_decor), or
    // under the top level the hierarchy's (item_text_back_decor).
    if (!this.isRoot) {
      const g = {kind: 'folder', title: node.name, path: node.path, tracks: subtreeFiles(node)};
      entryHeader(ctx, list, this, g, {backDecor: node.parent === lib.hierRoot() ? 'item_text_back_decor' : 'item_back_decor', line2: node.parent?.name ?? '', meta: hierMeta(node)});
    }
    // The top level stays the top level (root_hier_immediate may have moved it).
    this.rebuild = () => folderLevelSource(ctx, list, nav, (this.isRoot ? null : lib.folderTree().nodes.get(node.path)) ?? lib.hierRoot(), cat);
  }

  get count() { return this.folders.length + this.tracks.length; }

  get menuLayout() { return 'merge_menu_items_lib'; }

  get selectionLayout() { return 'merge_selection_menu_list_tracks_items'; }

  isFolder(i) { return i < this.folders.length; }

  indexOfTrack(t) {
    const i = this.tracks.findIndex(x => x.id === t.id);
    return i < 0 ? -1 : this.folders.length + i;
  }

  tracksAt(i) {
    if (!this.isFolder(i)) return this.tracks[i - this.folders.length] ? [this.tracks[i - this.folders.length]] : [];
    return subtreeFiles(this.folders[i]);
  }

  sectionTitle(i) {
    return this.isFolder(i) ? this.folders[i].name : this.tracks[i - this.folders.length]?.title;
  }

  bindHeader(v) {
    bindCategoryHeader(this, v, '');
  }

  bindItem(v, i) {
    if (this.isFolder(i)) {
      const f = this.folders[i], first = f.files[0] ?? subtreeFiles(f)[0];
      // h60: folder rows show the folder category icon (?folder_cat_icon) at their end.
      v.bind({id: 'hier:' + f.path, group: true, title: f.name, artist: f.parent?.name ?? '', meta: hierMeta(f), metaIcon: META_ICONS[this.ctx.listMemory?.flags('folder:' + f.path) ?? 0], catIcon: '?folder_cat_icon', art: first?.art, thumb: first?.thumb, artId: first?.artId});
    } else v.bind(this.tracks[i - this.folders.length], true, false);
  }

  onItemClick(i) {
    if (this.isFolder(i)) { this.nav.open(folderLevelSource(this.ctx, this.nav.list, this.nav, this.folders[i], this.cat)); return; }
    const p = this.ctx.player, k = i - this.folders.length;
    this.ctx.listWidget?.rememberQueueSource(this);
    const category = hierCategory(this, this.node);
    if (p.track && this.tracks[k] === p.track && !this.ctx.pref?.('list_action_resets')) p.adoptQueue(this.tracks, k, category);
    else if (!p.selectInList(this.tracks, k, category)) p.setQueue(this.tracks, k, category, p.state === STATE_PLAYING);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  /** Header Play (g0(0)) and Shuffle (g0(4) through h60.V). */
  play(shuffle) {
    const ctx = this.ctx, p = ctx.player, flat = !!ctx.pref?.('hier_flat_shf');
    const bus = (m, a) => ctx.bus.post('bus_player_cmd', m, this, {arg1: a});
    if (shuffle && flat) {
      // shs=h: every song of the subtree, shuffled.
      const all = subtreeFiles(this.node);
      if (!all.length) return false;
      bus('cmd_player_set_shuffle', 2);
      p.setQueue(all, Math.floor(Math.random() * all.length), null);
    } else {
      // cg1.M: the folder, or the next folder with files in path order.
      const order = this.tree.withFiles;
      const inside = order.filter(n => n === this.node || n.path.startsWith(this.node.path ? this.node.path + '/' : ''));
      if (!inside.length) return false;
      const start = shuffle ? inside[Math.floor(Math.random() * inside.length)] : inside[0];
      bus('cmd_player_set_shuffle', shuffle ? 4 : 0);
      // sd.g0(0): Play All Categories unless hier_no_advance (b40.W).
      if (!shuffle && !ctx.pref?.('hier_no_advance')) bus('cmd_player_set_repeat_mode', 2);
      const category = hierCategory(this, start);
      const tracks = category.source.tracksAt(category.index);
      const dflt = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
      p.setQueue(tracks, ctx.listMemory?.start(categoryKey(category), tracks, dflt) ?? dflt, category);
    }
    p.play();
    return true;
  }
}

/** A Folders Hierarchy level's options: its key (this folder's own, over its kind's) and zoom kind. */
function hierOpts(ctx, node) {
  const filesZoom = !node.folders.length && node.files.length > 0 && !!ctx.pref?.('hier_files_zoom');
  return {key: entryKey(filesZoom ? 'tracks:folder' : 'cat:folders_hier', node.path ?? ''), zoomKind: filesZoom ? 'tracks' : 'groups'};
}

function hierMeta(n) {
  return `${n.hierFiles} | ${durationMeta(n.hierMs)}`;
}

/** Every file in a folder's subtree, folder by folder in path order. */
function subtreeFiles(n) {
  const out = [...n.files];
  for (const c of n.folders) out.push(...subtreeFiles(c));
  return out;
}

/**
 * The hierarchy's categories: every folder with files in path order; in the
 * category shuffle modes the playing level's subtree comes first (cg1.W).
 */
function hierCategory(src, node) {
  const order = src.tree.withFiles, index = order.indexOf(node);
  if (index < 0) return null;
  const level = src.node, prefix = level.path ? level.path + '/' : '';
  const first = new Set(order.filter(n => n === level || n.path.startsWith(prefix)).map(n => order.indexOf(n)));
  const files = n => withOptions({ctx: src.ctx, tracks: [...n.files]}, src.nav.list, {key: hierOpts(src.ctx, n).key, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT.folder}).tracks;
  return {source: {count: order.length, groups: order.map(n => ({kind: 'folder', title: n.name, path: n.path, tracks: n.files})), tracksAt: j => (order[j] ? files(order[j]) : []), shuffleFirst: first}, index};
}

export function folderLevelSource(ctx, list, nav, node, cat = homeCategory(2)) {
  const src = new FolderLevelSource(ctx, list, nav, node, cat);
  src.kind = 'hier';
  return src;
}
