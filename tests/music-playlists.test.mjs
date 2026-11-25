// Music's playlists as the owner edits them (owner, 2026-11-25; MUSIC.md §21), in Node with the
// player's own model (frontend/music/src/library/playlists.js) and its edits
// (frontend/music/src/widgets/playlist-edit.js): a name is trimmed, at most 100 characters, and one
// in use takes " 2", " 3"…; songs removed come back at their places with Undo, a Clear brings all
// back, a deleted playlist comes back whole with its id; a Re-Sort only shows an order until Save
// this order keeps it (and its Undo puts the old one back); the duplicates question says how many
// are there, is not asked when none are, and with pl_no_dups skips them. The sync side of a delete
// undone is in tests/music-sync.test.mjs. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/site-imports.mjs';

const { Playlists, NAME_MAX, shownEntries, orderShown } = await import('../frontend/music/src/library/playlists.js');
const edit = await import('../frontend/music/src/widgets/playlist-edit.js');
const { resortEntries } = await import('../frontend/music/src/widgets/resort-dialog.js');

/** The player's Playlists over an invented library, a bus that records, and an Undo bar that keeps its undo. */
function player(settings = {}) {
  const posted = [], state = new Map();
  const bus = { subscribe: () => () => {}, post: (_b, msg, _s, d) => posted.push([msg, d]) };
  const tracks = ['Low Harbor', 'Glass Field', 'Amber Hill', 'Paper Kite', 'Quiet Tide'].map((title, i) => ({ id: 'inv' + (i + 1), title, artist: 'Odd Copper', track: 5 - i }));
  const library = { tracks, byId: new Map(tracks.map((t) => [t.id, t])), db: { setState: async (k, v) => state.set(k, v), deleteState: async (k) => state.delete(k) } };
  const bar = { shown: [] };
  const ctx = { bus, settings, res: { stringByName: (k) => ({ playlist_root_word: 'Playlist' })[k] ?? null }, undoBar: { show: (message, onUndo) => bar.shown.push({ message, onUndo }) } };
  const P = new Playlists(ctx, library);
  return { ctx, P, tracks, posted, state, bar, t: (i) => tracks[i - 1] };
}

test('names: trimmed, at most 100 characters, and one in use takes " 2", " 3"', () => {
  const { P } = player();
  assert.equal(P.create('  Night Drive  ').name, 'Night Drive');
  assert.equal(P.create('night drive').name, 'night drive 2', 'letter case aside, the name is in use');
  assert.equal(P.create('Night Drive').name, 'Night Drive 3');
  assert.equal(P.create('').name, 'Playlist 4', 'no name: the next free "Playlist N"');
  assert.equal(P.defaultName(), 'Playlist 5');
  const long = 'x'.repeat(130);
  assert.equal(P.create(long).name, 'x'.repeat(NAME_MAX));
  const again = P.create(long).name;
  assert.equal(again.length, NAME_MAX, 'the number fits inside the 100');
  assert.ok(again.endsWith(' 2'));
  // Rename: the same rules, its own name is no clash, an empty name changes nothing.
  const pl = P.items[0];
  P.rename(pl, '  Night Drive ');
  assert.equal(pl.name, 'Night Drive');
  P.rename(pl, 'NIGHT DRIVE 3');
  assert.equal(pl.name, 'NIGHT DRIVE 3 2');
  P.rename(pl, '   ');
  assert.equal(pl.name, 'NIGHT DRIVE 3 2');
});

test('songs removed come back at their places with Undo; Clear brings every song back', () => {
  const { ctx, P, t, bar } = player();
  const pl = P.create('Errands');
  P.add(pl, [t(1), t(2), t(3), t(4), t(5)]);
  const gone = edit.removeSongs(ctx, pl, [1, 3]);
  assert.deepEqual(gone, [[1, 'inv2'], [3, 'inv4']]);
  assert.deepEqual(pl.ids, ['inv1', 'inv3', 'inv5']);
  assert.equal(bar.shown.at(-1).message, 'Removed 2 songs');
  bar.shown.at(-1).onUndo();
  assert.deepEqual(pl.ids, ['inv1', 'inv2', 'inv3', 'inv4', 'inv5']);
  edit.removeSongs(ctx, pl, [0]);
  assert.equal(bar.shown.at(-1).message, 'Removed 1 song');
  bar.shown.at(-1).onUndo();
  // Clear (the model's part; the question is the confirm dialog): all out, all back in order.
  const all = P.removeAt(pl, pl.ids.map((_, i) => i));
  assert.deepEqual(pl.ids, []);
  P.putBack(pl, all);
  assert.deepEqual(pl.ids, ['inv1', 'inv2', 'inv3', 'inv4', 'inv5']);
  // Duplicates of one song come back where each was.
  const twice = P.create('Twice');
  P.add(twice, [t(1), t(2), t(1)], 0, { skipDups: false });
  P.putBack(twice, P.removeAt(twice, [0, 2]));
  assert.deepEqual(twice.ids, ['inv1', 'inv2', 'inv1']);
});

