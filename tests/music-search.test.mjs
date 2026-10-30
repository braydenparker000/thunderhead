// The Music player's better search (frontend/th/music/search.js; MUSIC.md §8): never worse than
// the player's own (every song it finds stays found, over 300 random queries), better on accents,
// punctuation, word order and one typo, and best first; fast on a 7,000-song library. Synthetic songs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, oneOff, smartSongs } from '../frontend/th/music/search.js';

const SONGS = [
  { title: 'Ride of the Valkyries', artist: 'Wiener Philharmoniker', album: 'Wagner: Orchestral Highlights' },
  { title: 'Mars, the Bringer of War', artist: 'London Symphony Orchestra', album: 'Holst: The Planets' },
  { title: 'O Fortuna', artist: 'Carl Orff', album: 'Carmina Burana' },
  { title: 'Déjà Vu', artist: 'Beyoncé', album: 'B’Day' },
  { title: 'Don’t Stop Me Now', artist: 'Queen', album: 'Jazz' },
  { title: 'Highway to Hell', artist: 'AC/DC', album: 'Highway to Hell' },
  { title: 'Rock & Roll', artist: 'Led Zeppelin', album: 'Led Zeppelin IV' },
  { title: 'Mars', artist: 'Another Band', album: 'Planets' },
  { title: 'Marshmallow Sky', artist: 'Mars Lane', album: 'Soft' },
  { title: 'Clair de Lune', artist: 'Claude Debussy', album: 'Suite bergamasque' },
];
const title = (t) => t.title;
/** The player's own search: every lower-case word inside title + album + artist, A–Z by title. */
const plain = (pool, q) => {
  const words = q.trim().split(/[\s:\-_]+/).filter(Boolean).map((w) => w.toLowerCase());
  return pool
    .filter((t) => words.every((w) => `${t.title}${t.album}${t.artist}`.toLowerCase().includes(w)))
    .sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
};
const search = (q, pool = SONGS) => smartSongs(pool, q, plain(pool, q), title).map((t) => t.title);

test('normalising: accents, case, apostrophes, & and punctuation', () => {
  assert.equal(norm('Déjà Vu'), 'deja vu');
  assert.equal(norm('Don’t Stop'), 'dont stop');
  assert.equal(norm('Rock & Roll'), 'rock and roll');
  assert.equal(norm('AC/DC'), 'ac dc');
  assert.ok(oneOff('valkyries', 'valkyreis') && oneOff('fortuna', 'fortna') && oneOff('mars', 'marz'));
  assert.ok(!oneOff('fortuna', 'futura'));
});

test('better: accents, punctuation, any word order, one typo; best first', () => {
  assert.deepEqual(search('deja vu'), ['Déjà Vu']);
  assert.deepEqual(search('beyonce'), ['Déjà Vu']);
  assert.deepEqual(search('dont stop'), ['Don’t Stop Me Now']);
  assert.deepEqual(search('ac dc'), ['Highway to Hell']);
  assert.deepEqual(search('rock and roll'), ['Rock & Roll']);
  assert.deepEqual(search('valkyries wagner'), ['Ride of the Valkyries']);
  assert.deepEqual(search('valkyreis'), ['Ride of the Valkyries']);
  assert.deepEqual(search('fortna'), ['O Fortuna']);
  assert.deepEqual(search('debusy'), ['Clair de Lune']);
  // The title that is the query first, then a title that starts with it, then an artist, then the rest.
  assert.deepEqual(search('mars'), ['Mars', 'Mars, the Bringer of War', 'Marshmallow Sky']);
  assert.deepEqual(search('planets'), ['Mars', 'Mars, the Bringer of War']);
});

test('never worse: every song the player finds stays found, over 300 random queries', () => {
  const words = SONGS.flatMap((s) => `${s.title} ${s.artist} ${s.album}`.split(/\s+/));
  let seed = 9;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < 300; i++) {
    const w = words[Math.floor(rand() * words.length)];
    const q = rand() < 0.5 ? w.slice(0, 2 + Math.floor(rand() * Math.max(1, w.length - 1))) : `${w} ${words[Math.floor(rand() * words.length)]}`;
    const mine = new Set(search(q));
    for (const t of plain(SONGS, q)) assert.ok(mine.has(t.title), `"${q}" lost ${t.title}`);
  }
});

test('fast: a keystroke over 7,000 songs', () => {
  const pool = Array.from({ length: 7000 }, (_, i) => ({ title: `Song number ${i} in the key of ${['C', 'D', 'E'][i % 3]}`, artist: `Artist ${i % 300}`, album: `Album ${i % 700}` }));
  for (const q of ['song', 'artst 12', 'album 6']) smartSongs(pool, q, plain(pool, q), title);
  const at = performance.now();
  smartSongs(pool, 'nubmer 42', plain(pool, 'nubmer 42'), title);
  const ms = performance.now() - at;
  assert.ok(ms < 60, `${Math.round(ms)} ms`);
});
