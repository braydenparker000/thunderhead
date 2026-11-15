// Astra's subtitle parsers and picture subtitles (frontend/astra/src/subtitles/): files as people
// really find them (odd blank lines, missing fractions, old .ssa colours), and picture subtitles that
// claim impossible sizes or arrive out of order. Code pages and add-on downloads are in
// astra-subtitles-files.test.mjs. Every file, host and line here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, parseVtt, parseAss, parseSubtitleFile, markupSpans, assColor, parseTime, srtBlockCue } from '../frontend/astra/src/subtitles/parse.js';
import { PgsDecoder, PgsTimeline } from '../frontend/astra/src/subtitles/pgs.js';
import { VobSubDecoder, parseIdx } from '../frontend/astra/src/subtitles/vobsub.js';

const BOM = '﻿';
const text = (cue) => cue.spans.map((s) => s.text).join('');
const brief = (cues) => cues.map((c) => [c.start, c.end, text(c)]);
const crlf = (s) => s.replace(/\n/g, '\r\n');

// ---- the common path: one small file of each kind, with a mark and Windows line ends ----

test('a small SRT file with a mark and CRLF', () => {
  const cues = parseSubtitleFile(BOM + crlf('1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}Up top\nsecond line\n'), 'film.srt');
  assert.deepEqual(brief(cues), [[1, 2.5, 'Hello there'], [3, 4, 'Up top\nsecond line']]);
  assert.deepEqual(cues[0].spans, [{ text: 'Hello ', i: false, b: false, u: false, color: null }, { text: 'there', i: true, b: false, u: false, color: null }]);
  assert.equal(cues[0].align, 2);
  assert.equal(cues[1].align, 8);
});

