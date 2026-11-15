// A film's chapters (frontend/astra/src/engine/chapters.js): read from Matroska's Chapters element and
// an MP4's chpl box, offered in order on the film's clock, and bounded however the file lies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readLayout } from '../frontend/astra/src/engine/mkv.js';
import { mkvChapters, mp4Chapters, finishChapters, MAX_CHAPTERS } from '../frontend/astra/src/engine/chapters.js';

const film = await readFile(new URL('./fixtures/astra/multi.mkv', import.meta.url));

// EBML: an element is its id bytes, a size (here always 8 bytes long) and its body.
const el = (id, ...body) => {
  const data = Buffer.concat(body.map((b) => (typeof b === 'number' ? Buffer.from([b]) : Buffer.isBuffer(b) ? b : Buffer.from(b))));
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(data.length)); size[0] = 0x01;
  return Buffer.concat([Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, '0'), 'hex'), size, data]);
};
const ns = (s) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.round(s * 1e9))); return b; };
const atom = (start, end, title, ...flags) => el(0xb6, el(0x91, ns(start)), ...(end == null ? [] : [el(0x92, ns(end))]), ...flags, el(0x80, el(0x85, title)));

test('the three chapters of the test film, read with its layout', async () => {
  const layout = await readLayout(async (s, e) => film.subarray(s, e), film.length);
  assert.deepEqual(finishChapters(layout.chapters, 60), [
    { start: 0, end: 8, title: 'Opening' }, { start: 8, end: 50, title: 'The story' }, { start: 50, end: 60, title: 'Credits' },
  ]);
  // A film that starts after zero (shifted to 0:00 as it plays): the chapters move with it.
  assert.deepEqual(finishChapters(layout.chapters, 60, 8).map((c) => [c.start, c.end]), [[0, 0], [0, 42], [42, 52]]);
});

test('hidden and disabled chapters, and hidden or ordered editions, are left out; the default edition wins', () => {
  const body = Buffer.concat([
    el(0x45b9, el(0x45bd, 1), atom(0, 5, 'Hidden edition')),
    el(0x45b9, el(0x45dd, 1), atom(0, 5, 'Ordered edition')),
    el(0x45b9, atom(0, 5, 'Not the default')),
    el(0x45b9, el(0x45db, 1), atom(0, null, 'One'), atom(5, null, 'Hidden', el(0x98, 1)), atom(9, null, 'Off', el(0x4598, 0)), atom(12, null, 'Two')),
  ]);
  assert.deepEqual(finishChapters(mkvChapters(body), 20), [{ start: 0, end: 12, title: 'One' }, { start: 12, end: 20, title: 'Two' }]);
  assert.deepEqual(mkvChapters(Buffer.alloc(0)), []);
});

test('sizes from the file are not trusted: a few hundred chapters at most, titles cut, damage stops the walk', () => {
  const many = el(0x45b9, ...Array.from({ length: 2000 }, (_, i) => atom(i, null, 'x'.repeat(300))));
  const read = mkvChapters(many);
  assert.equal(read.length, MAX_CHAPTERS);
  assert.equal(read[0].title.length, 200);
  // An atom that claims to run past its edition ends the reading there, without throwing.
  const broken = Buffer.from(el(0x45b9, atom(0, 1, 'Fine'), atom(1, 2, 'Cut')).subarray(0, -6));
  assert.ok(mkvChapters(broken).length <= 1);
});

test("an MP4's chpl box: starts in 100 ns units, a byte count, titles cut; a count larger than the box is held to it", () => {
  const entry = (s, title) => { const t = Buffer.from(title), b = Buffer.alloc(9); b.writeBigUInt64BE(BigInt(s * 1e7)); b[8] = t.length; return Buffer.concat([b, t]); };
  const box = (type, ...body) => { const data = Buffer.concat(body), head = Buffer.alloc(8); head.writeUInt32BE(data.length + 8); head.write(type, 4); return Buffer.concat([head, data]); };
  const chpl = (count, ...entries) => box('chpl', Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, count]), ...entries);
  const moov = box('moov', box('mvhd', Buffer.alloc(100)), box('udta', chpl(3, entry(0, 'Start'), entry(90.5, 'Middle'), entry(200, 'End'))));
  assert.deepEqual(finishChapters(mp4Chapters(moov), 240), [{ start: 0, end: 90.5, title: 'Start' }, { start: 90.5, end: 200, title: 'Middle' }, { start: 200, end: 240, title: 'End' }]);
  assert.deepEqual(mp4Chapters(box('moov', box('udta', chpl(250, entry(0, 'Only'))))).map((c) => c.title), ['Only']);
  assert.deepEqual(mp4Chapters(box('moov', box('mvhd', Buffer.alloc(8)))), []);
  // Out of order, untitled, and past the end of the film: sorted, named, dropped.
  assert.deepEqual(finishChapters([{ start: 30, end: null, title: '' }, { start: 10, end: null, title: 'A' }, { start: 99, end: null, title: 'Gone' }], 60),
    [{ start: 10, end: 30, title: 'A' }, { start: 30, end: 60, title: 'Chapter 2' }]);
  assert.deepEqual(finishChapters(undefined), []);
});

test("an MP4 text track named as another track's chapters is not offered as subtitles", async () => {
  const { readMp4Subtitles } = await import('../frontend/astra/src/engine/mp4.js');
  const box = (type, ...body) => { const data = Buffer.concat(body), head = Buffer.alloc(8); head.writeUInt32BE(data.length + 8); head.write(type, 4); return Buffer.concat([head, data]); };
  const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return b; };
  const tkhd = (id) => box('tkhd', Buffer.from([0, 0, 0, 1]), u32(0, 0, id), Buffer.alloc(68));
  const text = (id) => box('trak', tkhd(id), box('mdia', box('mdhd', Buffer.alloc(12), u32(1000), Buffer.alloc(8)), box('hdlr', Buffer.alloc(8), Buffer.from('text'), Buffer.alloc(12)),
    box('minf', box('stbl', box('stsd', u32(0, 1), box('tx3g', Buffer.alloc(8)))))));
  const video = box('trak', tkhd(1), box('tref', box('chap', u32(2))));
  const tracks = await readMp4Subtitles(null, 0, box('moov', video, text(2), text(3)));
  assert.deepEqual(tracks.map((t) => t.id), ['mp4:3']);
});
