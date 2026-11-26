// Music's search over a large library without freezes (frontend/music/src/list/search-prep.js and the
// better search's steps, frontend/th/music/search.js warmSteps / prepareSteps): with the fields made ahead,
// with the tiers worked out ahead for the query, for another query, or cut off by a newer key, the songs
// found and their order are the same as a search from cold. And All Songs' kept orders
// (frontend/music/src/list/sort-cache.js) are the plain sort's, made again for a new library.
// Synthetic songs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartSongs, warmSteps, prepareSteps } from '../frontend/th/music/search.js';
import { sortedTracks, sortedSteps, keptSort } from '../frontend/music/src/list/sort-cache.js';

const title = (t) => t.title;
const plain = (pool, q) => {
  const words = q.trim().split(/[\s:\-_]+/).filter(Boolean).map((w) => w.toLowerCase());
  return pool.filter((t) => words.every((w) => `${t.title}${t.album}${t.artist}`.toLowerCase().includes(w))).sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
};
const WORDS = ['Amber', 'Birch', 'Déjà', 'Fjord', 'Harbor', 'Iris', 'Jade', 'Lumen', 'Moss', 'Nova', 'Opal', 'Rock & Roll', 'Don’t'];
const makePool = () => Array.from({ length: 3000 }, (_, i) => ({ title: `${WORDS[i % 13]} ${WORDS[(i * 7) % 13]} ${i}`, artist: `${WORDS[(i * 3) % 13]} Band`, album: `${WORDS[(i * 5) % 13]} ${i % 90}` }));
const QUERIES = ['amber', 'harbor jade', 'deja', 'rock and roll', 'lumne', 'birhc 12', 'nova band', 'opal 4', 'dont', 'fjrod', 'moss iris 1'];
const drain = (steps) => { for (let r = steps.next(); !r.done; r = steps.next()); };
const search = (pool, q, tf = title, titlesOnly = false) => smartSongs(pool, q, plain(pool, q), tf, titlesOnly);

test('the same songs in the same order: cold, with the fields made ahead, with the tiers made ahead', () => {
  const cold = makePool();
  const want = QUERIES.map((q) => search(cold, q).map((t) => t.title));
  const pool = makePool();
  drain(warmSteps(pool, title));
  QUERIES.forEach((q, i) => assert.deepEqual(search(pool, q).map((t) => t.title), want[i], `"${q}" with the fields made ahead`));
  QUERIES.forEach((q, i) => {
    drain(prepareSteps(pool, q, title));
    assert.deepEqual(search(pool, q).map((t) => t.title), want[i], `"${q}" with its tiers made ahead`);
  });
  // Tiers made for another query, or cut off by a newer key (not done), are not taken.
  drain(prepareSteps(pool, 'amber', title));
  assert.deepEqual(search(pool, 'harbor jade').map((t) => t.title), want[1]);
  const cut = prepareSteps(pool, 'lumne', title);
  cut.next();
  cut.next();
  assert.deepEqual(search(pool, 'lumne').map((t) => t.title), want[4]);
  // Another line shown (file names) or titles only: not the tiers made for the titles.
  drain(prepareSteps(pool, 'amber', title));
  const byFile = (t) => t.album;
  assert.deepEqual(search(pool, 'amber', byFile).map((t) => t.title), search(makePool(), 'amber', byFile).map((t) => t.title));
  assert.deepEqual(search(pool, 'amber', title, true).map((t) => t.title), search(makePool(), 'amber', title, true).map((t) => t.title));
  // A changed list (a library refresh): its own tiers.
  const other = makePool().slice(0, 2000);
  assert.deepEqual(search(other, 'amber').map((t) => t.title), want[0].filter((x) => other.some((t) => t.title === x)));
});

test("All Songs' kept orders: the plain sort's, a new array each time, made again for a new library", () => {
  const cmpTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  const lib = Array.from({ length: 1500 }, (_, i) => ({ title: `Song ${(i * 37) % 500}`, rating: i % 6 }));
  const want = lib.slice().sort(cmpTitle);
  const a = sortedTracks(lib, 1, cmpTitle);
  assert.deepEqual(a, want);
  const b = sortedTracks(lib, 1, cmpTitle);
  assert.deepEqual(b, want);
  assert.notEqual(a, b, 'a copy each time (callers reverse it)');
  b.reverse();
  assert.deepEqual(sortedTracks(lib, 1, cmpTitle), want, 'a caller reversing its copy changes nothing kept');
  // A library change makes a new list: its order is its own.
  const changed = lib.map((t, i) => (i % 10 ? t : { ...t, title: 'A ' + t.title }));
  assert.deepEqual(sortedTracks(changed, 1, cmpTitle), changed.slice().sort(cmpTitle));
  // Orders that follow ratings, plays and last played are made fresh each time.
  const byRating = (x, y) => y.rating - x.rating || cmpTitle(x, y);
  assert.equal(keptSort(5), false);
  const before = sortedTracks(lib, 5, byRating);
  lib[0].rating = 99;
  const after = sortedTracks(lib, 5, byRating);
  assert.equal(after[0], lib[0]);
  assert.notDeepEqual(before, after);
  // Made ahead in steps: the same order, then kept.
  const fresh = lib.slice();
  const steps = sortedSteps(fresh, 1, cmpTitle);
  let r;
  while (!(r = steps.next()).done);
  assert.deepEqual(r.value, fresh.slice().sort(cmpTitle));
  assert.deepEqual(sortedTracks(fresh, 1, () => { throw new Error('sorted again'); }), r.value);
});
