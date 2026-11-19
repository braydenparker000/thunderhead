// The one quiet note on a stream card (frontend/astra/src/addons/stream-note.js): how the stream will play on
// THIS phone, said before the tap, the most important of what applies. Device reports are given as the browser's
// decodingInfo answers: the owner's phone (H.264, 8-bit HEVC, AV1 and VP9 in hardware, no 10-bit HEVC), a
// browser that decodes everything, and an older phone without AV1 or VP9 hardware. Every stream, address and
// hash here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP, NO_HASH, Notes, TEN_BIT, hashless, noteFor } from '../frontend/astra/src/addons/stream-note.js';
import { SOFTWARE, questionOf } from '../frontend/astra/src/addons/device-facts.js';

const yes = { supported: true, smooth: true, powerEfficient: true };
const OWNER = (type) => (/hvc1\.2\./.test(type) ? { supported: false, smooth: false, powerEfficient: false } : yes);
const EVERYTHING = () => yes;
const OLDER = (type) => (/av01|vp09/.test(type) ? { supported: true, smooth: true, powerEfficient: false } : yes);

const HASH = (n) => n.toString(16).padStart(40, 'a');
const TORRENTIO = (n) => `https://addon.example/resolve/torbox/invented-key/${HASH(n)}/null/0/Film.mkv`;
const AIO_NONE = 'https://addon.example/api/v1/debrid/playback/sealed/-/eyJpZCI6MX0/1/An.Invented.Film.mkv'; // its JSON holds no hash
const s = (title, url, more = {}) => ({ name: 'AIO', title, url, ...more });
const SIGNED_IN = { signedIn: true, key: null };

/** The note for a stream on a phone with this device report, signed in (or as `state` says). */
function note(stream, report, state = SIGNED_IN) {
  const q = questionOf(stream);
  return noteFor(q, q ? report(q.config.video.contentType) : null, hashless(stream, state));
}

const CASES = [
  // [stream, owner's phone, everything, older phone]
  [s('📺 2160p · HDR10 · HEVC', TORRENTIO(1)), TEN_BIT, '', ''],
  [s('1080p x265 10bit', TORRENTIO(2)), TEN_BIT, '', ''],
  [s('1080p 10-bit H.265', TORRENTIO(3)), TEN_BIT, '', ''],
  [s('Anime Hi10 HEVC 720p', TORRENTIO(4)), TEN_BIT, '', ''],
  [s('2160p HEVC Main 10', TORRENTIO(5)), TEN_BIT, '', ''],
  [s('2160p DV x265', TORRENTIO(6)), TEN_BIT, '', ''],
  [s('2160p Dolby Vision HEVC', TORRENTIO(7)), TEN_BIT, '', ''],
  [s('1080p HEVC', TORRENTIO(8)), '', '', ''],
  [s('1080p x264', TORRENTIO(9)), '', '', ''],
  [s('1080p AV1', TORRENTIO(10)), '', '', SOFTWARE],
  [s('1080p VP9', TORRENTIO(11)), '', '', SOFTWARE],
  [s('An episode, no codec named', TORRENTIO(12)), '', '', ''],
  // A link with no hash: the note says so, whatever the phone decodes; 10-bit HEVC in software comes first.
  [s('1080p x264', AIO_NONE), NO_HASH, NO_HASH, NO_HASH],
  [s('An episode, no codec named', AIO_NONE), NO_HASH, NO_HASH, NO_HASH],
  [s('2160p HDR HEVC', AIO_NONE), TEN_BIT, NO_HASH, NO_HASH],
  [s('1080p AV1', AIO_NONE), NO_HASH, NO_HASH, NO_HASH],
  // The hash where Astra still finds it: the stream's own text, or the add-on's torrent data.
  [s(`1080p x264\n🔗 ${HASH(13)}`, AIO_NONE), '', '', ''],
  [s('1080p x264', AIO_NONE, { torrent: { infoHash: HASH(14), fileIdx: 0 } }), '', '', ''],
  // A plain file address Astra reads itself: no hash needed.
  [s('1080p x264', 'https://cdn.example/films/An.Invented.Film.mkv'), '', '', ''],
  [s('1080p x264', 'https://cdn.example/live/index.m3u8'), '', '', ''],
];

