// Music's downloads without a browser (MUSIC.md "Downloads"): the zip written as a stream
// (frontend/th/music/zip-stream.js) read back by its records (tests/fixtures/zip-read.mjs) with every CRC
// checked against Node's own; its ZIP64 records, faked at the record level; and the names songs are saved
// under (frontend/music/src/library/download-names.js). Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readZip } from './fixtures/zip-read.mjs';
import { cleanName, entryNames, extensionOf, songFile, songTitle, unique, albumName, NAME_MAX } from '../frontend/music/src/library/download-names.js';
import { m3uText } from '../frontend/music/src/library/playlist-files.js';

await import('../frontend/th/music/zip-stream.js');
const { ZipWriter, crc32 } = globalThis.thZipStream;
const enc = new TextEncoder();
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** Invented bytes, different for each seed. */
const bytesOf = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 17 + (i >> 7)) & 255);

test('CRC-32 by table agrees with Node’s, whole and in pieces', () => {
  for (const b of [new Uint8Array(0), enc.encode('123456789'), bytesOf(70_001, 3)]) {
    assert.equal(crc32(b), zlib.crc32(b));
    assert.equal(crc32(b.subarray(Math.floor(b.length / 3)), crc32(b.subarray(0, Math.floor(b.length / 3)))), zlib.crc32(b));
  }
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926, 'the check value');
});

test('a zip streamed in chunks reads back: local headers, descriptors after the data, the directory’s offsets and CRCs, UTF-8 names', () => {
  const files = [
    ['01 - Cobalt Field - Morning Static.opus', bytesOf(100_000, 1)],
    ['02 - Ånder Vale - Über Nacht.opus', bytesOf(4097, 2)],
    ['empty.txt', new Uint8Array(0)],
    ['Road Trip.m3u8', enc.encode('#EXTM3U\r\n')],
  ];
  const w = new ZipWriter({ now: () => new Date(2026, 10, 26, 13, 45, 30) });
  const parts = [];
  for (const [name, b] of files) {
    parts.push(w.begin(name));
    // As a stream hands them over: uneven pieces.
    for (let at = 0; at < b.length; at += 8191) parts.push(w.data(b.subarray(at, at + 8191)));
    parts.push(w.end());
  }
  parts.push(w.finish());
  const zip = concat(parts);
  assert.equal(w.offset, zip.length, 'the writer counted every byte it gave');
  const { entries, zip64 } = readZip(zip);
  assert.equal(zip64, false);
  assert.deepEqual(entries.map((e) => e.name), files.map(([n]) => n));
  for (const [i, e] of entries.entries()) {
    assert.equal(e.flags, 0x0808, `${e.name}: a data descriptor (bit 3) and a UTF-8 name (bit 11)`);
    assert.deepEqual(e.data, files[i][1], `${e.name}: its bytes as given`);
    assert.equal(e.crc, zlib.crc32(files[i][1]), `${e.name}: its CRC`);
  }
  // The local header leaves the CRC and the sizes to the descriptor.
  const v = new DataView(zip.buffer);
  assert.deepEqual([v.getUint32(14, true), v.getUint32(18, true), v.getUint32(22, true)], [0, 0, 0]);
  // The DOS time and date: 13:45:30 on 26 November 2026.
  assert.equal(v.getUint16(10, true), (13 << 11) | (45 << 5) | 15);
  assert.equal(v.getUint16(12, true), ((2026 - 1980) << 9) | (11 << 5) | 26);
  assert.throws(() => new ZipWriter().end(), /no entry open/);
});

test('ZIP64: an entry past 4 GiB gets its offset (and a size of 4 GiB or more) in the directory’s extra, with version 4.5', () => {
  const w = new ZipWriter();
  const parts = [w.begin('a.opus'), w.data(bytesOf(10, 1)), w.end()];
  // Faked at the record level: an entry of 5 GiB at 6 GiB, as if the bytes had passed.
  w.entries.push({ name: enc.encode('b.opus'), crc: 0x1234abcd, size: 5 * 2 ** 32, offset: 6 * 2 ** 32, time: 0, date: 33 });
  parts.push(w.finish());
  const { entries } = readZip(concat(parts));
  assert.deepEqual(entries.map((e) => [e.name, e.size, e.offset, e.crc]), [['a.opus', 10, 0, zlib.crc32(bytesOf(10, 1))], ['b.opus', 5 * 2 ** 32, 6 * 2 ** 32, 0x1234abcd]]);
  const dir = concat(parts.slice(-1));
  const v = new DataView(dir.buffer);
  const second = 46 + 'a.opus'.length;
  assert.equal(v.getUint16(second + 6, true), 45, 'version needed 4.5');
  assert.deepEqual([v.getUint32(second + 20, true), v.getUint32(second + 24, true), v.getUint32(second + 42, true)], [0xffffffff, 0xffffffff, 0xffffffff]);
  // A descriptor of an entry that large carries 8-byte sizes.
  const big = new ZipWriter();
  big.begin('c');
  big.current.size = 2 ** 32 + 5;
  const d = big.end();
  assert.equal(d.length, 24);
  assert.equal(new DataView(d.buffer).getUint32(8, true) + new DataView(d.buffer).getUint32(12, true) * 2 ** 32, 2 ** 32 + 5);
});