test('a small WebVTT file with a mark and CRLF', () => {
  const cues = parseSubtitleFile(BOM + crlf('WEBVTT\n\nNOTE made for a test\n\nintro\n00:01.000 --> 00:02.000 line:0\n<v Ada>Hello</v>\n\n00:00:03.000 --> 00:00:04.000 align:left\n<c.yellow>World</c> &amp; all\n'), '');
  assert.deepEqual(brief(cues), [[1, 2, 'Hello'], [3, 4, 'World & all']]);
  assert.equal(cues[0].align, 8, 'line:0 is the top');
  assert.equal(cues[1].align, 1);
});

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
Style: Sign,Arial,60,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello, world\\Nsecond {\\i1}line{\\i0}
Dialogue: 1,0:00:03.00,0:00:04.00,Sign,,0,0,0,,{\\pos(960,540)}A sign
`;

test('a small ASS file with a mark and CRLF', () => {
  const cues = parseSubtitleFile(BOM + crlf(ASS), 'film.ass');
  assert.deepEqual(brief(cues), [[1, 2.5, 'Hello, world\nsecond line'], [3, 4, 'A sign']]);
  assert.equal(cues[0].spans[1].i, true);
  assert.equal(cues[0].spans[0].color, null, 'white is the viewer\'s own colour');
  assert.deepEqual([cues[1].align, cues[1].pos, cues[1].layer, cues[1].spans[0].color, cues[1].spans[0].b], [8, { x: 0.5, y: 0.5 }, 1, '#ffff00', true]);
});

const SSA = `[Script Info]
ScriptType: v4.00

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,28,16777215,65535,0,0,0,0,1,2,2,2,10,10,10,0,1
Style: Top,Arial,28,65535,65535,0,0,0,-1,1,2,2,6,10,10,10,0,1

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:02.00,*Default,,0,0,0,,Plain white
Dialogue: Marked=0,0:00:03.00,0:00:04.00,Top,,0,0,0,,Yellow, on top
`;

test('a small SSA file with a mark and CRLF: decimal colours, old alignment, *Default', () => {
  const cues = parseSubtitleFile(BOM + crlf(SSA), 'film.ssa');
  assert.deepEqual(brief(cues), [[1, 2, 'Plain white'], [3, 4, 'Yellow, on top']]);
  assert.equal(cues[0].spans[0].color, null, 'a white v4 style is white, not teal');
  assert.deepEqual([cues[1].spans[0].color, cues[1].spans[0].i, cues[1].align], ['#ffff00', true, 8]);
});

// ---- finding 3: real-world quirks ----

const WHOLE = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n \r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n';

test('3a: a "blank" line holding a space still separates cues (SRT and WebVTT)', () => {
  assert.deepEqual(brief(parseSrt(WHOLE)), [[1, 2, 'Hello'], [3, 4, 'World']]);
  assert.deepEqual(brief(parseSubtitleFile(WHOLE, 'a.srt')), [[1, 2, 'Hello'], [3, 4, 'World']]);
  assert.deepEqual(brief(parseVtt('WEBVTT\r\n\r\n' + WHOLE.replace(/,/g, '.').replace(' \r\n', '\t \r\n'))), [[1, 2, 'Hello'], [3, 4, 'World']]);
});

test('3a: no blank line between cues at all', () => {
  const tight = '1\n00:00:01,000 --> 00:00:02,000\nHello\n2\n00:00:03,000 --> 00:00:04,000\nWorld\nmore\n3\n00:00:05,000 --> 00:00:06,000\n4 8 15\n';
  assert.deepEqual(brief(parseSrt(tight)), [[1, 2, 'Hello'], [3, 4, 'World\nmore'], [5, 6, '4 8 15']]);
  assert.deepEqual(brief(parseVtt('WEBVTT\n' + tight.replace(/,/g, '.'))), [[1, 2, 'Hello'], [3, 4, 'World\nmore'], [5, 6, '4 8 15']]);
});

test('3a: no cue ever holds a timing line, whatever the file looks like', () => {
  const odd = [WHOLE, WHOLE.replace(/\r\n/g, '\r'), WHOLE.replace(/\r\n \r\n/, '\r\n'), 'junk\n' + WHOLE + '00:00:09,000 --> oops\nlost\n00:00:10,000 --> 00:00:11,000\nlast', WHOLE.repeat(40)];
  for (const file of odd) for (const cues of [parseSrt(file), parseVtt(file), parseSubtitleFile(file, 'x.srt')]) {
    assert.ok(cues.length >= 2, 'more than one cue');
    for (const c of cues) assert.ok(!/-->/.test(text(c)), 'no timing line in a cue\'s text');
  }
  // A timing line that cannot be read ends the cue above it and shows nothing itself.
  assert.deepEqual(brief(parseSrt(odd[3])), [[1, 2, 'Hello'], [3, 4, 'World'], [10, 11, 'last']]);
});

test('3a: numbers that are text stay; text may hold an empty line (SRT) and "-->" in a sentence', () => {
  assert.deepEqual(brief(parseSrt('1\n00:00:01,000 --> 00:00:02,000\n1984\n\n2\n00:00:03,000 --> 00:00:04,000\nline one\n\nline two\n\n3\n00:00:05,000 --> 00:00:06,000\nleft --> right\n')),
    [[1, 2, '1984'], [3, 4, 'line one\nline two'], [5, 6, 'left --> right']]);
  // A file that does not count its cues: a lone number under a timing line is that cue's text.
  assert.deepEqual(brief(parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\n42\n00:03.000 --> 00:04.000\nNext\n')), [[1, 2, '42'], [3, 4, 'Next']]);
});

test('3b: WebVTT inline times are not text', () => {
  assert.equal(text(parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello<00:00:01.500><c> world</c>\n')[0]), 'hello world');
  assert.equal(markupSpans('one<00:01.000> two<01:02:03.456> three').map((s) => s.text).join(''), 'one two three');
});

test('3c: a number that is no character does not stop the file', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nA &#99999999; B\n\n2\n00:00:03,000 --> 00:00:04,000\n&#233;t&#xE9; &#xD800; &#0; &amp; &nosuch;\n');
  assert.deepEqual(brief(cues), [[1, 2, 'A &#99999999; B'], [3, 4, 'été &#xD800; &#0; & &nosuch;']]);
});

test('3d: colours as old .ssa files write them', () => {
  assert.equal(assColor('16777215'), '#ffffff');
  assert.equal(assColor('65535'), '#ffff00');
  assert.equal(assColor('255'), '#ff0000');
  assert.equal(assColor('-1'), '#ffffff');
  assert.equal(assColor('&H00FFFFFF'), '#ffffff');
  assert.equal(assColor('&H0000FFFF&'), '#ffff00');
  assert.equal(assColor('&HFF&'), '#ff0000');
  assert.equal(assColor(''), null);
  assert.equal(assColor('none'), null);
});

test('3e: times without a fraction, text that only looks like a tag, ASS overrides inside SRT', () => {
  assert.deepEqual(brief(parseSrt('1\n00:00:01 --> 00:00:02\nNo fraction\n')), [[1, 2, 'No fraction']]);
  assert.equal(parseTime('00:00:01'), 1);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(text(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nif a<b and c>d then\n')[0]), 'if a<b and c>d then');
  assert.equal(markupSpans('1 < 2 and 3 > 2, x<y, <3').map((s) => s.text).join(''), '1 < 2 and 3 > 2, x<y, <3');
  const [cue] = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n{\\i1}slanted{\\i0} {\\pos(10,20)}placed {\\b1\\an8}bold{\\b0} {\\u1}under{\\u0} {\\c&H0000FF&}red {not a tag}\n');
  assert.equal(text(cue), 'slanted placed bold under red {not a tag}');
  assert.equal(cue.align, 8);
  assert.deepEqual(cue.spans.filter((s) => s.i || s.b || s.u).map((s) => [s.text, s.i, s.b, s.u]), [['slanted', true, false, false], ['bold', false, true, false], ['under', false, false, true]]);
  // Real tags still work, in any case and with attributes.
  assert.deepEqual(markupSpans('<I>a</I><font color="#ff0000">b</font><b>c</b><br/>d').map((s) => [s.text, s.i, s.b, s.color]), [['a', true, false, null], ['b', false, false, '#ff0000'], ['c', false, true, null], ['d', false, false, null]]);
  assert.equal(srtBlockCue('{\\a6}old top', 1, 2).align, 8, 'the old \\a numbers are not numpad positions');
});

test('what worked before still works', () => {
  // Hours over 99, in SRT and ASS.
  assert.deepEqual(brief(parseSrt('1\n100:00:01,500 --> 100:00:02,000\nLate\n')), [[360001.5, 360002, 'Late']]);
  const events = (lines) => '[Script Info]\nPlayResX: 100\nPlayResY: 100\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + lines.join('\n') + '\n';
  assert.deepEqual(brief(parseAss(events(['Dialogue: 0,100:00:01.50,100:00:02.00,Default,,0,0,0,,Late']))), [[360001.5, 360002, 'Late']]);
  // Commas in the text, \N, drawings, karaoke, \t(...).
  const cues = parseAss(events([
    'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,One, two, three\\Nfour',
    'Dialogue: 0,0:00:01.00,0:00:09.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 0 10 10{\\p0}after the drawing',
    'Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\k20}ka{\\k30}ra{\\kf10}o{\\ko5}ke',
    'Dialogue: 0,0:00:02.50,0:00:04.00,Default,,0,0,0,,{\\t(0,500,\\fscx120\\fscy120)\\fad(100,100)}moving',
  ]));
  // Out of order in the file, overlapping in time: sorted by start, all kept.
  assert.deepEqual(brief(cues), [[1, 9, 'after the drawing'], [2, 3, 'karaoke'], [2.5, 4, 'moving'], [5, 6, 'One, two, three\nfour']]);
  // Overlapping and unsorted SRT cues are all kept.
  assert.equal(parseSrt('2\n00:00:05,000 --> 00:00:09,000\nB\n\n1\n00:00:01,000 --> 00:00:07,000\nA\n').length, 2);
  // The first line decides the format; the name is only a hint.
  assert.equal(text(parseSubtitleFile(ASS, 'wrong.srt')[0]), 'Hello, world\nsecond line');
  assert.equal(text(parseSubtitleFile('WEBVTT\n\n00:01.000 --> 00:02.000\nvtt', 'wrong.ass')[0]), 'vtt');
  assert.equal(text(parseSubtitleFile('1\n00:00:01,000 --> 00:00:02,000\nsrt\n', 'https://cdn.example/classic/Glass.Onion')[0]), 'srt');
  assert.deepEqual(parseSubtitleFile('nothing here', 'x.srt'), []);
});

// ---- picture subtitles ----

const be16 = (n) => [n >> 8 & 255, n & 255];
const seg = (type, data) => [type, ...be16(data.length), ...data];
const pcs = (w, h, objects, { state = 0x80, palette = 0 } = {}) => seg(0x16, [...be16(w), ...be16(h), 0x10, 0, 1, state, 0, palette, objects.length,
  ...objects.flatMap((o) => [...be16(o.id), 0, o.crop ? 0x80 : 0, ...be16(o.x || 0), ...be16(o.y || 0), ...(o.crop ? o.crop.flatMap(be16) : [])])]);
const pds = (entries) => seg(0x14, [0, 0, ...entries.flat()]); // [index, Y, Cr, Cb, alpha]
const ods = (id, w, h, rle, flags = 0xc0) => seg(0x15, [...be16(id), 0, flags, 0, ...be16(rle.length + 4), ...be16(w), ...be16(h), ...rle]);
const END = seg(0x80, []);
const WHITE = [1, 235, 128, 128, 255];
// Two rows of four pixels of colour 1: each row is "0, 0x80|4, 1" then end of line "0, 0".
const RLE_4x2 = [0, 0x84, 1, 0, 0, 0, 0x84, 1, 0, 0];
const showSet = Uint8Array.from([...pcs(1920, 1080, [{ id: 0, x: 100, y: 900 }]), ...pds([WHITE]), ...ods(0, 4, 2, RLE_4x2), ...END]);
const clearSet = Uint8Array.from([...pcs(1920, 1080, [], { state: 0 }), ...END]);

test('a PGS picture decodes to its pixels', () => {
  const cue = new PgsDecoder('t').decode(showSet, 5);
  assert.deepEqual([cue.start, cue.end, cue.provisional, cue.image.frameWidth, cue.image.frameHeight], [5, 15, true, 1920, 1080]);
  const [part] = cue.image.parts;
  assert.deepEqual([part.x, part.y, part.width, part.height], [100, 900, 4, 2]);
  assert.deepEqual([...part.draw()], Array(8).fill(0xffffffff));
  assert.deepEqual(new PgsDecoder('t').decode(clearSet, 6), { clear: 6 });
});

test('2: after a seek back, each picture ends at its own clear, not at the far set read first', () => {
  const decoder = new PgsDecoder('t'), timeline = new PgsTimeline();
  const add = (set, time) => { const r = decoder.decode(set, time); return [r, timeline.add(r)]; };
  // Resumed at 70:00: that part is read first.
  add(showSet, 4200);
  // Then a seek back to 30:00.
  const [a] = add(showSet, 1800);
  assert.deepEqual([a.end, a.provisional], [1810, true], 'no near set known yet: ten seconds, to be corrected');
  const [, changedA] = add(clearSet, 1803);
  const [b] = add(showSet, 1805);
  const [, changedB] = add(clearSet, 1808);
  const [c] = add(showSet, 1810);
  const [, changedC] = add(clearSet, 1812);
  assert.deepEqual([[a.start, a.end], [b.start, b.end], [c.start, c.end]], [[1800, 1803], [1805, 1808], [1810, 1812]]);
  assert.deepEqual([changedA, changedB, changedC], [true, true, true], 'each correction asks the renderer to look again');
  assert.ok(![a, b, c].some((cue) => cue.provisional));
});

test('2: the nearest following set always ends the picture before it', () => {
  const cue = (start) => ({ start, end: start + 10, provisional: true, image: {} });
  const timeline = new PgsTimeline();
  // Read in order: the next picture ends the one before, also past the ten-second guess.
  const a = cue(100), b = cue(125);
  timeline.add(a);
  assert.equal(timeline.add(b), true);
  assert.deepEqual([a.end, a.provisional], [125, false]);
  // Read late, between the two: it cuts a picture whose end was already settled.
  assert.equal(timeline.add({ clear: 104 }), true);
  assert.equal(a.end, 104);
  // A picture read before a known near set ends there at once; before a far one it keeps its guess.
  const early = cue(120.5), lone = cue(10);
  assert.equal(timeline.add(early), false);
  assert.deepEqual([early.end, early.provisional], [125, false]);
  timeline.add(lone);
  assert.deepEqual([lone.end, lone.provisional], [20, true]);
  // The block's own length is used, unless a known set comes sooner.
  const timed = cue(300), cut = cue(400);
  timeline.add(timed, 4);
  assert.deepEqual([timed.end, timed.provisional], [304, false]);
  timeline.add({ clear: 402 });
  timeline.add(cut, 5);
  assert.equal(cut.end, 402);
  // The same set read twice changes nothing.
  assert.equal(timeline.add({ clear: 402 }), false);
  // A cue the player moved to another clock keeps its length, not the file's time.
  const moved = cue(500);
  timeline.add(moved);
  moved.start -= 30; moved.end -= 30;
  assert.equal(timeline.add({ clear: 503 }), true);
  assert.deepEqual([moved.start, moved.end], [470, 473]);
});

test('4: PGS sizes are checked against the frame', () => {
  // An object header claiming 8000×8000 in a 14-byte segment.
  const huge = ods(0, 8000, 8000, []);
  assert.equal(huge.length, 14);
  assert.equal(new PgsDecoder('t').decode(Uint8Array.from([...pcs(1920, 1080, [{ id: 0 }]), ...pds([WHITE]), ...huge, ...END]), 1), null);
  // The frame itself cannot claim more than 4096×2304.
  assert.equal(new PgsDecoder('t').decode(Uint8Array.from([...pcs(60000, 60000, [{ id: 0 }]), ...pds([WHITE]), ...huge, ...END]), 1), null);
  // An object wider than its frame, though under the hard cap.
  assert.equal(new PgsDecoder('t').decode(Uint8Array.from([...pcs(720, 480, [{ id: 0 }]), ...pds([WHITE]), ...ods(0, 1920, 100, []), ...END]), 1), null);
  // A crop of 8000×8000 on a 4×2 object is cut to the object.
  const cropped = new PgsDecoder('t').decode(Uint8Array.from([...pcs(1920, 1080, [{ id: 0, crop: [1, 0, 8000, 8000] }]), ...pds([WHITE]), ...ods(0, 4, 2, RLE_4x2), ...END]), 1);
  const [part] = cropped.image.parts;
  assert.deepEqual([part.width, part.height, part.draw().length], [3, 2, 6]);
  // A crop that starts outside the object shows nothing.
  assert.equal(new PgsDecoder('t').decode(Uint8Array.from([...pcs(1920, 1080, [{ id: 0, crop: [9, 9, 2, 2] }]), ...pds([WHITE]), ...ods(0, 4, 2, RLE_4x2), ...END]), 1), null);
  // An object whose last piece never came is not drawn; once it comes, it is.
  const first = ods(0, 4, 2, RLE_4x2.slice(0, 5), 0x80);
  first[4 + 3] = 0; first[5 + 3] = 0; first[6 + 3] = RLE_4x2.length + 4; // the header promises all ten bytes
  const rest = seg(0x15, [...be16(0), 0, 0x40, ...RLE_4x2.slice(5)]);
  assert.equal(new PgsDecoder('t').decode(Uint8Array.from([...pcs(1920, 1080, [{ id: 0 }]), ...pds([WHITE]), ...first, ...END]), 1), null);
  const whole = new PgsDecoder('t').decode(Uint8Array.from([...pcs(1920, 1080, [{ id: 0 }]), ...pds([WHITE]), ...first, ...rest, ...END]), 1);
  assert.deepEqual([...whole.image.parts[0].draw()], Array(8).fill(0xffffffff));
});

// One VobSub packet: a control list at `at` saying show now, area x1..x2 × y1..y2, picture data at 4.
function spu({ x1, x2, y1, y2, size = 64 }) {
  const bytes = new Uint8Array(size), at = size - 24;
  bytes.set([...be16(size), ...be16(at)]);
  bytes.set([...be16(0), ...be16(at), 0x03, 0x32, 0x10, 0x04, 0xff, 0xf0, 0x05, x1 >> 4, (x1 & 15) << 4 | x2 >> 8, x2 & 255, y1 >> 4, (y1 & 15) << 4 | y2 >> 8, y2 & 255, 0x06, ...be16(4), ...be16(4), 0x01, 0xff], at);
  return bytes;
}

test('4: VobSub sizes are checked against the .idx frame', () => {
  const idx = 'size: 720x480\npalette: 000000, ffffff, 808080, ff0000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000, 000000\n';
  const decoder = new VobSubDecoder(idx, 'v');
  // A 64-byte packet claiming 4096×4096.
  assert.equal(decoder.decode(spu({ x1: 0, x2: 4095, y1: 0, y2: 4095 }), 1), null);
  assert.equal(decoder.decode(spu({ x1: 0, x2: 799, y1: 0, y2: 99 }), 1), null, 'wider than the frame');
  const cue = decoder.decode(spu({ x1: 100, x2: 131, y1: 400, y2: 407 }), 1);
  const [part] = cue.image.parts;
  assert.deepEqual([cue.image.frameWidth, cue.image.frameHeight, part.x, part.y, part.width, part.height, part.draw().length], [720, 480, 100, 400, 32, 8, 256]);
  // No frame size in the header (or an absurd one): a hard cap of 4096×2304 instead.
  assert.deepEqual([parseIdx('').sized, parseIdx('size: 99999x99999').sized, parseIdx('size: 99999x99999').width], [false, false, 720]);
  const loose = new VobSubDecoder('', 'v');
  assert.equal(loose.decode(spu({ x1: 0, x2: 4095, y1: 0, y2: 4095 }), 1), null);
  assert.equal(loose.decode(spu({ x1: 0, x2: 1919, y1: 0, y2: 99 }), 1).image.parts[0].width, 1920);
});
