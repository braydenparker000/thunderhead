// What a stream's link says about its file (frontend/astra/src/addons/link-facts.js): the hash, the file's index,
// its name and size from every add-on shape Astra knows, the general case, two hashes, and damaged input that
// must never throw. Hosts, hashes, keys and files are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkFacts, base32Hex } from '../frontend/astra/src/addons/link-facts.js';

const H1 = '0123456789abcdef0123456789abcdef01234567';
const H2 = 'fedcba9876543210fedcba9876543210fedcba98';
const FILE = 'Invented Film 2020 1080p.mkv';
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
/** 40 hex as the 32-character base32 a magnet link may use. */
const base32 = (hex) => {
  const bits = [...Buffer.from(hex, 'hex')].map((b) => b.toString(2).padStart(8, '0')).join('');
  return bits.match(/.{5}/g).map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(b, 2)]).join('');
};
const aio = (json, file = encodeURIComponent(FILE)) => `https://addon.example/api/v1/debrid/playback/U2VhbGVkSW52ZW50ZWQ/-/${typeof json === 'string' ? json : b64url(json)}/tt0000001/${file}`;
const facts = (hash, fileIndex = null, fileName = null, fileSize = null) => ({ hash, fileIndex, fileName, fileSize });

test('base32 hashes are read as 40 hex', () => {
  assert.equal(base32(H1).length, 32);
  assert.equal(base32Hex(base32(H1)), H1);
  assert.equal(base32Hex(base32(H2).toLowerCase()), H2);
});

test("AIOStreams' own playback link: the hash and index in its JSON segment, in every spelling and a nested shape", () => {
  assert.deepEqual(linkFacts(aio({ hash: H1, index: 2, sources: ['tracker:udp://tracker.example:1337'], title: 'Invented' })), facts(H1, 2, FILE));
  assert.deepEqual(linkFacts(aio({ infoHash: H1.toUpperCase(), fileIdx: '3' })), facts(H1, 3, FILE), 'upper case and a number as text');
  assert.deepEqual(linkFacts(aio({ type: 'torrent', file: { info_hash: H1, fileIndex: 0 } })), facts(H1, 0, FILE), 'nested');
  assert.deepEqual(linkFacts(aio({ torrent: { btih: base32(H1) }, file: { idx: 5 } })), facts(H1, 5, FILE), 'base32, nested apart');
  assert.deepEqual(linkFacts(aio(b64url({ hash: H1, index: 1 }).replace(/-/g, '+').replace(/_/g, '/'))).hash, H1, 'plain base64 as well');
  assert.deepEqual(linkFacts(aio({ index: 4, title: 'no hash' })), facts(null, 4, FILE), 'an index alone is still said');
  assert.deepEqual(linkFacts(aio({ hash: H1, infoHash: H2, index: 1 })), facts(null, null, FILE), 'two hashes: unclear which file');
});

test("AIOStreams' link damaged: nothing read from it, no throw, the file name still from the path", () => {
  for (const segment of ['%%%', b64url('not json at all'), b64url('[1,2,3]'), b64url({ hash: 'short', index: -1 }), b64url({ hash: H1 }).slice(0, -7), 'A'.repeat(17), Buffer.from([0xff, 0xfe, 0x00, 0x81, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x01, 0x02]).toString('base64url')]) {
    const f = linkFacts(aio(segment));
    assert.equal(f.fileIndex, null, segment);
    assert.equal(f.fileName, FILE);
  }
  const deep = { a: { b: { c: { d: { e: { f: { hash: H1 } } } } } } };
  assert.equal(linkFacts(aio(deep)).hash, null, 'too deep to be the file');
});