test('a deleted playlist comes back whole: the same record, id and songs, saved again', () => {
  const { P, t, state, posted } = player();
  const pl = P.create('Long Walk');
  P.add(pl, [t(2), t(4)]);
  const { id, created } = pl;
  P.remove(pl);
  assert.equal(P.get(id), null);
  assert.equal(state.has('pl:' + id), false);
  P.restore(pl);
  assert.equal(P.get(id), pl);
  assert.deepEqual([pl.id, pl.created, pl.ids], [id, created, ['inv2', 'inv4']]);
  assert.equal(state.get('pl:' + id), pl, 'stored again');
  assert.equal(posted.at(-1)[1].playlist, pl, 'and said to have changed (the sync takes it from there)');
  P.restore(pl);
  assert.equal(P.items.filter((p) => p.id === id).length, 1, 'never twice');
});

test('a Re-Sort only shows an order; Save this order keeps it, and its Undo puts the old one back', () => {
  const { ctx, P, t, bar, tracks } = player();
  const pl = P.create('Sorted');
  P.add(pl, [t(1), t(2), t(3), t(4)]);
  pl.ids.splice(2, 0, 'gone-from-library');
  const before = pl.ids.slice();
  const sort = (e, v) => resortEntries({ pref: () => false }, e, v);
  // By title (1): the rows in that order, each still pointing at its entry; nothing stored moves.
  const byTitle = shownEntries(pl, new Map(tracks.map((x) => [x.id, x])), { value: 1 }, sort);
  assert.deepEqual(byTitle.map((e) => e.track.title), ['Amber Hill', 'Glass Field', 'Low Harbor', 'Paper Kite']);
  assert.deepEqual(byTitle.map((e) => e.at), [3, 1, 0, 4]);
  assert.deepEqual(pl.ids, before);
  // Random keeps the order it drew, by song.
  const rank = new Map([['inv4', 0], ['inv1', 1], ['inv3', 2], ['inv2', 3]]);
  assert.deepEqual(shownEntries(pl, new Map(tracks.map((x) => [x.id, x])), { value: 9, rank }).map((e) => e.track.id), ['inv4', 'inv1', 'inv3', 'inv2']);
  // Save this order: the order shown, the entry not in the library after it; Undo goes back.
  edit.saveOrder(ctx, pl, orderShown(pl, byTitle.map((e) => e.at)));
  assert.deepEqual(pl.ids, ['inv3', 'inv2', 'inv1', 'inv4', 'gone-from-library']);
  assert.equal(bar.shown.at(-1).message, 'Order saved');
  bar.shown.at(-1).onUndo();
  assert.deepEqual(pl.ids, before);
});

test('duplicates: asked with how many are there, not asked when none are, skipped with pl_no_dups', () => {
  const { ctx, P, t } = player();
  const pl = P.create('Road Songs');
  P.add(pl, [t(1), t(2)]);
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(3), t(4)]), { skip: false });
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(1)]), { message: 'This song is already in Road Songs.' });
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(1), t(2)]), { message: 'All 2 songs are already in Road Songs.' });
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(1), t(3), t(4)]), { message: '1 of these 3 songs is already in Road Songs.' });
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(1), t(2), t(3)]), { message: '2 of these 3 songs are already in Road Songs.' });
  const other = P.create('Other Songs');
  P.add(other, [t(3)]);
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl, other], [t(1), t(3)]), { message: '2 of these songs are already in the playlists chosen.' });
  // The answers: Add anyway adds them all, Skip duplicates only the new ones.
  assert.equal(P.add(pl, [t(1), t(3)], 0, { skipDups: true }), 1);
  assert.equal(P.add(pl, [t(1)], 0, { skipDups: false }), 1);
  assert.deepEqual(pl.ids, ['inv1', 'inv2', 'inv3', 'inv1']);
  // pl_no_dups on: no question, skipped (also the model's default then).
  ctx.settings.pl_no_dups = true;
  assert.deepEqual(edit.duplicatesQuestion(ctx, [pl], [t(1)]), { skip: true });
  assert.equal(P.add(pl, [t(2)]), 0);
});

test('a playlist counts its songs in the library, for its rows and for the sort by number', () => {
  const { P, t } = player();
  const a = P.create('Few'), b = P.create('Many entries');
  P.add(a, [t(1), t(2)]);
  P.add(b, [t(3)]);
  b.ids.push('gone-1', 'gone-2');
  assert.deepEqual([P.count(a), P.count(b)], [2, 1]);
  assert.deepEqual(P.sorted(0x40000002).map((p) => p.name), ['Few', 'Many entries']);
});
