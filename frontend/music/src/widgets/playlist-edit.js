// Playlist changes the owner makes (owner, 2026-11-25), each with the app's own dialogs and the
// Undo bar (undo-bar.js):
// - a new playlist asks for its name first (the text dialog, "Playlist N" offered and selected;
//   Cancel makes nothing); a name is trimmed, at most NAME_MAX characters, and one in use takes
//   " 2", " 3"… (library/playlists.js);
// - Rename is the same dialog with the playlist's name;
// - Delete asks first, then says so with Undo, which brings the playlist back whole (same id, same
//   songs; the sync's queued deletion goes with it, th/music/sync.js);
// - songs removed from a playlist go at once, with Undo putting each back at its place;
// - Clear asks first, then Undo brings every song back;
// - songs a playlist already holds: the confirm dialog asks Add anyway or Skip duplicates, saying
//   how many are there (nothing is asked when none are, or with pl_no_dups on: skipped).
// Every dialog here closes on Android Back (dialog.js closeOnBack).
import {alertDialog, editNameDialog} from './dialog.js';
import {NAME_MAX} from '../library/playlists.js';

export const WORDS = {
  addAnyway: 'Add anyway', skipDups: 'Skip duplicates',
  oneThere: 'This song is already in %s.', allThere: 'All %d songs are already in %s.',
  someThere1: '1 of these %n songs is already in %s.', someThere: '%d of these %n songs are already in %s.',
  severalThere: '%d of these songs are already in the playlists chosen.',
  removed1: 'Removed 1 song', removed: 'Removed %d songs', cleared: 'Cleared %s', deleted: 'Deleted %s', deletedN: 'Deleted %d playlists',
  saved: 'Order saved', addedTo: 'Added to %s',
  empty: 'No songs yet. Select songs and choose Playlist.',
  // The Playlists list, and Add to Playlist (list/sources.js, playlist-dialog.js), with none.
  noPlaylists: 'No playlists yet.', noPlaylistsAdd: 'No playlists yet. Tap + to make one.',
};
// The Undo bar's icon: the menus' playlist glyph (24 dp), which reads at the bar's size.
const ICON = '@drawable/playlist_24dp';

const str = (ctx, k, f = k) => ctx.res.stringByName(k) ?? f;
const undo = (ctx, message, onUndo) => ctx.undoBar?.show(message, onUndo, {icon: ICON});

/**
 * Rename, Delete and Download at the end of a list header's menu (merge_menu_items_tracks), as its own
 * items are (?PopupMenuItem); shown for a playlist only, Download for an album page too (list-widget.js prepareListMenu).
 */
export function playlistMenuItems(ctx, items) {
  if (!items || items.findViewById('pl_rename')) return;
  const node = (id, text, icon) => ['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/' + id, 'android:visibility': 'gone', 'android:text': text, 'android:drawable': icon,
    'w:busId': '@id/list', 'w:msgId': '@id/cmd_list_' + id, style: '?PopupMenuItem',
  }];
  ctx.inflater.inflateNode(node('pl_rename', str(ctx, 'rename', 'Rename'), '?rename_24dp'), items);
  ctx.inflater.inflateNode(node('pl_delete', str(ctx, 'delete', 'Delete'), '?delete_24dp'), items);
  // Download (widgets/downloads.js): a playlist's, and an album page's too (prepareListMenu).
  ctx.inflater.inflateNode(node('pl_download', 'Download', '@drawable/import_24dp'), items);
}

/** Asks a new playlist's name; onMade(playlist) once it is made (not on Cancel). */
export function newPlaylist(ctx, {onMade = null} = {}) {
  const P = ctx.playlists;
  if (!P) return null;
  return editNameDialog(ctx, {
    title: str(ctx, 'add_new_playlist', 'Add New Playlist'), value: P.defaultName(), maxLength: NAME_MAX,
    onDone: name => onMade?.(P.create(name)),
  });
}

