// Downloads (owner, 2026-11-26): the owner's own songs saved to the phone's Downloads, as they are stored.
// - "Download" in the playing song's menu (a row of the menu's own under its row of four, downloadMenuItem):
//   the song as one file, "Artist - Title.opus".
// - "Download" on the selection toolbar of a list of songs (downloadButton): one song as its file, several
//   as one zip named after the list.
// - "Download" in a playlist's menu, beside Rename and Delete (playlist-edit.js playlistMenuItems), and in
//   an album page's: one zip, its songs numbered in the playlist's stored order or by disc and track as the
//   album page has them; a playlist's zip carries its .m3u8 too (playlist-files.js m3uText). Songs the
//   library no longer has are left out and counted (skipped.txt in the zip says so).
// Covers (owner, 2026-11-26): each Opus song is saved with its cover embedded (the worker's th/music/ogg-cover.js),
// the cover from the phone's own covers when it is there; an album's zip also carries the album's cover (cover.jpg
// or cover.png); a song in another format is saved as stored. The size and the ask count the songs only.
// Names: library/download-names.js. Over ASK_BYTES in all (the catalogue's sizes), the confirm dialog asks
// first; under it the download just starts. Music's worker streams the file (th/music/downloads.js): the
// page posts it the job, then goes to its address, which the browser takes as a download with its own
// notification; here, one Undo-bar line as it starts and one when the worker says it has ended. One at a
// time; signed out, nothing starts.
import {alertDialog} from './dialog.js';
import {albumName, cleanName, entryNames, extensionOf, songFile} from '../library/download-names.js';
import {m3uText} from '../library/playlist-files.js';
import {albumRows} from '../library/shelves.js';
import {VISIBLE} from '../res/values.js';

export const WORDS = {
  download: 'Download', starting: 'Downloading %s…', saved: 'Saved to Downloads', failed: 'Could not finish the download',
  some1: 'Saved, 1 song could not be added', some: 'Saved, %d songs could not be added',
  signIn: 'Sign in to download.', busy: 'A download is already running.', ask: '%s: %d songs, about %m MB. Download?', ask1: '%s: 1 song, about %m MB. Download?',
};
export const ASK_BYTES = 200 * 1024 * 1024;
const MB = 1024 * 1024;
const ICON = '@drawable/import_24dp';
/** The worker answers a job within this, or the download could not start. */
const ANSWER_MS = 10_000;
const SONG = /\/music\/library\/audio\/r2_[A-Za-z0-9_-]{10,200}$/;

/** The job running (its id), as far as this page knows; the worker is the one that decides. */
let running = null;

const str = (ctx, k, f) => ctx.res?.stringByName?.(k) ?? f;
/** One line in the Undo bar's place, with no Undo (the app's toast where there is no bar). */
function line(ctx, text) {
  if (ctx.undoBar) ctx.undoBar.show(text, null, {icon: ICON});
  else ctx.bus.post('bus_gui', 'cmd_gui_show_toast', null, {title: text});
}

/** The confirm dialog's question: "<name>: N songs, about X MB. Download?". */
export function askText(name, count, bytes) {
  const mb = Math.max(1, Math.round(bytes / MB)).toLocaleString('en-US');
  return (count === 1 ? WORDS.ask1 : WORDS.ask.replace('%d', count)).replace('%s', name).replace('%m', mb);
}

/** A song the worker can fetch: one of the library's (its address the player's). */
const fetchable = t => typeof t?.src === 'string' && SONG.test(t.src);
/** A song's cover as the worker reads it: its address (the player's), and the keys library.js keeps it under in
 * claude-player-covers (cacheKey: a shared cover's own, then the song's address), so one on the phone costs no data. */
function coverOf(t) {
  if (typeof t?.artUrl !== 'string' || !t.artUrl) return null;
  const shared = t.coverKey ? new URL('covers/shared/' + encodeURIComponent(t.coverKey), location.href).href : null;
  return {src: t.artUrl, keys: shared ? [shared, t.artUrl] : [t.artUrl]};
}
const fileOf = (t, name) => ({src: t.src, name, size: +t.size || 0, type: t.mime || 'audio/ogg', art: extensionOf(t) === 'opus' ? coverOf(t) : null});

/** The job for songs: one as its file, several as one zip named after `title`. */
export function songsJob(tracks, title = '') {
  const have = tracks.filter(fetchable);
  if (have.length === 1 && tracks.length === 1) return {name: songFile(have[0]), label: songFile(have[0]).replace(/\.[^.]+$/, ''), zip: false, files: [fileOf(have[0], songFile(have[0]))], missing: 0};
  const names = entryNames(have);
  const label = cleanName(title, 'Songs');
  return {name: `${label}.zip`, label, zip: true, files: have.map((t, i) => fileOf(t, names[i])), missing: tracks.length - have.length};
}

/** A playlist's zip: its songs numbered in its stored order, its .m3u8 listing them; missing ones counted. */
export function playlistJob(library, pl) {
  const tracks = pl.ids.map(id => library.byId.get(id)).filter(fetchable);
  const names = entryNames(tracks, {numbered: true}), label = cleanName(pl.name);
  return {
    name: `${label}.zip`, label: pl.name, zip: true, files: tracks.map((t, i) => fileOf(t, names[i])), missing: pl.ids.length - tracks.length,
    m3u: {name: `${label}.m3u8`, text: m3uText(tracks.map((t, i) => ({path: names[i], rating: t.rating})))},
  };
}