test('ZIP64: more than 65,535 entries get the ZIP64 end record and its locator; the plain end record says 0xFFFF', () => {
  const w = new ZipWriter();
  const parts = [];
  const n = 65_537;
  for (let i = 0; i < n; i++) parts.push(w.begin(`f${i}`), w.data(Uint8Array.of(i & 255)), w.end());
  parts.push(w.finish());
  const zip = concat(parts);
  const { entries, zip64 } = readZip(zip);
  assert.equal(zip64, true);
  assert.equal(entries.length, n);
  assert.deepEqual(entries.at(-1).data, Uint8Array.of((n - 1) & 255));
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint16(zip.length - 22 + 10, true), 0xffff);
});

test('ZIP64: a central directory that starts past 4 GiB is found through the locator', () => {
  const w = new ZipWriter();
  w.begin('a');
  w.end();
  // As if 4 GiB had been written before the directory.
  w.offset = 2 ** 32 + 100;
  const tail = w.finish();
  const v = new DataView(tail.buffer);
  // The directory (its one entry, at offset 0: no extra), then the ZIP64 end record, its locator and the end record.
  assert.equal(v.getUint32(0, true), 0x02014b50);
  const z64 = tail.length - 22 - 20 - 56;
  assert.equal(v.getUint32(z64, true), 0x06064b50);
  assert.equal(v.getUint32(z64 + 48, true) + v.getUint32(z64 + 52, true) * 2 ** 32, 2 ** 32 + 100, 'the directory’s start');
  const loc = tail.length - 22 - 20;
  assert.equal(v.getUint32(loc, true), 0x07064b50);
  assert.equal(v.getUint32(loc + 8, true) + v.getUint32(loc + 12, true) * 2 ** 32, 2 ** 32 + 100 + z64, 'the locator points at the ZIP64 end record');
  assert.equal(v.getUint32(tail.length - 22 + 16, true), 0xffffffff, 'the plain end record defers to it');
});

test('names: refused characters out, spaces collapsed, trimmed, cut at 120 before the extension, a fallback when nothing is left', () => {
  assert.equal(cleanName('  Who/What: "Tide"*?  <Live>|  '), 'Who What Tide Live');
  assert.equal(cleanName('Tab\there\u0001and\nthere\u007f'), 'Tab here and there');
  assert.equal(cleanName('C:\\Songs\\Ånd Ö'), 'C Songs Ånd Ö');
  assert.equal(cleanName('???'), 'Untitled');
  assert.equal(cleanName(''), 'Untitled');
  const long = 'x'.repeat(200);
  assert.equal(cleanName(long).length, NAME_MAX);
  // A character outside the BMP is never split.
  assert.equal(Array.from(cleanName('🎵'.repeat(130))).length, NAME_MAX);
  assert.equal(cleanName(`${'a'.repeat(119)} b`), 'a'.repeat(119), 'a cut that ends on a space is trimmed');
});

test('a song’s name: "Artist - Title" and its stored extension; numbered entries as wide as the count needs; duplicates made unique', () => {
  const t = (title, artist, fileName = 'x.opus') => ({ title, artist, fileName });
  assert.equal(songTitle(t('Morning Static', 'Cobalt Field')), 'Cobalt Field - Morning Static');
  assert.equal(songTitle(t('Morning Static', '')), 'Morning Static');
  assert.equal(songFile(t('Morning Static', 'Cobalt Field')), 'Cobalt Field - Morning Static.opus');
  assert.equal(songFile(t('Tin Roof', 'Cobalt Field', 'Tin Roof.FLAC')), 'Cobalt Field - Tin Roof.flac');
  assert.equal(extensionOf({ path: 'Folder/Song.m4a' }), 'm4a');
  assert.equal(extensionOf({}), 'opus');
  assert.deepEqual(unique(['A.opus', 'a.opus', 'B.opus', 'A.opus', 'A (2).opus']), ['A.opus', 'a (2).opus', 'B.opus', 'A (3).opus', 'A (2) (2).opus']);
  const three = [t('One', 'Cobalt Field'), t('Two: Part/1', 'Cobalt Field'), t('One', 'Cobalt Field')];
  assert.deepEqual(entryNames(three), ['Cobalt Field - One.opus', 'Cobalt Field - Two Part 1.opus', 'Cobalt Field - One (2).opus']);
  assert.deepEqual(entryNames(three, { numbered: true }), ['01 - Cobalt Field - One.opus', '02 - Cobalt Field - Two Part 1.opus', '03 - Cobalt Field - One.opus']);
  const many = Array.from({ length: 120 }, (_, i) => t(`Song ${i}`, 'Cobalt Field'));
  assert.equal(entryNames(many, { numbered: true })[0], '001 - Cobalt Field - Song 0.opus');
  assert.equal(entryNames([t('y'.repeat(300), 'Cobalt Field')], { numbered: true })[0], `01 - Cobalt Field - ${'y'.repeat(NAME_MAX - 20)}.opus`);
  assert.equal(albumName('Cobalt Field', 'Low: Tide'), 'Cobalt Field - Low Tide');
  assert.equal(albumName('', 'Low Tide'), 'Low Tide');
});

test('the .m3u8 writer lists relative names in order (the playlist export’s own writer)', () => {
  assert.equal(m3uText([{ path: '01 - A - One.opus', rating: 4 }, { path: null }, { path: '02 - A - Two.opus' }]), '#EXTM3U\r\n#EXT-X-RATING:4\r\n01 - A - One.opus\r\n#EXT-X-RATING:0\r\n02 - A - Two.opus\r\n');
});
