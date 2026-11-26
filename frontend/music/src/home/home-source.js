// The v2 Home (switch.js): the library's first screen. Under the home's own title header
// (scene_top_header, its menu only): the chips (All, Playlists, Albums, Artists, New), then what the
// chip shows, each shelf a header with "See all" over a sideways strip of covers in the album grid's
// look:
// - All: six tiles of what was played last (Liked songs first), the "tonight" mix when there is one,
//   Recently added, Most played lately, Forgotten favourites, Recently played (song rows) and a decade
//   or genre that changes each day;
// - Playlists: tiles of Liked songs and the playlists last played or changed, then the playlists most
//   played lately and all of them;
// - Albums: tiles of the albums last played, then albums recently added, most played lately, the day's
//   decade or genre and all of them;
// - Artists: tiles of the artists last played, then artists most played lately, recently added, all;
// - New: albums recently added, then the newest songs as song rows.
// Rows are the list's own (power-list.js rowTops: rows of their own heights); the data comes from
// data.js, built in idle time, so the screen opens on what it has. Home does not zoom (no optsKey).
import {categorySource, homeCategory, playlistSource, plural} from '../list/sources.js';
import {homeData} from './data.js';
import {tileRecord} from './row-view.js';
import {tonightRowHeight} from './tonight-row.js';
import {likedSource, forgottenSource, openGroup, playFrom} from './lists.js';
import {WORDS} from './switch.js';

export {likedSource, openGroup, playFrom} from './lists.js';

export const HOME_CHIPS = [
  {id: 'all', title: WORDS.all}, {id: 'playlists', title: WORDS.playlists}, {id: 'albums', title: WORDS.albums},
  {id: 'artists', title: WORDS.artists}, {id: 'new', title: WORDS.new},
];

