// Home's last shelves kept on the phone (data.js), so the next start shows them at once instead of the
// chips alone until the shelves are built again in idle time; the fresh ones then take their place in
// the same rows (install.js refresh keeps the scroll). Kept by reference only: songs by id, playlists by
// id, albums by their songs' ids (their title and artist read from the first song, as groups.js names an
// album), artists and genres by the name the library groups them under (groups.js namedSteps) and their
// songs' ids. What is no longer in the library is left out; nothing left at all reads as nothing kept.
import {playlistRecent} from './rules.js';

const KEY = 'cp-home-shelves', VERSION = 1;
const GROUPS = ['recentAlbums', 'mostPlayed', 'mostPlayedArtists', 'recentArtists', 'artists', 'albumsAz', 'artistsAz'];
const SONGS = ['liked', 'forgotten', 'recentSongs', 'newSongs'];
const COUNTS = ['forgottenCount', 'albumCount', 'artistCount'];

const ids = tracks => tracks.map(t => t.id);
const group = g => (g.kind === 'album' ? {k: 'album', i: ids(g.tracks)} : {k: g.kind, n: g.title, i: ids(g.tracks)});
const playlist = p => p.pl.id;

/** The data as it is kept (ids and names only). */
export function keptForm(value) {
  const out = {v: VERSION};
  for (const k of SONGS) out[k] = ids(value[k] ?? []);
  for (const k of GROUPS) out[k] = (value[k] ?? []).map(group);
  for (const k of COUNTS) out[k] = value[k] ?? 0;
  out.playlists = (value.playlists ?? []).map(playlist);
  out.plLately = (value.plLately ?? []).map(playlist);
  out.tiles = (value.tiles ?? []).map(t => (t.kind === 'playlist' ? {k: 'playlist', p: t.pl.id} : {k: t.kind, g: group(t.g)}));
  const r = value.rotating;
  out.rotating = r ? {kind: r.kind, title: r.title, decade: r.decade ?? null, albums: r.albums.map(group), genre: r.group?.title ?? null} : null;
  return out;
}

/** The kept form read back against the library and playlists as they are now; null when nothing is left. */
export function fromKept(ctx, kept) {
  const lib = ctx.library, byId = lib?.byId, P = ctx.playlists;
  if (!kept || kept.v !== VERSION || !byId?.size) return null;
  const songs = list => (list ?? []).map(id => byId.get(id)).filter(Boolean);
  const unknownAlbum = ctx.res?.stringByName?.('unknown_album_name') ?? 'Unknown album';
  const named = (kind, name, tracks) => ({kind, title: name, tracks});
  const toGroup = x => {
    const tracks = songs(x?.i);
    if (!tracks.length) return null;
    if (x.k !== 'album') return named(x.k, x.n ?? '', tracks);
    const t = tracks[0];
    return {kind: 'album', title: t.album || unknownAlbum, artist: t.albumArtist || t.artist || '', tracks, artId: tracks.find(s => s.artId)?.artId};
  };
  const groups = list => (list ?? []).map(toGroup).filter(Boolean);
  const pls = list => (list ?? []).map(id => P?.items?.find(p => p.id === id)).filter(Boolean).map(pl => { const ts = P.tracksOf(pl); return {pl, tracks: ts, last: playlistRecent(pl, ts)}; });
  const value = {};
  for (const k of SONGS) value[k] = songs(kept[k]);
  for (const k of GROUPS) value[k] = groups(kept[k]);
  for (const k of COUNTS) value[k] = +kept[k] || 0;
  value.playlists = pls(kept.playlists);
  value.plLately = pls(kept.plLately);
  value.tiles = (kept.tiles ?? []).map(t => {
    if (t.k === 'playlist') { const p = pls([t.p])[0]; return p && {kind: 'playlist', pl: p.pl, tracks: p.tracks, last: p.last}; }
    const g = toGroup(t.g);
    return g && {kind: t.k, g, last: 0};
  }).filter(Boolean);
  const r = kept.rotating, albums = r ? groups(r.albums) : [];
  value.rotating = r && albums.length ? {kind: r.kind, title: r.title, ...(r.decade != null ? {decade: r.decade} : {}), albums, ...(r.genre ? {group: genreGroup(lib, r.genre)} : {})} : null;
  const any = SONGS.some(k => value[k].length) || GROUPS.some(k => value[k].length) || value.playlists.length || value.tiles.length;
  return any ? value : null;
}

/** A genre's songs, found when its "See all" asks for them (the genre's name as the library splits it). */
function genreGroup(lib, name) {
  const key = name.toLowerCase();
  let tracks = null;
  return {
    kind: 'genre', title: name,
    get tracks() { return (tracks ??= lib.tracks.filter(t => lib.namesOf(t, 'genre').names.some(n => n.toLowerCase() === key))); },
  };
}

/** The kept shelves, for this library (null: none, or none of it left). */
export function readKept(ctx) {
  try { return fromKept(ctx, JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return null; }
}

/** Keeps the data on the phone, in idle time (it is a few kilobytes of ids). */
export function saveKept(value) {
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(keptForm(value))); } catch { /* storage full or blocked: built again next start */ } };
  if (globalThis.requestIdleCallback) requestIdleCallback(save, {timeout: 5000});
  else setTimeout(save, 0);
}
