// Music's fast-scroll rail matches the sort on every list (frontend/music/src/list/sections.js; owner
// 2026-11-25): name sorts show letters (Z→A when reversed), sorts by artist, album, album artist, genre,
// composer or folder the first letter of that field, year sorts the years in the list, date sorts the
// months ("’25" where the year changes) with "Nov 24" in the bubble, and number sorts (duration, play
// count, rating, track count, shuffle) none: the plain thumb. Every name is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AZ_CHARS, buildIndex, columnLabels, monthDay, reversedChars, rowItem, sectionChar, sectionIndex, sectionsFor, thinned, letters,
} from '../frontend/music/src/list/sections.js';

const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const song = (title, o = {}) => ({ id: title, title, artist: o.artist ?? '', album: o.album ?? '', year: o.year ?? 0, added: o.added ?? 0, lastPlayed: o.played ?? 0, modified: o.modified ?? 0, fileName: o.file ?? `${title}.flac`, path: o.path });
const songs = (tracks, sections) => ({ tracks, count: tracks.length, sections });
const groups = (gs, sections) => ({ groups: gs, count: gs.length, sections });
const labels = (idx) => idx.entries.map((e) => e.text);
const bubbles = (idx) => Array.from({ length: idx.count }, (_, i) => idx.bubble(i));

test('songs: each sort gives its sections, number sorts none', () => {
  const t = song('Velvet Gate', { artist: 'Orchard Lamps', album: 'Kite Weather', year: 2011, added: day(2026, 11, 24), played: day(2025, 3, 2), modified: day(2024, 6, 9), file: 'b-side.flac', path: '/Moss/Kite Weather/01.flac' });
  const read = (value) => { const s = sectionsFor({ value }); return s && [s.type, s.of(t)]; };
  assert.deepEqual(read(1), ['letters', 'Velvet Gate']);
  assert.deepEqual(read(2), ['letters', 'b-side.flac']);
  assert.deepEqual(read(14), ['letters', 'Moss/Kite Weather/01.flac'], 'a path by its top folder, not its slash');
  assert.deepEqual(read(8), ['letters', 'Orchard Lamps']);
  assert.deepEqual(read(9), ['letters', 'Kite Weather']);
  assert.deepEqual(read(3), ['years', 2011]);
  assert.deepEqual(read(15), ['years', 2011]);
  assert.deepEqual(read(12), ['months', day(2026, 11, 24)]);
  assert.deepEqual(read(7), ['months', day(2025, 3, 2)]);
  assert.deepEqual(read(4), ['months', day(2024, 6, 9)]);
  assert.equal(sectionsFor({ value: 4 }).of({ added: 5 }), 5, 'date modified falls back to date added');
  for (const value of [0, 13, 5, 10, 6, 11]) assert.equal(sectionsFor({ value }), null, `sort ${value}: the plain thumb`);
});

test('groups: each sort gives its sections, without "the" where the sort leaves it out', () => {
  const album = { kind: 'album', title: 'The Paper Orchard', artist: 'The Lindens', tracks: [{ artist: 'The Lindens', albumArtist: 'A Wren Choir', added: 7, year: 2014 }, { added: 9, year: 2012 }], path: '/Quiet/Paper' };
  const read = (group, o = {}) => { const s = sectionsFor({ group, ...o }); return s && [s.type, s.of(album)]; };
  assert.deepEqual(read('0'), ['letters', 'The Paper Orchard']);
  assert.deepEqual(read('0', { articles: true }), ['letters', 'Paper Orchard']);
  assert.deepEqual(read('artist', { articles: true }), ['letters', 'Lindens']);
  assert.deepEqual(read('albumArtist', { articles: true }), ['letters', 'Wren Choir']);
  assert.deepEqual(read('year'), ['years', 2012], 'an album by its earliest year');
  assert.deepEqual(read('added'), ['months', 9], 'by its newest song');
  assert.deepEqual(read('path'), ['letters', 'Quiet/Paper']);
  assert.deepEqual(read('pathCs'), ['letters', 'Quiet/Paper']);
  assert.equal(sectionsFor({ group: 'count' }), null, 'track count: the plain thumb');
  const pl = { title: 'Rainy Mix', tracks: [], pl: { created: 3, modified: 4 } };
  assert.equal(sectionsFor({ group: 'added' }).of(pl), 3);
  assert.equal(sectionsFor({ group: 'modified' }).of(pl), 4);
  // The Years list's names are years.
  const s = sectionsFor({ group: '0', yearTitles: true });
  assert.equal(s.type, 'years');
  assert.deepEqual(labels(buildIndex(groups([{ title: '1998' }, { title: '2004' }, { title: 'Unknown year' }], s))), ['1998', '2004', '#']);
});