/** Where a grid cover's image starts in its cell (scene_grid), measured once per cell size. */
function gridInset(ctx, cell, h) {
  const key = cell + 'x' + h;
  if (ctx.homeGridInset?.key === key) return ctx.homeGridInset.value;
  let value = Math.round(8 * ctx.dpr);
  try {
    const v = ctx.inflater.inflate('item_track', null)[0];
    v.setItemScene?.('scene_grid', cell, h);
    const img = v.findViewById('aa_image');
    if (img) value = img.left;
  } catch { /* the default */ }
  ctx.homeGridInset = {key, value};
  return value;
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
  unselectable(i) { return this.rows[i]?.type !== 'track'; }
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

  /** A chip picked: the home of that kind, in place (no new level), where it was left. */
  pick(id) {
    const lw = this.ctx.listWidget;
    if (id === this.chip) { lw?.libList.scrollTo(0); return; }
    this.ctx.homeTabs?.leaveChip('home', this.chip);
    this.ctx.homeChip = id;
    lw?.replaceTop(new HomeV2Source(this.ctx, this.list, this.nav, id));
    lw?.libList.scrollTo(this.ctx.homeTabs?.chipScroll('home', id) ?? 0);
  }

  build(data, {sub, dp}) {
    const ctx = this.ctx, list = this.list, nav = this.nav, rows = [], chip = this.chip;
    rows.push({type: 'homeChips', h: dp(52), chips: HOME_CHIPS, active: chip, pick: id => this.pick(id)});
    if (!data) return rows;
    const open = {
      album: g => () => openGroup(ctx, list, nav, g, '?albums'),
      artist: g => () => openGroup(ctx, list, nav, g, '?artists'),
      playlist: pl => () => { const s = playlistSource(ctx, list, nav, pl); if (s) nav.open(s); },
      liked: () => () => nav.open(likedSource(ctx, list, nav)),
      forgotten: () => nav.open(forgottenSource(ctx, list, nav)),
      category: id => () => nav.open(categorySource(ctx, list, nav, homeCategory(id))),
      library: kind => () => ctx.homeTabs?.toLibrary(kind),
    };
    const songs = n => plural(ctx, 'songs_d', n);
    const albumTile = (g, key) => ({record: tileRecord(key + ':' + g.title + ':' + (g.artist ?? ''), g.title, g.artist || g.tracks[0]?.artist || '', g.tracks), open: open.album(g)});
    const artistTile = (g, key) => ({record: tileRecord(key + ':' + g.title, g.title, songs(g.tracks.length), g.tracks), open: open.artist(g)});
    const playlistTile = (p, key) => ({record: tileRecord(key + ':' + p.pl.id, p.pl.name, songs(p.tracks.length), p.tracks), open: open.playlist(p.pl)});
    const likedTile = key => ({record: tileRecord(key + ':liked', WORDS.liked, songs(data.liked.length), data.liked), open: open.liked()});
    const side = dp(8);
    // Six tiles, two a row: Liked songs first where playlists show, then what was played last.
    const kindTile = t => t.kind === 'album' ? albumTile(t.g, 't') : t.kind === 'artist' ? artistTile(t.g, 't') : playlistTile({pl: t.pl, tracks: t.tracks}, 't');
    let tiles = [];
    if (chip === 'all' || chip === 'playlists') { if (data.liked.length) tiles.push(likedTile('t')); }
    if (chip === 'all') tiles.push(...data.tiles.map(kindTile));
    else if (chip === 'playlists') tiles.push(...data.playlists.map(p => playlistTile(p, 't')));
    else if (chip === 'albums') tiles.push(...data.tiles.filter(t => t.kind === 'album').map(kindTile));
    else if (chip === 'artists') tiles.push(...data.tiles.filter(t => t.kind === 'artist').map(kindTile));
    tiles = tiles.slice(0, 6);
    const tileH = this.itemHeight + dp(8);
    for (let k = 0; k < tiles.length; k += 2) rows.push({type: 'homeTiles', h: tileH, side, items: tiles.slice(k, k + 2)});
    if (chip === 'all' && ctx.tonightCard?.isConnected) {
      const w = list.width || Math.round(ctx.viewportWidth * ctx.dpr), open = !!ctx.tonightWhy;
      rows.push({type: 'homeTonight', h: tonightRowHeight(ctx, w, ctx.tonightCard, open, side), side, card: ctx.tonightCard, open});
    }
    const cell = dp(150), shelfH = cell + dp(4), extra = sub.dim('humanGridItemExtraSpace', 0);
    const inset = gridInset(ctx, cell, shelfH);
    const head = (title, seeAll) => rows.push({type: 'homeHead', h: dp(52), title, button: WORDS.seeAll, seeAll, inset});
    const shelf = (key, title, items, seeAll, scene = 'scene_grid') => {
      if (!items.length) return;
      head(title, seeAll);
      rows.push({type: 'homeShelf', h: scene === 'scene_grid_1_alt' ? shelfH + extra : shelfH, key: chip + ':' + key, items, cell, scene, scrollX: ctx.homeShelfX?.get(chip + ':' + key) ?? 0});
    };
    const songRows = (title, tracks, seeAll) => {
      if (!tracks.length) return;
      head(title, seeAll);
      tracks.forEach((t, at) => rows.push({type: 'track', h: this.itemHeight, scene: 'scene_small', track: t, list: tracks, listTitle: title, at}));
    };
    const albums = (key, gs) => gs.map(g => albumTile(g, key));
    const artists = (key, gs) => gs.map(g => artistTile(g, key));
    const songTiles = (key, ts, title) => ts.map((t, at) => ({record: tileRecord(key + ':' + t.id, t.title, t.artist || '', [t]), open: () => playFrom(ctx, list, nav, title, ts, at)}));
    const rot = data.rotating;
    const rotSeeAll = rot?.kind === 'genre' ? () => openGroup(ctx, list, nav, rot.group, '?genres') : open.category(17);
    if (chip === 'all') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(14));
      shelf('most', WORDS.mostPlayed, albums('most', data.mostPlayed), open.category(11));
      shelf('forgotten', WORDS.forgotten, songTiles('forgotten', data.forgotten, WORDS.forgotten), open.forgotten);
      songRows(WORDS.recentlyPlayed, data.recentSongs, open.category(12));
      if (rot) shelf('rot', rot.title, albums('rot', rot.albums), rotSeeAll);
    } else if (chip === 'playlists') {
      shelf('lately', WORDS.mostPlayed, data.plLately.slice(0, 12).map(p => playlistTile(p, 'pll')), open.library('playlists'));
      const pls = data.playlists.map(p => playlistTile(p, 'pl'));
      if (data.liked.length) pls.unshift(likedTile('pl'));
      shelf('pls', WORDS.yourPlaylists, pls, open.library('playlists'));
    } else if (chip === 'albums') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(14));
      shelf('most', WORDS.mostPlayed, albums('most', data.mostPlayed), open.category(11));
      if (rot) shelf('rot', rot.title, albums('rot', rot.albums), rotSeeAll);
      shelf('az', WORDS.yourAlbums, albums('az', data.albumsAz), open.library('albums'));
    } else if (chip === 'artists') {
      shelf('most', WORDS.mostPlayed, artists('most', data.mostPlayedArtists), open.category(11), 'scene_grid_1_alt');
      shelf('added', WORDS.recentlyAdded, artists('added', data.recentArtists), open.category(14), 'scene_grid_1_alt');
      shelf('az', WORDS.topArtists, artists('az', data.artistsAz), open.library('artists'), 'scene_grid_1_alt');
    } else if (chip === 'new') {
      shelf('added', WORDS.recentlyAdded, albums('added', data.recentAlbums), open.category(14));
      songRows(WORDS.newSongs, data.newSongs, open.category(14));
    }
    return rows;
  }
}
