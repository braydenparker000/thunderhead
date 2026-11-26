// The v2 Home's shelf rules (frontend/music/src/home/rules.js, owner 2026-11-26) over invented songs:
// Liked songs are the songs rated like, the newest liked first; Forgotten favourites are liked or
// played five times or more and not played for 90 days, the newest forgotten first; Most played lately
// counts the play history of the last 30 days, or the play counts while that history is short; a
// playlist's Recent is the later of its change and its songs' last play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, LIKE, FORGOTTEN_MS, FORGOTTEN_PLAYS, LATELY_MS, HISTORY_MIN,
  isLiked, likedSongs, isForgotten, forgottenSongs, playsLately, mostPlayedSongs, mostPlayedGroups, lastPlayOf, playlistRecent,
} from '../frontend/music/src/home/rules.js';

const NOW = Date.UTC(2026, 10, 26, 12);
const ago = (days) => NOW - days * DAY;
const song = (id, o = {}) => ({ id, title: `Song ${id}`, artist: 'Invented Band', plays: 0, lastPlayed: 0, rating: 0, ...o });
const ids = (list) => list.map((t) => t.id);

test('the rules hold the numbers asked for', () => {
  assert.equal(LIKE, 5);
  assert.equal(FORGOTTEN_MS, 90 * DAY);
  assert.equal(FORGOTTEN_PLAYS, 5);
  assert.equal(LATELY_MS, 30 * DAY);
});

test('Liked songs: rated like (5) only, the newest liked first, the last played when when-liked is unknown', () => {
  const songs = [
    song('a', { rating: 5, ratedAt: ago(10) }),
    song('b', { rating: 4, ratedAt: ago(1) }), // a star rating is not a like
    song('c', { rating: 1, ratedAt: ago(2) }), // unlike
    song('d', { rating: 5, ratedAt: ago(3) }),
    song('e', { rating: 5, lastPlayed: ago(5) }),
    song('f'),
  ];
  assert.deepEqual(ids(likedSongs(songs)), ['d', 'e', 'a']);
  assert.ok(isLiked(songs[0]) && !isLiked(songs[1]) && !isLiked(songs[2]) && !isLiked(undefined));
});

test('Forgotten favourites: liked or played 5+ times, not played in 90 days, the newest forgotten first', () => {
  const songs = [
    song('liked-old', { rating: 5, lastPlayed: ago(120), plays: 1 }),
    song('often-old', { plays: 5, lastPlayed: ago(95) }),
    song('often-older', { plays: 40, lastPlayed: ago(400) }),
    song('often-recent', { plays: 30, lastPlayed: ago(89) }), // heard in the last 90 days
    song('few-old', { plays: 4, lastPlayed: ago(200) }), // neither liked nor often played
    song('liked-never', { rating: 5 }), // never played: nothing to forget
    song('edge', { plays: 6, lastPlayed: NOW - FORGOTTEN_MS }), // exactly 90 days
  ];
  assert.deepEqual(ids(forgottenSongs(songs, NOW)), ['edge', 'often-old', 'liked-old', 'often-older']);
  assert.ok(!isForgotten(songs[3], NOW) && !isForgotten(songs[4], NOW) && !isForgotten(songs[5], NOW));
});

test('Most played lately: the history of the last 30 days when it holds enough plays', () => {
  const songs = [song('x', { plays: 100, lastPlayed: ago(1) }), song('y', { plays: 2, lastPlayed: ago(2) }), song('z', { plays: 9, lastPlayed: ago(3) })];
  // Newest first, as player/play-history.js keeps it: y heard 20 times, z 6 times, x once, and older plays that do not count.
  const history = [];
  for (let k = 0; k < HISTORY_MIN + 2; k++) history.push({ id: k < 20 ? 'y' : k < 26 ? 'z' : 'x', at: NOW - (k + 1) * 3_600_000 });
  history.push({ id: 'x', at: ago(31) }, { id: 'x', at: ago(40) });
  const { counts, fromHistory } = playsLately(songs, history, NOW);
  assert.equal(fromHistory, true);
  assert.deepEqual(Object.fromEntries(counts), { y: 20, z: 6, x: 1 });
  assert.deepEqual(ids(mostPlayedSongs(songs, counts)), ['y', 'z', 'x']);
});

test('Most played lately: while the history is short, the play counts of the songs played in the 30 days', () => {
  const songs = [
    song('x', { plays: 3, lastPlayed: ago(1) }),
    song('y', { plays: 12, lastPlayed: ago(29) }),
    song('z', { plays: 50, lastPlayed: ago(31) }), // played a lot, not lately
    song('w', { plays: 3, lastPlayed: ago(5) }),
  ];
  const { counts, fromHistory } = playsLately(songs, [{ id: 'z', at: ago(1) }], NOW);
  assert.equal(fromHistory, false);
  assert.deepEqual(ids(mostPlayedSongs(songs, counts)), ['y', 'x', 'w']); // a tie: the one played last first
  const albums = [{ title: 'One', tracks: [songs[0], songs[3]] }, { title: 'Two', tracks: [songs[1]] }, { title: 'Three', tracks: [songs[2]] }];
  assert.deepEqual(mostPlayedGroups(albums, counts).map((g) => g.title), ['Two', 'One']);
});

test("A playlist's Recent: the later of its change and any of its songs' last play", () => {
  const songs = [song('a', { lastPlayed: ago(3) }), song('b', { lastPlayed: ago(1) }), song('c')];
  assert.equal(lastPlayOf(songs), ago(1));
  assert.equal(lastPlayOf([song('n')]), 0);
  assert.equal(playlistRecent({ modified: ago(10) }, songs), ago(1));
  assert.equal(playlistRecent({ modified: ago(0.5) }, songs), ago(0.5));
  assert.equal(playlistRecent({ created: ago(20) }, [song('n')]), ago(20));
  // Ordered by it: a playlist played yesterday comes before one changed last week and never played.
  const lists = [
    { name: 'Changed', pl: { modified: ago(7) }, tracks: [song('n')] },
    { name: 'Played', pl: { modified: ago(60) }, tracks: songs },
    { name: 'Old', pl: { modified: ago(90) }, tracks: [] },
  ];
  assert.deepEqual(lists.sort((p, q) => playlistRecent(q.pl, q.tracks) - playlistRecent(p.pl, p.tracks)).map((p) => p.name), ['Played', 'Changed', 'Old']);
});
