// What the v2 Home shows, from the library as it is (play counts and times, ratings, added dates, the
// owner's playlists): the six most recently played things, the shelves and the rotating row. Built as
// steps (library/groups.js) in idle time (view/idle-work.js), so Home opens at once on the last result
// and takes the new one when it is ready. Nothing is stored; a changed library or playlist marks it stale.
import {idleWork} from '../view/idle-work.js';
import {run, STEP} from '../library/groups.js';
import {albumYear} from '../library/shelves.js';

const DAY = 86_400_000;
export const SHELF_MAX = 12, TILES = 6, RECENT_SONGS = 4;
/** Not played for this long, liked or often played: a forgotten favourite. */
export const FORGOTTEN_MS = 90 * DAY, OFTEN = 8, LATELY_MS = 30 * DAY;
export const LIKE = 5;

const lastOf = tracks => { let m = 0; for (const t of tracks) if ((t.lastPlayed || 0) > m) m = t.lastPlayed; return m; };
const addedOf = tracks => { let m = 0; for (const t of tracks) if ((t.added || 0) > m) m = t.added; return m; };

/** The data as steps: {liked, tiles, recentAlbums, mostPlayed, forgotten, recentSongs, rotating, artists, playlists}. */
export function* homeDataSteps(ctx, now = Date.now()) {
  const lib = ctx.library, tracks = lib?.tracks ?? [];
  const shelves = yield* lib.groupedSteps('shelves');
  const liked = [];
  let n = 0;
  for (const t of tracks) {
    if (t.rating === LIKE) liked.push(t);
    if (++n % STEP === 0) yield;
  }
  liked.sort((a, b) => (b.ratedAt || b.lastPlayed || 0) - (a.ratedAt || a.lastPlayed || 0));
  // Albums: when last played, how much lately, when added.
  const albums = shelves.albums.map(g => {
    let lately = 0;
    for (const t of g.tracks) if ((t.lastPlayed || 0) > now - LATELY_MS) lately += t.plays || 0;
    return {g, last: lastOf(g.tracks), added: addedOf(g.tracks), lately, year: albumYear(g)};
  });
  yield;
  const artists = shelves.artists.map(g => ({g, last: lastOf(g.tracks), plays: g.tracks.reduce((s, t) => s + (t.plays || 0), 0)}));
  yield;
  const P = ctx.playlists;
  const playlists = (P?.items ?? []).map(pl => { const ts = P.tracksOf(pl); return {pl, tracks: ts, last: Math.max(lastOf(ts), pl.played || 0)}; });
  yield;
  // The six tiles: Liked songs first (when it has songs), then what was played last, of any kind.
  const kinds = [...albums.map(a => ({kind: 'album', g: a.g, last: a.last})), ...artists.map(a => ({kind: 'artist', g: a.g, last: a.last})), ...playlists.map(p => ({kind: 'playlist', pl: p.pl, tracks: p.tracks, last: p.last}))];
  kinds.sort((a, b) => b.last - a.last);
  const tiles = [];
  if (liked.length) tiles.push({kind: 'liked', tracks: liked});
  for (const k of kinds) { if (tiles.length >= TILES || !k.last) break; tiles.push(k); }
  yield;
  const recentAlbums = [...albums].sort((a, b) => b.added - a.added).slice(0, SHELF_MAX).map(a => a.g);
  const mostPlayed = albums.filter(a => a.lately > 0).sort((a, b) => b.lately - a.lately).slice(0, SHELF_MAX).map(a => a.g);
  const forgotten = tracks.filter(t => (t.rating === LIKE || (t.plays || 0) >= OFTEN) && t.lastPlayed && t.lastPlayed < now - FORGOTTEN_MS)
    .sort((a, b) => (b.plays || 0) - (a.plays || 0)).slice(0, SHELF_MAX);
  yield;
  const recentSongs = tracks.filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, RECENT_SONGS);
  const newSongs = [...tracks].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, RECENT_SONGS);
  yield;
  const rotating = yield* rotatingSteps(ctx, albums, now);
  return {
    liked, tiles, recentAlbums, mostPlayed, forgotten, recentSongs, newSongs, rotating,
    artists: [...artists].sort((a, b) => b.last - a.last || b.plays - a.plays).slice(0, SHELF_MAX).map(a => a.g),
    playlists: [...playlists].sort((a, b) => b.last - a.last || (b.pl.modified || 0) - (a.pl.modified || 0)),
    albumCount: shelves.albums.length,
  };
}

