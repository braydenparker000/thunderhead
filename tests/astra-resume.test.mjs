// The stream a Continue Watching entry remembers (frontend/astra/src/app/remembered.js, store.js progressEntry;
// owner ruling 2026-11-19): kept bounded and checked by the store's own sanitiser on every read, in a backup and in
// another phone's copy; a damaged one is dropped and the entry stays; a finished entry keeps only the release
// group; and the same stream is found again in a fresh list, never another. Invented links, hashes and names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SANITISE, Progress, readBackup } from '../frontend/astra/src/app/store.js';
import { readCopy, SYNC_TAG } from '../frontend/astra/src/app/sync-merge.js';
import { rememberedStream, rememberSource, rememberedSource, sameStream, LINK_MAX } from '../frontend/astra/src/app/remembered.js';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
const LINK = `https://addon.example/resolve/torbox/invented-key/${HASH}/null/0/Invented.Film.2021.mkv`;
const GOOD = { link: LINK, hash: HASH, fileIdx: 0, file: 'Invented.Film.2021.mkv', size: 2_000_000_000, group: 'invented-group-1080p', addon: 'Example', label: 'Example 1080p' };
const entry = (stream, extra = {}) => ({ type: 'movie', id: 'tt0000601', videoId: 'tt0000601', season: null, episode: null, time: 600, duration: 6000, updated: 5, completed: false, meta: { id: 'tt0000601', type: 'movie', name: 'Invented' }, stream, ...extra });
const KEY = 'movie:tt0000601|tt0000601';

test('a good remembered stream is kept as it is', () => {
  assert.deepEqual(rememberedStream(GOOD), GOOD);
  assert.deepEqual(SANITISE.progress({ [KEY]: entry(GOOD) })[KEY].stream, GOOD);
  assert.deepEqual(rememberedStream({ link: LINK }), { link: LINK }, 'only the link: the rest is optional');
});

test('a damaged one is dropped and the entry stays', () => {
  for (const bad of [{ ...GOOD, link: 'http://addon.example/x' }, { ...GOOD, link: 'magnet:?xt=urn:btih:' + HASH }, { ...GOOD, link: 'https://user:pw@addon.example/x' },
    { ...GOOD, link: 'https://addon.example/' + 'a'.repeat(LINK_MAX) }, { ...GOOD, hash: 'ABCDEF' }, { ...GOOD, hash: 'z'.repeat(40) }, { ...GOOD, fileIdx: -1 },
    { ...GOOD, fileIdx: 1.5 }, { ...GOOD, size: Infinity }, { ...GOOD, size: '12' }, { ...GOOD, link: undefined }, 'a string', [GOOD]]) {
    const out = SANITISE.progress({ [KEY]: entry(bad) })[KEY];
    assert.ok(out, 'the entry stays');
    assert.equal(out.time, 600);
    assert.equal('stream' in out, false, JSON.stringify(bad).slice(0, 80));
  }
});

test('oversize text is capped, whitespace folded to one line', () => {
  const out = rememberedStream({ ...GOOD, file: 'F'.repeat(400), group: 'g'.repeat(300), addon: 'A'.repeat(300), label: 'line one\n\nline two ' + 'x'.repeat(300) });
  assert.deepEqual([out.file.length, out.group.length, out.addon.length, out.label.length], [255, 200, 100, 200]);
  assert.match(out.label, /^line one line two x+$/);
  assert.equal(rememberedStream({ ...GOOD, link: 'https://addon.example/' + 'a'.repeat(LINK_MAX - 22) }).link.length, LINK_MAX, 'a link of exactly 4096 characters is kept');
});

test('a finished entry keeps only the release group', () => {
  assert.deepEqual(SANITISE.progress({ [KEY]: entry(GOOD, { completed: true }) })[KEY].stream, { group: GOOD.group });
  assert.equal('stream' in SANITISE.progress({ [KEY]: entry({ link: LINK }, { completed: true }) })[KEY], false);
  // Progress.save does the same as it saves.
  const store = { get: (k, f) => f, set: () => true, watch() {} };
  const p = new Progress(store, () => 9);
  assert.deepEqual(p.save({ type: 'movie', id: 'tt1', videoId: 'tt1', time: 300, duration: 6000, meta: { id: 'tt1', type: 'movie' }, stream: GOOD }).stream, GOOD);
  assert.deepEqual(p.save({ type: 'movie', id: 'tt1', videoId: 'tt1', time: 5900, duration: 6000, meta: { id: 'tt1', type: 'movie' }, stream: GOOD }).stream, { group: GOOD.group });
  assert.equal('stream' in p.save({ type: 'movie', id: 'tt2', videoId: 'tt2', time: 300, duration: 6000, meta: { id: 'tt2', type: 'movie' }, stream: { link: 'http://x' } }), false);
});

