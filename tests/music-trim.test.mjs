// A song arriving over full scale (frontend/music/src/dsp/trim.js; MUSIC.md §5 "Clipping and headroom"):
// a trim is set only at a song's start, never changes inside a song, and never steps between songs of
// one album played in order. Tagged songs: the album's peak in album order, the track's otherwise.
// Untagged: the safety net catches a song's overs; the trim they call for applies from the next song of
// that album in order, and stays (never rises) until a change out of album order or to another album.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inAlbumOrder, songTrim, learnTrim } from '../frontend/music/src/dsp/trim.js';

const song = (n, o = {}) => ({ id: `s${n}`, album: 'Paper Lanterns', albumArtist: 'The Quiet Hours', disc: 1, track: n, ...o });
const db = (g) => Math.round(20 * Math.log10(g) * 100) / 100;

test('album order: the next track of the same album and disc, or the first of the next disc', () => {
  assert.equal(inAlbumOrder(song(1), song(2)), true);
  assert.equal(inAlbumOrder(song(1), song(3)), false);
  assert.equal(inAlbumOrder(song(9), song(1, { disc: 2 })), true);
  assert.equal(inAlbumOrder(song(1), song(2, { album: 'Other' })), false);
  assert.equal(inAlbumOrder(null, song(1)), false);
  assert.equal(inAlbumOrder(song(1, { album: '' }), song(2, { album: '' })), false, 'no album: no order');
});

test('tagged: the album peak in album order, the track peak otherwise; never a gain up', () => {
  const rg = { trackPeak: 1.1, albumPeak: 1.4 };
  assert.equal(db(songTrim({ t: song(2, { replayGain: rg }), prev: song(1), gain: 1 }).trim), db(1 / 1.4));
  assert.equal(db(songTrim({ t: song(5, { replayGain: rg }), prev: song(1), gain: 1 }).trim), db(1 / 1.1));
  assert.equal(songTrim({ t: song(2, { replayGain: { trackPeak: 0.9 } }), prev: null, gain: 1 }).trim, 1);
});

test('untagged: no change inside a song; the next song of the album in order starts with the trim; it never rises mid-album', () => {
  let carry = null;
  const a = song(1), b = song(2), c = song(3), d = song(4);
  let r = songTrim({ t: a, prev: null, gain: 1, carry });
  assert.equal(r.trim, 1);
  carry = r.carry;
  // Song 1 goes 2 dB over: nothing changes in it (the net catches it); learned for the album.
  carry = learnTrim(carry, a, Math.pow(10, 2 / 20), 1);
  r = songTrim({ t: b, prev: a, gain: 1, carry });
  assert.equal(db(r.trim), -2, 'from the next song in order');
  carry = r.carry;
  // Song 2 peaks lower: the trim stays (never rises within the album).
  carry = learnTrim(carry, b, Math.pow(10, 0.5 / 20), 1);
  r = songTrim({ t: c, prev: b, gain: 1, carry });
  assert.equal(db(r.trim), -2);
  carry = r.carry;
  // A jump out of order resets it; so does another album.
  assert.equal(songTrim({ t: d, prev: a, gain: 1, carry }).trim, 1);
  assert.equal(songTrim({ t: song(4, { album: 'Other' }), prev: c, gain: 1, carry }).trim, 1);
});

test("an untagged song's kept peak trims it from its next start, wherever it is played; the album rule is unchanged", () => {
  // Never measured: no trim (the net catches it the first time).
  assert.equal(songTrim({ t: song(7), prev: null, gain: 1 }).trim, 1);
  // Measured 2.1 dB over full scale on an earlier play: trimmed by that at its start, out of album order too.
  const kept = song(7, { decodedPeak: Math.pow(10, 2.1 / 20) });
  const r = songTrim({ t: kept, prev: null, gain: 1 });
  assert.equal(db(r.trim), -2.1);
  // The carry its album's next song takes is the album rule's alone (here none).
  assert.equal(r.carry.trim, 1);
  // ReplayGain counts: a song turned down 3 dB is not over.
  assert.equal(songTrim({ t: kept, prev: null, gain: Math.pow(10, -3 / 20) }).trim, 1);
  // With the album's carry, the smaller trim wins.
  const carry = { key: r.carry.key, trim: Math.pow(10, -3 / 20) };
  assert.equal(db(songTrim({ t: song(8, { decodedPeak: kept.decodedPeak }), prev: song(7), gain: 1, carry }).trim), -3);
  // A song under full scale keeps no trim.
  assert.equal(songTrim({ t: song(7, { decodedPeak: 0.8 }), prev: null, gain: 1 }).trim, 1);
});

test('the phone keeps the larger of the kept and the measured peak, with the song, saved once per 2 s', async () => {
  const { Library } = await import('../frontend/music/src/library/library.js');
  const saved = [];
  const t = { id: 'r2_invented0042', remote: true, plays: 3 };
  const lib = { byId: new Map([[t.id, t]]), saveTrack: (x) => saved.push({ ...x }) };
  const copy = { id: t.id };
  Library.prototype.notePeak.call(lib, copy, 1.2);
  Library.prototype.notePeak.call(lib, copy, 0.9);
  Library.prototype.notePeak.call(lib, copy, 1.27);
  assert.equal(t.decodedPeak, 1.27);
  assert.equal(copy.decodedPeak, 1.27, 'the player’s copy follows');
  assert.equal(saved.length, 0, 'not saved on every meter');
  clearTimeout(lib.peakSaves.get(t.id));
  lib.peakSaves.clear();
  Library.prototype.notePeak.call(lib, copy, 1.1);
  assert.equal(t.decodedPeak, 1.27, 'never smaller');
  assert.equal(lib.peakSaves.size, 0, 'nothing to save when it did not grow');
});