test('Comet, MediaFusion, Torrentio and StremThru links', () => {
  const config = b64url({ debridService: 'torbox', debridApiKey: 'invented-key' });
  assert.deepEqual(linkFacts(`https://addon.example/${config}/playback/${H1}/torbox/2/1/5`), facts(H1, 2), 'Comet: index after the service');
  assert.deepEqual(linkFacts(`https://addon.example/${config}/playback/${H1}/4/1/5`), facts(H1, 4), 'Comet without the service');
  assert.deepEqual(linkFacts(`https://addon.example/streaming_provider/invented-secret/playback/${H1}/1/5/${encodeURIComponent(FILE)}`), facts(H1, null, FILE), 'MediaFusion: a season and episode are no index');
  assert.deepEqual(linkFacts(`https://addon.example/streaming_provider/invented-secret/stream?info_hash=${H1.toUpperCase()}`), facts(H1), 'MediaFusion by query');
  assert.deepEqual(linkFacts(`https://addon.example/resolve/torbox/invented-key/${H1}/null/3/${encodeURIComponent(FILE)}`), facts(H1, 3, FILE), 'Torrentio');
  assert.deepEqual(linkFacts(`https://addon.example/resolve/torbox/invented-key/${H1}/${encodeURIComponent(FILE)}/0/${encodeURIComponent(FILE)}`), facts(H1, 0, FILE), 'Torrentio, its cached-entry segment a name');
  assert.deepEqual(linkFacts(`https://addon.example/stremio/torz/${config}/_/strem/${H1}/1/${encodeURIComponent(FILE)}`), facts(H1, 1, FILE), 'StremThru');
});

test('the general case: exactly one hash in the path or a query value named like one', () => {
  assert.deepEqual(linkFacts(`https://cdn.example/dl/${H1.toUpperCase()}/film.mp4`), facts(H1, null, 'film.mp4'));
  assert.deepEqual(linkFacts(`https://cdn.example/dl/${base32(H1)}/x`), facts(H1), 'base32 in the path, converted');
  assert.deepEqual(linkFacts(`https://cdn.example/get?btih=${base32(H1).toLowerCase()}&file=2`), facts(H1), 'base32 in a hash-named query value');
  assert.deepEqual(linkFacts(`https://cdn.example/get?token=${H1}`), facts(null), 'a value not named like a hash is not one');
  assert.deepEqual(linkFacts(`https://cdn.example/${'abcdefghijklmnopqrstuvwxyzabcdef'}/x`), facts(null), 'a lower-case 32-letter path segment is a word, not a hash');
  assert.deepEqual(linkFacts(`https://cdn.example/${H1}/${base32(H1)}?hash=${H1}`), facts(H1), 'one hash written three ways is one hash');
  assert.deepEqual(linkFacts(`https://cdn.example/${H1}/film.mkv?hash=${H2}`), facts(null, null, 'film.mkv'), 'two hashes: none');
  assert.deepEqual(linkFacts(`https://addon.example/resolve/torbox/invented-key/${H1}/null/3/${H2}`), facts(null), 'two hashes in a known shape: no hash and no index');
  assert.deepEqual(linkFacts('https://cdn.example/watch/12345'), facts(null));
});

test("the file's name and size: the stream's own first, else the path's last segment when it is a film's name", () => {
  const stream = { filename: 'folder/Invented.Show.S01E02.mkv', size: 1_234_567_890 };
  assert.deepEqual(linkFacts(`https://addon.example/resolve/torbox/k/${H1}/null/0/other.mkv`, stream), facts(H1, 0, 'Invented.Show.S01E02.mkv', 1_234_567_890));
  assert.equal(linkFacts('https://cdn.example/a/manifest.json').fileName, null, 'not a film');
  assert.equal(linkFacts('https://cdn.example/a/b', { size: -5 }).fileSize, null);
  assert.equal(linkFacts('https://cdn.example/a/b', { size: 'big' }).fileSize, null);
  assert.equal(linkFacts('https://cdn.example/a/b', { size: 2.5 }).fileSize, null);
});

test('damaged input never throws', () => {
  for (const url of [undefined, null, '', 'not a link', 42, {}, 'https://', 'https://addon.example/%E0%A4%A/playback/%/x', `https://addon.example/${'/'.repeat(500)}`])
    for (const stream of [undefined, null, {}, { filename: 7, size: {} }])
      assert.doesNotThrow(() => linkFacts(url, stream));
  assert.deepEqual(linkFacts('not a link', { filename: FILE, size: 10 }), facts(null, null, FILE, 10), 'what the stream says is still said');
});
