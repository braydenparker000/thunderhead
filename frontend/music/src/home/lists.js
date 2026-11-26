// The v2 layout's own song lists, each a normal song list (list/sources.js TrackSource: its rows,
// header, menu, selection, rail, List Options and pinch zoom, saved per list):
// - Liked songs (tracks:liked): the songs rated like, the newest liked first until a sort is chosen;
// - Forgotten favourites (tracks:forgotten): liked or often played and not played for 90 days
//   (rules.js), the newest forgotten first (by played at) until another sort is chosen.
// And the taps Home's tiles and shelves share with the lists: open a group, play from songs.
import {GroupSource, TrackSource, withOptions} from '../list/sources.js';
import {listOpts} from '../list/list-opts.js';
import {likedSongs, forgottenSongs} from './rules.js';
import {WORDS} from './switch.js';

// List Options' "by played at" (sources.js TRACK_SORT 7): the latest last play first.
const BY_PLAYED_AT = 7;

function songList(ctx, list, nav, title, tracks, key, {defaultSort = null, icon}) {
  const src = new TrackSource(ctx, list, nav, title, tracks);
  // Its own order until the owner picks a sort (List Options lists the sorts either way).
  const sorted = defaultSort !== null || listOpts(key).sort !== undefined;
  withOptions(src, list, {key, zoomKind: 'tracks', sortKind: sorted ? 'tracks' : null, defaultSort: defaultSort ?? 0});
  // (A value no sort has and without the Reverse bit: no choice shows picked, and picking one is not reversed.)
  if (!sorted) { src.sortKind = 'tracks'; src.sortValue = 0x3fffffff; }
  src.icon = icon;
  // The up title over its header names where it opened from (the library's text header decor).
  src.backDecor = 'item_top_text_back_decor';
  return src;
}

/** Liked songs (rated like), in the order they were liked. */
export function likedSource(ctx, list, nav) {
  const src = songList(ctx, list, nav, WORDS.liked, likedSongs(ctx.library.tracks), 'tracks:liked', {icon: '?top_rated'});
  src.v2List = 'liked';
  src.rebuild = () => likedSource(ctx, list, nav);
  return src;
}

/** Forgotten favourites, the newest forgotten first. */
export function forgottenSource(ctx, list, nav, now = Date.now()) {
  const src = songList(ctx, list, nav, WORDS.forgotten, forgottenSongs(ctx.library.tracks, now), 'tracks:forgotten', {defaultSort: BY_PLAYED_AT, icon: '?recently_played'});
  src.v2List = 'forgotten';
  src.rebuild = () => forgottenSource(ctx, list, nav);
  return src;
}

/** Opens a group (an album, an artist, a genre) as its list's row would. */
export function openGroup(ctx, list, nav, g, icon) {
  const gs = new GroupSource(ctx, list, nav, '', [g]);
  gs.icon = icon;
  gs.groupKind = g.kind === 'artist' ? 'artists' : g.kind === 'genre' ? 'genres' : 'albums';
  gs.onItemClick(0);
}

/** Plays songs from one of them, as a song list's row does. */
export function playFrom(ctx, list, nav, title, tracks, i) {
  new TrackSource(ctx, list, nav, title, tracks).onItemClick(i);
}
