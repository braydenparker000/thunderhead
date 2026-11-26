// The v2 Home (switch.js): the library's first screen. Under the home's own title header
// (scene_top_header, its menu only): the chips (All, Playlists, Albums, Artists, New), six compact
// tiles of what was played last, Music's "tonight" card when there is one, then shelves, each a header
// with "See all" over a sideways strip of covers in the album grid's look (Recently added, Most played
// lately, Forgotten favourites, a decade or a genre that changes each day) and Recently played as song
// rows. A chip shows only its kind. Rows are the list's own (power-list.js rowTops: rows of their own
// heights); the data comes from data.js, built in idle time, so the screen opens on what it has.
import {GroupSource, TrackSource, categorySource, homeCategory, playlistSource, plural} from '../list/sources.js';
import {applyZoom} from '../list/list-opts.js';
import {homeData} from './data.js';
import {tileRecord} from './rows.js';
import {WORDS} from './switch.js';

export const HOME_CHIPS = [
  {id: 'all', title: WORDS.all}, {id: 'playlists', title: WORDS.playlists}, {id: 'albums', title: WORDS.albums},
  {id: 'artists', title: WORDS.artists}, {id: 'new', title: WORDS.new},
];

/** Liked songs (rated like) as a song list of its own, in the order they were liked. */
export function likedSource(ctx, list, nav, tracks) {
  const src = new TrackSource(ctx, list, nav, WORDS.liked, tracks);
  applyZoom(src, list.host.substyle, 'tracks', 'tracks:liked');
  src.icon = '?top_rated';
  src.backDecor = 'item_top_text_back_decor';
  src.rebuild = () => likedSource(ctx, list, nav, ctx.library.tracks.filter(t => t.rating === 5));
  return src;
}

/** Opens a group (an album, an artist) as its list's row would. */
export function openGroup(ctx, list, nav, g, icon) {
  const gs = new GroupSource(ctx, list, nav, '', [g]);
  gs.icon = icon;
  gs.groupKind = g.kind === 'artist' ? 'artists' : 'albums';
  gs.onItemClick(0);
}

/** Plays songs from one of them, as a song list's row does. */
export function playFrom(ctx, list, nav, title, tracks, i) {
  new TrackSource(ctx, list, nav, title, tracks).onItemClick(i);
}

export class HomeV2Source {
  constructor(ctx, list, nav, chip = 'all') {
    this.ctx = ctx;
    this.list = list;
    this.nav = nav;
    this.chip = chip;
    const sub = list.host.substyle, dp = n => Math.round(n * ctx.dpr);
    this.title = WORDS.home;
    this.itemType = 'track';
    this.itemScene = 'scene_small';
    this.columns = 1;
    this.itemHeight = sub.dim('itemSizeSmall', dp(56));
    this.header = {type: 'text', scene: 'scene_top_header'};
    this.headerHeight = sub.dim('topTextHeaderSize', dp(76)) + ctx.windowInsets.top;
    this.menuOnlyToolbar = true;
    this.isHomeV2 = true;
    this.rebuild = () => new HomeV2Source(ctx, list, nav, this.chip);
    this.rows = this.build(homeData(ctx), {sub, dp});
    let y = 0;
    this.rowTops = [0];
    for (const r of this.rows) this.rowTops.push(y += r.h);
  }

  get count() { return this.rows.length; }
  get menuLayout() { return 'merge_menu_items_lib'; }

  typeAt(i) { return this.rows[i]?.type; }
  sceneAt(i) { return this.rows[i]?.scene ?? null; }
  isSeparator(i) { return this.rows[i]?.type !== 'track'; }
  tracksAt(i) { const r = this.rows[i]; return r?.track ? [r.track] : []; }
  sectionTitle() { return ''; }
  indexOfTrack(t) { return this.rows.findIndex(r => r.track?.id === t.id); }

  bindHeader(v) {
    v.findViewById('title')?.setText(this.title);
    v.findViewById('line2')?.setText('');
    v.track = null;
    v.findViewById('aa_image')?.setArt?.(null);
    v.findViewById('aa_image')?.setDrawable?.(null);
  }

  bindItem(v, i) {
    const r = this.rows[i];
    if (r.type === 'track') v.bind(r.track);
    else v.bindRow?.(r);
  }

  onItemClick(i) {
    const r = this.rows[i];
    if (r?.track) playFrom(this.ctx, this.list, this.nav, r.listTitle, r.list, r.at);
  }

  /** A chip picked: the home of that kind, in place (no new level). */
  pick(id) {
    if (id === this.chip) { this.ctx.listWidget?.libList.scrollTo(0); return; }
    this.ctx.homeChip = id;
    this.ctx.listWidget?.replaceTop(new HomeV2Source(this.ctx, this.list, this.nav, id));
    this.ctx.listWidget?.libList.scrollTo(0);
  }