test('letters: the alphabet column; an empty letter goes to the next later one; reversed runs Z→A', () => {
  const list = songs([song('#hashtag'), song('4 Corners'), song('Amber Field'), song('Ash Lane'), song('Cinder'), song('Éclair Road'), song('Zephyr')], sectionsFor({ value: 1 }));
  const idx = buildIndex(list);
  assert.deepEqual(labels(idx).join(''), AZ_CHARS);
  assert.deepEqual(bubbles(idx), ['#', '0', 'A', 'A', 'C', 'E', 'Z']);
  const at = (ch) => idx.rowFor(AZ_CHARS.indexOf(ch));
  assert.equal(at('A'), 2);
  assert.equal(at('B'), 4, 'B (none) goes to C');
  assert.equal(at('E'), 5, 'an accented letter under its letter');
  assert.equal(at('#'), 0, 'symbol titles sort first');
  assert.equal(idx.touchBubble(AZ_CHARS.indexOf('B'), 4), 'B', 'the bubble shows the touched letter');

  const rev = songs([...list.tracks].reverse(), sectionsFor({ value: 1, reversed: true }));
  const r = buildIndex(rev);
  assert.equal(labels(r).join(''), 'ZYXWVUTSRQPONMLKJIHGFEDCBA0#');
  assert.equal(reversedChars(), 'ZYXWVUTSRQPONMLKJIHGFEDCBA0#');
  assert.equal(r.rowFor(labels(r).indexOf('C')), 2);
  assert.equal(r.rowFor(labels(r).indexOf('B')), 3, 'B (none) goes to A, the next one down');
  assert.equal(r.rowFor(labels(r).indexOf('#')), 6);
});

test('letters by field: songs by album, groups by artist', () => {
  const byAlbum = songs([song('x1', { album: '' }), song('x2', { album: 'Brass Tide' }), song('x3', { album: 'Brass Tide' }), song('x4', { album: 'Marrow' })], sectionsFor({ value: 9 }));
  assert.deepEqual(bubbles(buildIndex(byAlbum)), ['#', 'B', 'B', 'M']);
  const byArtist = groups([{ title: 'Zinc', artist: 'The Corvids', tracks: [] }, { title: 'Alder', artist: 'Dune Static', tracks: [] }], sectionsFor({ group: 'artist', articles: true }));
  assert.deepEqual(bubbles(buildIndex(byArtist)), ['C', 'D']);
});

test('years: the years in list order, unknown as "#", the exact year in the bubble', () => {
  const list = songs([song('a', { year: 0 }), song('b', { year: 1999 }), song('c', { year: 1999 }), song('d', { year: 2003 }), song('e', { year: 2021 })], sectionsFor({ value: 3 }));
  const idx = buildIndex(list);
  assert.deepEqual(labels(idx), ['#', '1999', '2003', '2021']);
  assert.deepEqual(idx.first, [0, 1, 3, 4]);
  assert.equal(idx.rowFor(1, 0.9), 1, 'a year goes to its first row');
  assert.equal(idx.touchBubble(2, 3), '2003');
  const rev = buildIndex(songs([...list.tracks].reverse(), sectionsFor({ value: 3, reversed: true })));
  assert.deepEqual(labels(rev), ['2021', '2003', '1999', '#']);
});

