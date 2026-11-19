// The torrent's hash is not shown on a stream card (frontend/astra/src/addons/stream-text.js), though Astra still
// reads it (addons/link-facts.js reads the stream object, not the card): a line that only gives the hash is
// dropped, a hash inside a longer line is cut out cleanly, and nothing else of the add-on's text changes. Every
// hash here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropHashes, withoutHash } from '../frontend/astra/src/addons/stream-text.js';
import { linkFacts } from '../frontend/astra/src/addons/link-facts.js';
import { factsOf, playFactsOf } from '../frontend/astra/src/addons/stream-facts.js';
import { shownName } from '../frontend/astra/src/screens/stream-card.js';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const UPPER = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const CARD = '🎬 An Invented Film (2024)\n📺 2160p · HDR10 · HEVC\n🎧 DDP 5.1 · English\n💾 14.2 GB · ⚡ Ready (TB)';

test('a line that is only the hash goes, with or without an emoji or a label before it', () => {
  for (const line of [HASH, UPPER, `🔗 ${HASH}`, `#️⃣ ${UPPER}`, `Hash: ${HASH}`, `🧲 Info hash: ${HASH}`, `btih:${UPPER}`,
    `🧲 urn:btih:${HASH}`, `magnet:?xt=urn:btih:${HASH}`, `ℹ️ Torrent: ${HASH}`, `  ${HASH}  `, `[${HASH}]`, `(${UPPER})`, `${HASH} ✅`]) {
    assert.equal(withoutHash(`${CARD}\n${line}`), CARD, line);
    assert.equal(withoutHash(`${line}\n${CARD}`), CARD, line);
  }
  assert.equal(withoutHash(HASH), '', 'a description that was only the hash is empty');
});

test('a hash inside a longer line is cut out cleanly, and the rest of the line stays as it was', () => {
  assert.equal(withoutHash(`1080p | ${HASH} | x265`), '1080p | x265');
  assert.equal(withoutHash(`1080p · btih:${UPPER} · x265`), '1080p · x265');
  assert.equal(withoutHash(`⚡ Ready (TB) ${HASH}`), '⚡ Ready (TB)');
  assert.equal(withoutHash(`${UPPER} · 💾 1.4 GB`), '💾 1.4 GB');
  assert.equal(withoutHash(`Film [${HASH}] 2160p`), 'Film 2160p');
  assert.equal(withoutHash(`Film (hash: ${HASH}) 2160p`), 'Film 2160p');
  assert.equal(withoutHash(`Film.2024.2160p-${HASH}`), 'Film.2024.2160p');
  assert.equal(withoutHash(`A ${HASH} B ${UPPER} C`), 'A B C', 'two hashes in one line');
});

test('nothing else changes: lines without a hash, blank lines, and hex that is not a hash', () => {
  const text = `${CARD}\n\n  indented line  \nend`;
  assert.equal(withoutHash(text), text);
  // A 40-hex run that is part of a longer hex string is not a hash: left as it is (64 hex here).
  const long = `${HASH}${'89abcdef01234567'.repeat(1)}abcdef01`;
  assert.equal(long.length, 64);
  assert.equal(withoutHash(`id ${long}`), `id ${long}`);
  assert.equal(withoutHash(`${HASH.slice(0, 39)} short`), `${HASH.slice(0, 39)} short`, '39 hex is no hash');
  assert.equal(withoutHash(''), '');
  assert.equal(withoutHash(null), '');
  assert.equal(withoutHash(undefined), '');
});

test('Astra still reads the hash from the stream, which keeps its words; the card shows them without it', () => {
  const stream = { name: 'AIO\n2160p', title: `${CARD}\n🔗 ${HASH}`, url: 'https://addon.example/api/v1/debrid/playback/sealed/-/e30/1/Film.mkv' };
  assert.equal(linkFacts(stream.url, stream).hash, HASH);
  assert.equal(withoutHash(stream.title), CARD);
  assert.ok(stream.title.includes(HASH), 'the stream object itself is not changed');
  assert.equal(shownName({ name: `${HASH}` }, 'Example'), 'Example', 'a name that was only the hash: the add-on name');
  assert.equal(shownName({ name: `AIO\n${UPPER}\n2160p` }, 'Example'), 'AIO 2160p');
});

test('the facts are read without the hash, so its letters are never words ("dd5…" is not Dolby Digital)', () => {
  const dd = 'dd5' + HASH.slice(3), ac3 = 'ac39' + HASH.slice(4);
  assert.equal(dropHashes(`x ${dd} y`), 'x   y');
  assert.equal(playFactsOf({ name: 'AIO', title: `1080p x264 AAC\n${dd}` }).sound, false);
  assert.equal(playFactsOf({ name: 'AIO', title: `1080p x264\n${ac3}` }).sound, false);
  assert.deepEqual(factsOf({ name: 'AIO', title: `1080p x265 💾 1.4 GB\n${HASH}` }), { bytes: 1.4e9, res: '1080', codec: 'hevc' });
});
