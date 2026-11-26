// What the v2 Home shows, from the library as it is (play counts and times, ratings, added dates, the
// owner's playlists, the play history): the most recently played things for the tiles, the shelves of
// each chip and the rotating row. Built as steps (library/groups.js) in idle slices (idleSteps below),
// every pass over the songs yielding each STEP songs, so Home opens at once on the last result and
// takes the new one when it is ready; Home's row views are made ahead in the same slices. Kept until
// the library, a playlist, a rating or the play history changes (stale), never stored. The rules of
// each shelf are rules.js's.
import {busy, SLICE_MS, QUIET_MS} from '../view/idle-work.js';
import {pieceRan} from '../ui/long-work.js';
import {prewarmCovers} from './shelf.js';
import {run, sortSteps, STEP} from '../library/groups.js';
import {albumYear} from '../library/shelves.js';
import {DAY, isLiked, isForgotten, playsLately, mostPlayedGroups, lastPlayOf, playlistRecent} from './rules.js';

export const SHELF_MAX = 12, TILES = 6, RECENT_SONGS = 4, NEW_SONGS = 8;

const addedOf = tracks => { let m = 0; for (const t of tracks) if ((t.added || 0) > m) m = t.added; return m; };
const by = key => (a, b) => b[key] - a[key];

/** Songs kept by `keep`, as steps. */
function* filterSteps(tracks, keep) {
  const out = [];
  for (let i = 0; i < tracks.length; i++) {
    if (keep(tracks[i])) out.push(tracks[i]);
    if ((i + 1) % STEP === 0) yield;
  }
  return out;
}

/** The first n of a list by `cmp`, as steps (a partial pass, no full sort of a long list). */
function* topSteps(list, n, cmp) {
  const top = [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (top.length < n || cmp(x, top[top.length - 1]) < 0) {
      let k = top.length;
      while (k > 0 && cmp(x, top[k - 1]) < 0) k--;
      top.splice(k, 0, x);
      if (top.length > n) top.pop();
    }
    if ((i + 1) % STEP === 0) yield;
  }
  return top;
}