  build(data, {sub, dp}) {
    const ctx = this.ctx, list = this.list, nav = this.nav, rows = [], chip = this.chip;
    rows.push({type: 'homeChips', h: dp(52), chips: HOME_CHIPS, active: chip, pick: id => this.pick(id)});
    if (!data) return rows;
    const open = {
      album: g => () => openGroup(ctx, list, nav, g, '?albums'),
      artist: g => () => openGroup(ctx, list, nav, g, '?artists'),
      playlist: pl => () => { const s = playlistSource(ctx, list, nav, pl); if (s) nav.open(s); },
      liked: () => () => nav.open(likedSource(ctx, list, nav, data.liked)),
      category: id => () => nav.open(categorySource(ctx, list, nav, homeCategory(id))),
    };
    const songs = n => plural(ctx, 'songs_d', n);
    const albumTile = (g, key) => ({record: tileRecord(key + ':' + g.title + ':' + (g.artist ?? ''), g.title, g.artist || g.tracks[0]?.artist || '', g.tracks), open: open.album(g)});
    const artistTile = (g, key) => ({record: tileRecord(key + ':' + g.title, g.title, songs(g.tracks.length), g.tracks), open: open.artist(g)});
    const playlistTile = (p, key) => ({record: tileRecord(key + ':' + p.pl.id, p.pl.name, songs(p.tracks.length), p.tracks), open: open.playlist(p.pl)});
    const likedTile = key => ({record: tileRecord(key + ':liked', WORDS.liked, songs(data.liked.length), data.liked), open: open.liked()});
    // Six tiles, two a row.
    let tiles = data.tiles;
    if (chip === 'playlists') tiles = data.tiles.filter(t => t.kind === 'liked' || t.kind === 'playlist');
    else if (chip === 'albums') tiles = data.tiles.filter(t => t.kind === 'album');
    else if (chip === 'artists') tiles = data.tiles.filter(t => t.kind === 'artist');
    else if (chip === 'new') tiles = [];
    const tile = t => t.kind === 'liked' ? likedTile('t') : t.kind === 'album' ? albumTile(t.g, 't') : t.kind === 'artist' ? artistTile(t.g, 't') : playlistTile({pl: t.pl, tracks: t.tracks}, 't');
    const tileH = sub.dim('itemSizeSmall', dp(56)) + dp(8);
    for (let k = 0; k < Math.min(6, tiles.length); k += 2) rows.push({type: 'homeTiles', h: tileH, items: tiles.slice(k, k + 2).map(tile)});
    if (chip === 'all' && ctx.tonightCard?.isConnected) rows.push({type: 'homeTonight', h: ctx.tonightHeight ?? dp(150), card: ctx.tonightCard});
    const cell = dp(150), shelfH = cell + dp(4);
    const shelf = (key, title, items, seeAll, scene = 'scene_grid') => {
      if (!items.length) return;
      rows.push({type: 'homeHead', h: dp(52), title, button: WORDS.seeAll, seeAll});
      rows.push({type: 'homeShelf', h: scene === 'scene_grid_1_alt' ? shelfH + sub.dim('humanGridItemExtraSpace', 0) : shelfH, key, items, cell, scene});
    };
    const songRows = (key, title, tracks, seeAll) => {
      if (!tracks.length) return;
      rows.push({type: 'homeHead', h: dp(52), title, button: WORDS.seeAll, seeAll});
      tracks.forEach((t, at) => rows.push({type: 'track', h: this.itemHeight, scene: 'scene_small', track: t, list: tracks, listTitle: title, at}));
    };
    const albums = (key, gs) => gs.map(g => albumTile(g, key));
    const songTiles = (key, ts, title) => ts.map((t, at) => ({record: tileRecord(key + ':' + t.id, t.title, t.artist || '', [t]), open: () => playFrom(ctx, list, nav, title, ts, at)}));
    const rot = data.rotating;
    const rotSeeAll = rot?.kind === 'genre' ? () => openGroup(ctx, list, nav, rot.group, '?genres') : open.category(17);
    if (chip === 'all') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(14));
      shelf('most', WORDS.mostPlayed, albums('most', data.mostPlayed), open.category(11));
      shelf('forgotten', WORDS.forgotten, songTiles('forgotten', data.forgotten, WORDS.forgotten), open.category(13));
      songRows('played', WORDS.recentlyPlayed, data.recentSongs, open.category(12));
      if (rot) shelf('rot', rot.title, albums('rot', rot.albums), rotSeeAll);
    } else if (chip === 'playlists') {
      const pls = data.playlists.map(p => playlistTile(p, 'pl'));
      if (data.liked.length) pls.unshift(likedTile('pl'));
      shelf('pls', WORDS.yourPlaylists, pls, open.category(9));
    } else if (chip === 'albums') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(3));
      shelf('most', WORDS.mostPlayed, albums('most', data.mostPlayed), open.category(11));
      if (rot) shelf('rot', rot.title, albums('rot', rot.albums), rotSeeAll);
    } else if (chip === 'artists') {
      shelf('artists', WORDS.topArtists, data.artists.map(g => artistTile(g, 'ar')), open.category(4), 'scene_grid_1_alt');
    } else if (chip === 'new') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(14));
      songRows('new', WORDS.newSongs, data.newSongs, open.category(14));
    }
    return rows;
  }
}