/** An album's zip ("Album Artist - Album"): its songs numbered by disc and track, as its page orders them. */
export function albumJob(g) {
  const all = albumRows(g.tracks).tracks, tracks = all.filter(fetchable);
  const artist = g.artist || g.tracks.find(t => t.albumArtist)?.albumArtist || g.tracks[0]?.artist || '';
  const label = albumName(artist, g.title), names = entryNames(tracks, {numbered: true});
  const cover = coverOf(tracks.find(t => t.artUrl));
  return {name: `${label}.zip`, label, zip: true, files: tracks.map((t, i) => fileOf(t, names[i])), missing: all.length - tracks.length, cover};
}

/** The worker's answer to a job: {id} or {error}. */
function post(sw, job) {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({error: 'timeout'}), ANSWER_MS);
    ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data ?? {error: 'bad'}); };
    const {name, zip, files, m3u, missing, cover} = job;
    sw.postMessage({type: 'th-music-download', job: {name, zip, files, m3u, missing, cover}}, [ch.port2]);
  });
}

async function go(ctx, job) {
  if (running) return line(ctx, WORDS.busy);
  const sw = navigator.serviceWorker?.controller;
  if (!sw || !job.files.length) return line(ctx, WORDS.failed);
  running = {id: null};
  const got = await post(sw, job);
  if (!got.id) {
    running = null;
    return line(ctx, got.error === 'busy' ? WORDS.busy : got.error === 'signed-out' ? WORDS.signIn : WORDS.failed);
  }
  running = {id: got.id};
  line(ctx, WORDS.starting.replace('%s', job.label));
  // The worker answers this address with the file (an attachment: the page stays where it is).
  location.assign(new URL(`../../download/${got.id}`, import.meta.url).href);
}

/** Starts a job: over ASK_BYTES, once the confirm dialog's Download is chosen (Cancel starts nothing). */
export function startDownload(ctx, job) {
  if (running) { line(ctx, WORDS.busy); return null; }
  const bytes = job.files.reduce((n, f) => n + f.size, 0);
  if (bytes <= ASK_BYTES) { go(ctx, job); return null; }
  return alertDialog(ctx, {
    message: askText(job.label, job.files.length, bytes), positive: WORDS.download, negative: str(ctx, 'cancel', 'Cancel'),
    onPositive: () => go(ctx, job),
  });
}

/** "Download" in the playing song's menu: a row of its own items, under the row of four (up-next.js queueMenuItems). */
export function downloadMenuItem(ctx, items) {
  if (!items || items.findViewById('download_song')) return;
  const sep = items.findViewById('queue_separator');
  ctx.inflater.inflateNode(['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/download_song', 'android:text': WORDS.download, 'android:drawable': ICON,
    'w:busId': '@id/bus_gui', 'w:msgId': '@id/cmd_download_playing', style: '?PopupMenuItem',
  }], items, null, {at: sep ? items.children.indexOf(sep) + 1 : 0});
}

/** The height a shown Download row adds to its menu (list-widget.js openItemMenu raises the menu's cap by it). */
export function downloadRoom(items) {
  let h = 0;
  for (const id of ['download_song', 'pl_download']) {
    const v = items?.findViewById(id);
    if (v && v.visibility === VISIBLE) h += v.measuredHeight || 0;
  }
  return h;
}

/** "Download" on the selection toolbar of a list of songs, after Share (selection.js, before its bindings). */
export function downloadButton(ctx, items, layoutName) {
  if (!items || !/^merge_selection_menu_(list_tracks|queue)_items$/.test(layoutName ?? '') || items.findViewById('download_selected')) return;
  const share = items.findViewById('send');
  ctx.inflater.inflateNode(['com.maxmpz.widget.base.BusStateEnabledActionButton', {
    'android:id': '@id/download_selected', 'android:text': WORDS.download, 'android:drawable': ICON, 'w:msgId': '@id/cmd_list_download',
    'w:stateId': '@id/state_list_something_selected', 'w:stateMsgId': '@id/state_list_selection_count', style: '?SelectionListContextButton',
  }], items, null, {at: share ? items.children.indexOf(share) + 1 : items.children.length});
}

export function installDownloads(ctx) {
  ctx.bus.subscribe('bus_gui', msg => {
    if (msg !== 'cmd_download_playing') return;
    const t = ctx.player?.track;
    if (t) startDownload(ctx, songsJob([t]));
  });
  ctx.bus.subscribe('list', msg => {
    const lw = ctx.listWidget, src = lw?.stack?.[lw.stack.length - 1];
    if (msg === 'cmd_list_pl_download') {
      if (src?.playlist && ctx.playlists?.get(src.playlist.id)) startDownload(ctx, playlistJob(ctx.library, src.playlist));
      else if (src?.group?.kind === 'album') startDownload(ctx, albumJob(src.group));
    } else if (msg === 'cmd_list_download') {
      const list = ctx.selectionOwner ?? lw?.libList;
      if (!list?.selection?.size) return;
      const tracks = list.selectedTracks();
      list.endSelection();
      startDownload(ctx, songsJob(tracks, src?.playlist?.name ?? src?.title));
    }
  });
  navigator.serviceWorker?.addEventListener('message', e => {
    const d = e.data;
    if (d?.type !== 'th-music-download-done' || (running?.id && running.id !== d.id)) return;
    running = null;
    line(ctx, !d.ok ? WORDS.failed : !d.missing ? WORDS.saved : d.missing === 1 ? WORDS.some1 : WORDS.some.replace('%d', d.missing));
  });
}