/** The data as steps; see the return value. */
export function* homeDataSteps(ctx, now = Date.now()) {
  const lib = ctx.library, tracks = lib?.tracks ?? [];
  const shelves = yield* lib.groupedSteps('shelves');
  const liked = yield* filterSteps(tracks, isLiked);
  yield* sortSteps(liked, (a, b) => (b.ratedAt || b.lastPlayed || 0) - (a.ratedAt || a.lastPlayed || 0));
  const {counts} = playsLately(tracks, ctx.player?.history?.items, now);
  yield;
  // Albums and artists: when last played, when added, plays lately.
  const albums = [];
  for (const g of shelves.albums) albums.push({g, last: lastPlayOf(g.tracks), added: addedOf(g.tracks), year: albumYear(g)});
  yield;
  const artists = shelves.artists.map(g => ({g, last: lastPlayOf(g.tracks), added: addedOf(g.tracks)}));
  yield;
  const P = ctx.playlists;
  const playlists = (P?.items ?? []).map(pl => { const ts = P.tracksOf(pl); return {pl, tracks: ts, last: playlistRecent(pl, ts)}; });
  playlists.sort(by('last'));
  yield;
  // The tiles: Liked songs first (when it has songs), then what was played last, of any kind.
  const kinds = [...albums.map(a => ({kind: 'album', g: a.g, last: a.last})), ...artists.map(a => ({kind: 'artist', g: a.g, last: a.last})),
    ...playlists.map(p => ({kind: 'playlist', pl: p.pl, tracks: p.tracks, last: p.last}))].filter(k => k.last);
  kinds.sort(by('last'));
  const tiles = kinds.slice(0, TILES * 2);
  yield;
  const recentAlbums = [...albums].sort(by('added')).slice(0, SHELF_MAX).map(a => a.g);
  const mostPlayed = mostPlayedGroups(shelves.albums, counts).slice(0, SHELF_MAX);
  const mostPlayedArtists = mostPlayedGroups(shelves.artists, counts).slice(0, SHELF_MAX);
  const recentArtists = [...artists].sort(by('added')).slice(0, SHELF_MAX).map(a => a.g);
  yield;
  const forgottenAll = yield* filterSteps(tracks, t => isForgotten(t, now));
  yield* sortSteps(forgottenAll, (a, b) => b.lastPlayed - a.lastPlayed);
  const played = yield* topSteps(tracks, RECENT_SONGS, (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const newSongs = yield* topSteps(tracks, NEW_SONGS, (a, b) => (b.added || 0) - (a.added || 0));
  // Playlists by their songs' plays lately.
  const plLately = playlists.map(p => ({p, s: p.tracks.reduce((s, t) => s + (counts.get(t.id) ?? 0), 0)})).filter(x => x.s > 0).sort(by('s')).map(x => x.p);
  yield;
  const rotating = yield* rotatingSteps(ctx, albums, now);
  return {
    liked, tiles, recentAlbums, mostPlayed, mostPlayedArtists, recentArtists, rotating, playlists, plLately,
    forgotten: forgottenAll.slice(0, SHELF_MAX), forgottenCount: forgottenAll.length,
    recentSongs: played.filter(t => t.lastPlayed), newSongs,
    artists: [...artists].sort((a, b) => b.last - a.last).slice(0, SHELF_MAX).map(a => a.g),
    albumsAz: shelves.albums.slice(0, SHELF_MAX), artistsAz: shelves.artists.slice(0, SHELF_MAX),
    albumCount: shelves.albums.length, artistCount: shelves.artists.length,
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
  const albumOf = new Map();
  for (const a of albums) for (const t of a.g.tracks) albumOf.set(t, a);
  yield;
  const byGenre = [];
  for (const g of genres) {
    const set = new Set();
    for (const t of g.tracks) { const a = albumOf.get(t); if (a) set.add(a); }
    if (set.size >= 4) byGenre.push({g, albums: [...set]});
  }
  yield;
  const dec = [...decades].filter(([, l]) => l.length >= 4).sort((a, b) => a[0] - b[0]);
  const pickDecade = () => {
    if (!dec.length) return null;
    const [d, l] = dec[Math.floor(day / 2) % dec.length];
    return {kind: 'decade', title: `The ${d}s`, decade: d, albums: [...l].sort(by('last')).slice(0, SHELF_MAX).map(a => a.g)};
  };
  const pickGenre = () => {
    if (!byGenre.length) return null;
    const x = byGenre[Math.floor(day / 2) % byGenre.length];
    return {kind: 'genre', title: x.g.title, group: x.g, albums: x.albums.sort(by('last')).slice(0, SHELF_MAX).map(a => a.g)};
  };
  return day % 2 ? pickGenre() ?? pickDecade() : pickDecade() ?? pickGenre();
}

/**
 * The data kept for this library (null until built): the last result stays shown while a fresh one
 * is built in idle time after a change (stale), and listeners hear when it is new.
 */
export function homeData(ctx) {
  const k = ctx.homeDataKept;
  if (!k || k.tracks !== ctx.library?.tracks || k.stale) warmHome(ctx);
  return ctx.homeDataKept?.value ?? null;
}

/** homeData built at once (a check, or a library small enough not to matter). */
export function homeDataNow(ctx) {
  const value = run(homeDataSteps(ctx));
  ctx.homeDataKept = {tracks: ctx.library.tracks, value, stale: false};
  ctx.bus.post('bus_gui', 'msg_home_data_ready', null, {});
  return value;
}

// The steps run in idle callbacks, SLICE_MS at a time, by the rules of the app's idle work
// (view/idle-work.js: not within QUIET_MS of an input, nor while a transition moves or a list scrolls),
// on their own: Home's first screen waits for them, and the shared queue's jobs ahead (spare rows a
// piece a layout) would hold them for seconds. A layout pending does not stop them (they lay nothing out).
const calm = ctx => !busy(Object.create(ctx, {_layoutPending: {value: false}}));
const ric = (fn, ms = 0) => {
  const go = () => (globalThis.requestIdleCallback ? requestIdleCallback(fn, {timeout: 2000}) : fn());
  if (ms > 0) setTimeout(go, ms); else go();
};

function idleSteps(ctx, name, steps) {
  return new Promise(done => {
    const pump = () => {
      if (!calm(ctx)) { ric(pump, QUIET_MS); return; }
      const at = performance.now();
      let end = false;
      try {
        while (!(end = !!steps.next().done) && performance.now() - at < SLICE_MS);
      } catch (e) { end = true; console.warn('[claude-player] idle work', name, e); }
      pieceRan(name, at, performance.now() - at);
      if (end) done(); else ric(pump);
    };
    ric(pump);
  });
}

/**
 * Home's rows made ahead, a view a step, before the data that needs them shows: the list's spare rows
 * of each of Home's kinds (power-list.js spareSteps) and shelf covers (shelf.js), so the frame that
 * shows the shelves binds them instead of inflating them.
 */
function* prewarmRows(ctx) {
  const list = ctx.listWidget?.libList;
  if (list?.spareSteps) for (const [type, n] of [['homeTiles', 3], ['homeTonight', 1], ['homeHead', 3], ['homeShelf', 3]]) yield* list.spareSteps(type, n);
  yield* prewarmCovers(ctx);
}

/** Builds the data in idle slices; `ctx.bus` hears msg_home_data_ready when it is in. */
export function warmHome(ctx) {
  if (ctx.homeWarming || !ctx.library) return ctx.homeWarming;
  const tracks = ctx.library.tracks, gen = ctx.homeGen = (ctx.homeGen ?? 0) + 1;
  let value = null;
  ctx.homeWarming = idleSteps(ctx, 'home-shelves', (function* () { value = yield* homeDataSteps(ctx); yield* prewarmRows(ctx); })()).then(() => {
    ctx.homeWarming = null;
    // Changed meanwhile (the library, or marked stale again): built once more.
    if (ctx.library.tracks !== tracks || ctx.homeGen !== gen) { warmHome(ctx); return; }
    ctx.homeDataKept = {tracks, value, stale: false};
    ctx.bus.post('bus_gui', 'msg_home_data_ready', null, {});
  });
  return ctx.homeWarming;
}

/** Marks the kept data stale (a changed library, a playlist, a song played or rated, the history). */
export function homeStale(ctx) {
  if (ctx.homeDataKept) ctx.homeDataKept.stale = true;
  if (ctx.homeWarming) ctx.homeGen = (ctx.homeGen ?? 0) + 1;
}