test('the note for each stream, with three device reports, signed in with a TorBox key', () => {
  for (const [stream, owner, everything, older] of CASES) {
    assert.equal(note(stream, OWNER), owner, `owner's phone: ${stream.title} ${stream.url}`);
    assert.equal(note(stream, EVERYTHING), everything, `everything: ${stream.title}`);
    assert.equal(note(stream, OLDER), older, `older phone: ${stream.title}`);
  }
});

test('a browser that decodes everything, on streams that carry their hash: no notes at all', () => {
  const hashed = CASES.map(([stream]) => stream).filter((x) => !hashless(x, SIGNED_IN));
  assert.ok(hashed.length >= 12);
  assert.deepEqual(hashed.map((x) => note(x, EVERYTHING)).filter(Boolean), []);
});

test('the hashless note only when signed in, with the key, for a web link that is not a plain file', () => {
  const plain = s('1080p x264', AIO_NONE);
  assert.equal(hashless(plain, SIGNED_IN), true);
  assert.equal(hashless(plain, { signedIn: true, key: true }), true);
  assert.equal(hashless(plain, { signedIn: false }), false, 'signed out: every film plays the add-on\'s link alike');
  assert.equal(hashless(plain, { signedIn: true, key: false }), false, 'no TorBox key: nothing reaches TorBox directly');
  assert.equal(hashless({ name: 'x', url: null }, SIGNED_IN), false, 'not playable');
  assert.equal(hashless({ name: 'x', url: 'magnet:?xt=urn:btih:' + HASH(1) }, SIGNED_IN), false);
  assert.equal(hashless({ name: 'x', url: 'not a link' }, SIGNED_IN), false);
  assert.equal(hashless({ name: 'x', url: 'https://addon.example/stream/abc' }, SIGNED_IN), true, 'an add-on link that names no file');
  assert.equal(hashless({ name: 'x', url: 'https://addon.example/resolve/torbox/k/x/Film.mkv' }, SIGNED_IN), true, "an add-on's resolve link ending in a file name is still not the file");
  // Without a browser answer only 8-bit H.264 is known to play directly; nothing is guessed for the rest.
  assert.equal(noteFor(questionOf(s('2160p HDR HEVC')), null, false), '');
  assert.equal(noteFor(null, null, true), NO_HASH);
  assert.equal(TEN_BIT, '10-bit HEVC: this phone decodes it in software (slow, more battery)');
  assert.equal(NO_HASH, "No hash from this source: may open in Chrome's plain player");
});

test('Notes waits for the session and the browser, then draws one note a card; a press that says "no key" takes the hashless notes away', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaCapabilities');
  Object.defineProperty(globalThis.navigator, 'mediaCapabilities', { configurable: true, value: { decodingInfo: async (c) => OWNER(c.video.contentType) } });
  try {
    const notes = new Notes(null, { read: async () => ({ api: 'https://api.example', token: 'invented' }) });
    const list = [s('1080p 10bit HEVC 720p', TORRENTIO(20)), s('720p x264', AIO_NONE), s('720p x264', TORRENTIO(21))];
    const wait = notes.pending(list);
    assert.ok(wait, 'the facts are not known yet');
    assert.equal(notes.pending(list), wait, 'one wait at a time');
    await wait;
    assert.equal(notes.pending(list), null, 'known now: the cards are drawn at once');
    assert.deepEqual(list.map((x) => notes.of(x)), [TEN_BIT, NO_HASH, '']);
    notes.learn({ steps: [{ step: 'key', ok: true, ms: 0 }] });
    assert.equal(notes.of(list[1]), NO_HASH);
    notes.learn({ url: null, steps: [{ step: 'key', ok: false, ms: 0 }] });
    assert.equal(notes.of(list[1]), '', 'no key on the server: no hashless note');
    notes.learn({ steps: [{ step: 'key', ok: true, ms: 0 }] });
    // A session that never answers: drawn after CAP as signed out.
    const stuck = new Notes(null, { read: () => new Promise(() => {}) });
    const t0 = Date.now();
    await stuck.pending([s('720p x264', AIO_NONE)]);
    assert.ok(Date.now() - t0 >= CAP - 20);
    assert.equal(stuck.pending([s('720p x264', AIO_NONE)]), null);
    assert.equal(stuck.of(s('720p x264', AIO_NONE)), '');
  } finally {
    if (had) Object.defineProperty(globalThis.navigator, 'mediaCapabilities', had); else delete globalThis.navigator.mediaCapabilities;
  }
});