/**
 * The rotating row: on even days a decade, on odd days a genre, each day the next one that has
 * four albums or more ({kind: 'decade' | 'genre', title, albums, group?}), or null.
 */
function* rotatingSteps(ctx, albums, now) {
  const day = Math.floor(now / DAY);
  const decades = new Map();
  for (const a of albums) if (a.year) { const d = Math.floor(a.year / 10) * 10; (decades.get(d) ?? decades.set(d, []).get(d)).push(a); }
  const genres = (yield* ctx.library.groupedSteps('genres')).filter(g => g.title && !/^unknown/i.test(g.title));
  const byGenre = genres.map(g => {
    const set = new Set(g.tracks);
    return {g, albums: albums.filter(a => a.g.tracks.some(t => set.has(t)))};
  }).filter(x => x.albums.length >= 4);
  const dec = [...decades].filter(([, l]) => l.length >= 4).sort((a, b) => a[0] - b[0]);
  const pickDecade = () => {
    if (!dec.length) return null;
    const [d, l] = dec[Math.floor(day / 2) % dec.length];
    return {kind: 'decade', title: `The ${d}s`, decade: d, albums: l.sort((a, b) => b.last - a.last).slice(0, SHELF_MAX).map(a => a.g)};
  };
  const pickGenre = () => {
    if (!byGenre.length) return null;
    const x = byGenre[Math.floor(day / 2) % byGenre.length];
    return {kind: 'genre', title: x.g.title, group: x.g, albums: x.albums.sort((a, b) => b.last - a.last).slice(0, SHELF_MAX).map(a => a.g)};
  };
  return day % 2 ? pickGenre() ?? pickDecade() : pickDecade() ?? pickGenre();
}

/**
 * The data kept for this library (null until built): the last result stays shown while a fresh one
 * is built in idle time after a change (stale), and listeners hear when it is new.
 */
export function homeData(ctx) {
  const k = ctx.homeDataKept;
  if (!k || k.tracks !== ctx.library?.tracks) warmHome(ctx);
  else if (k.stale) warmHome(ctx);
  return ctx.homeDataKept?.value ?? null;
}

/** homeData built at once (a check, or a library small enough not to matter). */
export function homeDataNow(ctx) {
  const value = run(homeDataSteps(ctx));
  ctx.homeDataKept = {tracks: ctx.library.tracks, value, stale: false};
  ctx.bus.post('bus_gui', 'msg_home_data_ready', null, {});
  return value;
}

/** Builds the data in idle slices; `ctx.bus` hears msg_home_data_ready when it is in. */
export function warmHome(ctx) {
  if (ctx.homeWarming || !ctx.library) return ctx.homeWarming;
  const tracks = ctx.library.tracks;
  let value = null;
  ctx.homeWarming = idleWork(ctx, 'home-shelves', [() => (function* () { value = yield* homeDataSteps(ctx); })()]).then(() => {
    ctx.homeWarming = null;
    if (ctx.library.tracks !== tracks) { warmHome(ctx); return; }
    ctx.homeDataKept = {tracks, value, stale: false};
    ctx.bus.post('bus_gui', 'msg_home_data_ready', null, {});
  });
  return ctx.homeWarming;
}

/** Marks the kept data stale (a changed library, a playlist, a song played or rated). */
export function homeStale(ctx) {
  if (ctx.homeDataKept) ctx.homeDataKept.stale = true;
}
