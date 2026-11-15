// What the engine hands the player's newer pieces, as pure logic: the fonts read from a Matroska
// file's attachments (bounded, fonts only, never past the element), which subtitle files libass can
// draw, the second track's cues moved to the top, and the sound tap's bookkeeping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFonts, isFont } from '../frontend/astra/src/engine/mkv-attachments.js';
import { assScript } from '../frontend/astra/src/engine/player-libass.js';
import { atTop } from '../frontend/astra/src/engine/player-second.js';

// EBML elements by hand: an id's bytes, then an 8-byte size, then the body.
const el = (id, ...body) => {
  const data = Buffer.concat(body.map((b) => (typeof b === 'string' ? Buffer.from(b) : Buffer.from(b))));
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(data.length)); size[0] |= 0x01;
  return Buffer.concat([Buffer.from(id), size, data]);
};
const file = (name, type, bytes) => el([0x61, 0xa7], el([0x46, 0x6e], name), el([0x46, 0x60], type), el([0x46, 0x5c], bytes), el([0x46, 0xae], [1, 2, 3, 4]));
const attachments = (...files) => el([0x19, 0x41, 0xa4, 0x69], ...files);
/** A reader over `bytes` that counts what it was asked for. */
const reader = (bytes) => { const asked = []; return { asked, read: async (s, e) => { asked.push([s, e]); return new Uint8Array(bytes.subarray(s, e)); } }; };

test('fonts are read from the attachments; other files are passed over without reading their data', async () => {
  const font = Buffer.alloc(5000, 7), cover = Buffer.alloc(200_000, 9);
  const pad = Buffer.alloc(100);
  const bytes = Buffer.concat([pad, attachments(file('cover.jpg', 'image/jpeg', cover), file('Inter-Bold.woff2', 'font/woff2', font), file('Old.TTF', 'application/octet-stream', [1, 2]), file('x.otf', 'application/vnd.ms-opentype', [3]))]);
  const r = reader(bytes);
  const fonts = await readFonts(r.read, bytes.length, pad.length);
  assert.deepEqual(fonts.map((f) => [f.name, f.data.byteLength]), [['Inter-Bold.woff2', 5000], ['Old.TTF', 2], ['x.otf', 1]]);
  assert.ok(fonts[0].data.every((b) => b === 7));
  const read = r.asked.reduce((n, [s, e]) => n + e - s, 0);
  assert.ok(read < 20_000, `the cover picture was not downloaded (${read} bytes read)`);
});

test('the fonts are bounded: total bytes and number of files', async () => {
  const files = Array.from({ length: 5 }, (_, i) => file(`f${i}.ttf`, 'font/ttf', Buffer.alloc(1000, i)));
  const bytes = attachments(...files);
  assert.equal((await readFonts(reader(bytes).read, bytes.length, 0, { maxBytes: 2500 })).length, 2);
  assert.equal((await readFonts(reader(bytes).read, bytes.length, 0, { maxFiles: 3 })).length, 3);
});

test('a damaged element is met with what could be read, never a read past it', async () => {
  const good = file('a.ttf', 'font/ttf', Buffer.alloc(10, 1));
  // A file that claims to run 1 MB past its parent's end.
  const big = Buffer.from([0x61, 0xa7, 0x01, 0, 0, 0, 0, 0x10, 0, 0]);
  const bytes = attachments(good, big);
  const r = reader(bytes);
  const fonts = await readFonts(r.read, bytes.length, 0);
  assert.deepEqual(fonts.map((f) => f.name), ['a.ttf']);
  assert.ok(r.asked.every(([, e]) => e <= bytes.length));
  // Not an Attachments element where the layout said: nothing.
  assert.deepEqual(await readFonts(reader(good).read, good.length, 0), []);
  assert.deepEqual(await readFonts(reader(good).read, good.length, 5000), []);
});

test('which attachments count as fonts', () => {
  for (const [name, type] of [['a.ttf', ''], ['b', 'font/otf'], ['c', 'application/x-truetype-font'], ['d.WOFF2', 'application/octet-stream'], ['e.ttc', '']]) assert.ok(isFont(name, type), name);
  for (const [name, type] of [['cover.jpg', 'image/jpeg'], ['notes.txt', 'text/plain'], ['font.ttf.zip', '']]) assert.ok(!isFont(name, type), name);
});

test('libass is given a subtitle file only when it is ASS/SSA', () => {
  const ass = '﻿[Script Info]\nScriptType: v4.00+\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi';
  assert.equal(assScript(ass, 'x.srt'), ass.slice(1));
  assert.equal(assScript('1\n00:00:01,000 --> 00:00:02,000\nHi\n', 'film.ass'), null);
  assert.ok(assScript('[V4+ Styles]\nStyle: Default\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi', 'https://subs.example/a.ass?x=1'));
  assert.equal(assScript('[V4+ Styles]\nDialogue: x', 'Glass.Onion.srt'), null);
});

test('the second track\'s cues move to the top; placed ones stay where they are', () => {
  const cue = (align, pos = null) => ({ start: 1, end: 2, align, pos, spans: [{ text: 'x' }] });
  assert.deepEqual(atTop([cue(2), cue(1), cue(undefined), cue(8), cue(5), cue(2, { x: 0.5, y: 0.5 })]).map((c) => c.align), [8, 7, 8, 8, 5, 2]);
});