test('another phone’s entry with a remembered stream passes the sync copy and a backup; a damaged one loses only its stream', () => {
  const copy = { astra: SYNC_TAG, keys: { progress: { at: 7, value: { [KEY]: entry(GOOD), 'movie:tt2|tt2': entry({ ...GOOD, hash: 'nope' }, { id: 'tt2', videoId: 'tt2' }) }, gone: {} } } };
  const read = readCopy(copy).keys.progress.value;
  assert.deepEqual(read[KEY].stream, GOOD);
  assert.equal(read['movie:tt2|tt2'].time, 600);
  assert.equal('stream' in read['movie:tt2|tt2'], false);
  const backup = readBackup(JSON.stringify({ astra: 'backup/1', data: { progress: { [KEY]: entry(GOOD) } } }));
  assert.deepEqual(backup.data.progress[KEY].stream, GOOD);
});

test('what is remembered of a tapped source: the link’s facts, the group, the add-on, the label without the hash', () => {
  const source = { addonUrl: 'https://addon.example/manifest.json', stream: { url: LINK, name: `Example 1080p\n${HASH}`, filename: 'Invented.Film.2021.mkv', size: 2_000_000_000, bingeGroup: GOOD.group } };
  assert.deepEqual(rememberSource(source, 'Example'), GOOD);
  assert.equal(rememberSource({ stream: { url: 'http://127.0.0.1/x.mkv' } }), null);
  // Back as a source, the same facts reach the owner's server.
  const again = rememberedSource(GOOD);
  assert.deepEqual([again.stream.url, again.stream.filename, again.stream.size, again.stream.bingeGroup, again.remembered], [LINK, GOOD.file, GOOD.size, GOOD.group, GOOD]);
});

test('the same stream is found again, never another', () => {
  const s = (url, extra = {}) => ({ id: url, stream: { url, filename: '', ...extra } });
  const fresh = s(`https://addon.example/resolve/torbox/new-key/${HASH}/null/0/Invented.Film.2021.mkv`);
  const other = s(`https://addon.example/resolve/torbox/new-key/${'1'.repeat(40)}/null/0/Other.mkv`, { bingeGroup: GOOD.group });
  assert.equal(sameStream(GOOD, [other, fresh]), fresh, 'same torrent and file, under a new link');
  assert.equal(sameStream(GOOD, [other]), null, 'the same release group with another file is not the same stream');
  assert.equal(sameStream(GOOD, [other, fresh], { skipHash: true }), null, 'the server said that torrent is not on TorBox');
  const noHash = { link: 'https://addon.example/play/abc', file: 'Invented.mkv', group: 'grp' };
  const sameLink = s('https://addon.example/play/abc'), sameFile = s('https://addon.example/play/def', { filename: 'Invented.mkv', bingeGroup: 'grp' });
  assert.equal(sameStream(noHash, [sameFile, sameLink]), sameLink, 'the same link first');
  assert.equal(sameStream(noHash, [sameFile]), sameFile, 'else the same group and file name');
  assert.equal(sameStream(noHash, [s('https://addon.example/play/x', { filename: 'Invented.mkv' })]), null);
});

test('a remembered link at its longest still travels between phones: the sync\'s own limit is not shorter', async () => {
  const { MAX_STRING, bounded } = await import('../frontend/astra/src/app/sync-read.js');
  const { LINK_MAX } = await import('../frontend/astra/src/app/remembered.js');
  assert.ok(MAX_STRING >= LINK_MAX);
  assert.equal(bounded({ 'movie:tt1': { stream: { link: 'https://addon.example/' + 'a'.repeat(LINK_MAX - 22) } } }), true);
});