export function renamePlaylist(ctx, pl) {
  const P = ctx.playlists;
  if (!P || !pl) return null;
  return editNameDialog(ctx, {title: str(ctx, 'rename', 'Rename'), value: pl.name, maxLength: NAME_MAX, onDone: name => P.rename(pl, name)});
}

/** Delete (confirmed, as before), then the Undo bar; then() follows the dialog out. */
export function deletePlaylists(ctx, pls, {then = null} = {}) {
  const P = ctx.playlists;
  if (!P || !pls.length) return null;
  return alertDialog(ctx, {
    title: str(ctx, 'delete', 'Delete'), message: pls.map(p => p.name).join(', '), positive: str(ctx, 'delete', 'Delete'),
    onPositive: d => {
      for (const p of pls) P.remove(p);
      undo(ctx, pls.length === 1 ? WORDS.deleted.replace('%s', pls[0].name) : WORDS.deletedN.replace('%d', pls.length), () => pls.forEach(p => P.restore(p)));
      if (then) d.afterBack(then);
    },
  });
}

/** Entries (playlist indices) out at once; Undo puts each back at its place. */
export function removeSongs(ctx, pl, indices) {
  const P = ctx.playlists, gone = P?.removeAt(pl, indices) ?? [];
  if (gone.length) undo(ctx, gone.length === 1 ? WORDS.removed1 : WORDS.removed.replace('%d', gone.length), () => P.putBack(pl, gone));
  return gone;
}

/** Clear (confirmed, as before), then Undo brings every song back. */
export function clearPlaylist(ctx, pl) {
  const P = ctx.playlists;
  if (!P || !pl) return null;
  return alertDialog(ctx, {
    title: pl.name, message: str(ctx, 'clear', 'Clear') + '?', positive: str(ctx, 'clear', 'Clear'),
    onPositive: () => {
      const gone = P.removeAt(pl, pl.ids.map((_, i) => i));
      if (gone.length) undo(ctx, WORDS.cleared.replace('%s', pl.name), () => P.putBack(pl, gone));
    },
  });
}

/** A playlist's entries kept in the order shown (before: the order to go back to with Undo). */
export function saveOrder(ctx, pl, ids) {
  const P = ctx.playlists, before = pl.ids.slice();
  P.reorder(pl, ids);
  undo(ctx, WORDS.saved, () => P.reorder(pl, before));
}

/**
 * What to do about songs the playlists already hold: {skip} with no question (none there: add all;
 * pl_no_dups on: skip them), else {message}, the question saying how many are there.
 */
export function duplicatesQuestion(ctx, pls, tracks) {
  const P = ctx.playlists;
  const dups = pls.reduce((n, pl) => n + P.duplicates(pl, tracks), 0);
  if (!dups) return {skip: false};
  if (ctx.settings?.pl_no_dups === true) return {skip: true};
  if (pls.length > 1) return {message: WORDS.severalThere.replace('%d', dups)};
  const name = pls[0].name;
  if (tracks.length === 1) return {message: WORDS.oneThere.replace('%s', name)};
  if (dups >= tracks.length) return {message: WORDS.allThere.replace('%d', tracks.length).replace('%s', name)};
  return {message: (dups === 1 ? WORDS.someThere1 : WORDS.someThere.replace('%d', dups)).replace('%n', tracks.length).replace('%s', name)};
}

/**
 * Before songs go into playlists: when some are already there, the confirm dialog asks Add anyway
 * or Skip duplicates (with pl_no_dups on, skipped without asking); then add(skipDups). Closing it
 * otherwise (Back, a tap outside) adds nothing.
 */
export function askDuplicates(ctx, pls, tracks, add) {
  const q = duplicatesQuestion(ctx, pls, tracks);
  if (!q.message) { add(q.skip); return null; }
  const message = q.message;
  return alertDialog(ctx, {
    title: str(ctx, 'add_to_playlist', 'Add to Playlist'), message, positive: WORDS.addAnyway, negative: WORDS.skipDups,
    onPositive: () => add(false), onNegative: () => add(true),
  });
}