test('months: short names, the year where it changes, "Nov 24" in the bubble, days scrubbed', () => {
  const added = [day(2026, 11, 24), day(2026, 11, 3), day(2026, 10, 30), day(2026, 1, 2), day(2025, 12, 31), day(2025, 11, 1), 0];
  const list = songs(added.map((a, i) => song(`s${i}`, { added: a })), sectionsFor({ value: 12 }));
  const idx = buildIndex(list);
  assert.deepEqual(labels(idx), ['Nov', 'Oct', 'Jan', 'Dec', 'Nov', '#']);
  assert.deepEqual(columnLabels(idx.entries, thinned(6, 6), 2026), ['Nov', 'Oct', 'Jan', '’25', 'Nov', '#']);
  assert.deepEqual(columnLabels(idx.entries, thinned(6, 6), 2027), ['’26', 'Oct', 'Jan', '’25', 'Nov', '#'], 'the first label shows a year that is not this one');
  assert.deepEqual(bubbles(idx), ['Nov 24', 'Nov 3', 'Oct 30', 'Jan 2', 'Dec 31', 'Nov 1', '#']);
  assert.equal(monthDay(day(2024, 2, 29)), 'Feb 29');
  // Within November 2026 (two songs) the finger moves from the 24th to the 3rd.
  assert.equal(idx.rowFor(0, 0.1), 0);
  assert.equal(idx.rowFor(0, 0.6), 1);
  assert.equal(idx.touchBubble(0, idx.rowFor(0, 0.6)), 'Nov 3');
  // Oldest first (reversed): the years where they change, from the first.
  const rev = buildIndex(songs([...list.tracks].reverse().slice(1), sectionsFor({ value: 12, reversed: true })));
  assert.deepEqual(columnLabels(rev.entries, thinned(rev.entries.length, 99), 2026), ['’25', 'Dec', '’26', 'Oct', 'Nov']);
});

test('a column that does not fit shows an even spread; the finger still reaches every section', () => {
  assert.deepEqual(thinned(5, 9), [0, 1, 2, 3, 4]);
  const t = thinned(28, 25);
  assert.equal(t.length, 25);
  assert.equal(t[0], 0);
  assert.equal(t.at(-1), 27);
  assert.ok(t.every((v, i) => i === 0 || v > t[i - 1]), 'in order, no repeats');
  const years = Array.from({ length: 60 }, (_, i) => 1960 + i);
  const shown = thinned(years.length, 12);
  assert.equal(shown.length, 12);
  assert.ok(shown.at(-1) - shown[0] >= 50, 'spread over the whole list');
});

test('subheads read the row after them; a list without a sort has no sections', () => {
  const rows = [{ sep: 'Willow · Pale Arc · 2' }, { track: song('Willow') }, { track: song('willow') }];
  const src = { pageRows: rows, tracks: [rows[1].track, rows[2].track], count: 3, sections: letters((t) => t?.title) };
  assert.equal(rowItem(src, 0), rows[1].track);
  assert.deepEqual(bubbles(buildIndex(src)), ['W', 'W', 'W']);
  assert.equal(buildIndex({ tracks: [song('a')], count: 1 }), null);
  assert.equal(buildIndex(songs([], sectionsFor({ value: 1 }))), null, 'no rows: no column');
});

test('the index is kept per source until its rows change', () => {
  const src = songs([song('Bell'), song('Moth')], sectionsFor({ value: 1 }));
  const a = sectionIndex(src);
  assert.equal(sectionIndex(src), a);
  src.tracks = [song('Moth'), song('Bell')];
  assert.notEqual(sectionIndex(src), a);
  assert.equal(sectionChar('  ', AZ_CHARS), '#');
  assert.equal(sectionChar(42), '0');
});
