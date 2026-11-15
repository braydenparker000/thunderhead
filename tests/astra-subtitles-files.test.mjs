// Astra's subtitle files as bytes and as downloads (src/subtitles/charset.js, src/addons/subtitles.js):
// old code pages chosen from a language hint checked against the bytes, and what a subtitle add-on
// may send. The parsers and picture subtitles are in astra-subtitles.test.mjs. Every file, host and
// line here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSubtitleBytes, downloadSubtitle, fetchSubtitles, looksBinary, subtitleAddress, MAX_SUBTITLE_BYTES } from '../frontend/astra/src/addons/subtitles.js';
import { decodeText } from '../frontend/astra/src/subtitles/charset.js';

const BOM = '﻿';

// ---- what the bytes of a file say ----

const latin1 = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);
// Bytes of text in an old single-byte page: built by asking the decoder which byte gives each letter.
function inPage(page, s) {
  const table = new Map();
  for (let b = 0x80; b < 0x100; b++) table.set(new TextDecoder(page).decode(Uint8Array.of(b)), b);
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : table.get(ch));
}
const srt = (...lines) => lines.map((line, i) => `${i + 1}\r\n00:00:0${i},000 --> 00:00:0${i + 1},000\r\n${line}\r\n\r\n`).join('');

test('6: UTF-8 and UTF-16 are read as what they are, whatever language is named', () => {
  const greek = srt('Καλημέρα κόσμε', '<i>Τι κάνεις;</i>');
  assert.equal(decodeSubtitleBytes(utf8(greek), 'ru'), greek);
  assert.equal(decodeSubtitleBytes(utf8(BOM + greek), 'ja'), greek, 'the mark is not text');
  const le = new Uint8Array(new Uint16Array([...greek].map((ch) => ch.charCodeAt(0))).buffer);
  assert.equal(decodeSubtitleBytes(Uint8Array.from([0xff, 0xfe, ...le]), 'el'), greek);
  const plain = srt('Hello there', 'General Example');
  const le2 = new Uint8Array(new Uint16Array([...plain].map((ch) => ch.charCodeAt(0))).buffer);
  assert.equal(decodeSubtitleBytes(le2, 'en'), plain, 'UTF-16 without a mark');
  assert.equal(decodeSubtitleBytes(le2.map((_, i) => le2[i ^ 1]), 'en'), plain, 'and the other byte order');
  // One damaged byte in a UTF-8 file does not turn every other letter to rubbish.
  const damaged = utf8(srt('Καλημέρα κόσμε', 'Τι κάνεις;'));
  damaged[damaged.length - 12] = 0xff;
  assert.ok(decodeSubtitleBytes(damaged, 'el').includes('Καλημέρα κόσμε'));
});

test('6: an old code page is chosen from the language, in any spelling of it', () => {
  const greek = srt('Καλημέρα κόσμε', '<i>Τι κάνεις;</i>'), bytes = inPage('windows-1253', greek);
  for (const language of ['el', 'gre', 'ell', 'el-GR', 'GRE']) assert.equal(decodeSubtitleBytes(bytes, language), greek, language);
  const russian = srt('Привет, мир', 'Как дела?');
  for (const language of ['ru', 'rus', 'ru-RU']) assert.equal(decodeSubtitleBytes(inPage('windows-1251', russian), language), russian, language);
  const polish = srt('Dzień dobry, żółć', 'Proszę bardzo, cześć');
  assert.equal(decodeSubtitleBytes(inPage('windows-1250', polish), 'pol'), polish);
  // Chinese: Traditional files are Big5, Simplified GBK. 中文字幕 in each.
  const big5 = Uint8Array.from([...latin1('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), 0xa4, 0xa4, 0xa4, 0xe5, 0xa6, 0x72, 0xb9, 0xf5, 13, 10]);
  for (const language of ['zh-TW', 'zht', 'zh-Hant']) assert.ok(decodeSubtitleBytes(big5, language).includes('中文字幕'), language);
  const gbk = Uint8Array.from([...latin1('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), 0xd6, 0xd0, 0xce, 0xc4, 0xd7, 0xd6, 0xc4, 0xbb, 13, 10]);
  for (const language of ['zh', 'chi', 'zhs', 'zh-CN']) assert.ok(decodeSubtitleBytes(gbk, language).includes('中文字幕'), language);
  // Japanese: Shift_JIS (こんにちは) is told from EUC-JP by the bytes.
  const sjis = Uint8Array.from([...latin1('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), 0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 13, 10]);
  assert.ok(decodeSubtitleBytes(sjis, 'jpn').includes('こんにちは'));
  const euc = Uint8Array.from([...latin1('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), 0xa4, 0xb3, 0xa4, 0xf3, 0xa4, 0xcb, 0xa4, 0xc1, 0xa4, 0xcf, 13, 10]);
  assert.ok(decodeSubtitleBytes(euc, 'ja').includes('こんにちは'));
});

test('6: the language is a hint, checked against the bytes', () => {
  // A French file loaded while "Russian", "Greek" or "Japanese" is the chosen language stays French.
  const french = srt('Où est le café ? Déjà fermé.', 'Ça va très bien, à bientôt, garçon.', '<i>Voilà, c\'est l\'été, même ici.</i>');
  for (const language of ['ru', 'el', 'ja', 'zh', 'he', 'ar', 'th', 'ko', '', 'und', 'en']) assert.equal(decodeSubtitleBytes(inPage('windows-1252', french), language), french, language || 'none');
  const swedish = srt('Jag är här, på väg för att få se dig.', 'Då går vi över ån, så får vi se.');
  assert.equal(decodeSubtitleBytes(inPage('windows-1252', swedish), 'ru'), swedish);
  // Serbian is written in both alphabets under one code.
  const latinSerbian = srt('Šta radiš, čoveče? Đavo će ga znati.', 'Želim još, molim.');
  assert.equal(decodeSubtitleBytes(inPage('windows-1250', latinSerbian), 'srp'), latinSerbian);
  const cyrillicSerbian = srt('Шта радиш, човече?', 'Желим још, молим.');
  assert.equal(decodeSubtitleBytes(inPage('windows-1251', cyrillicSerbian), 'srp'), cyrillicSerbian);
  // No language named: the viewer's own languages are tried before Western European.
  const russian = srt('Привет, мир', 'Как дела?');
  assert.equal(decodeText(inPage('windows-1251', russian), '', ['en', 'ru']), russian);
  assert.equal(decodeText(inPage('windows-1251', russian), 'en', ['en', 'ru']), russian);
  // Nothing known at all: Western European, as before, and never a throw.
  assert.equal(decodeText(inPage('windows-1252', french), 'nonsense-language-code', []), french);
  assert.equal(typeof decodeText(Uint8Array.of(0xff, 0x80, 0x81), 'ja', []), 'string');
  assert.equal(decodeText(new Uint8Array(0), 'ja', []), '');
});

// ---- what a subtitle add-on may send ----

test('6: only plain web addresses are subtitle files', () => {
  assert.equal(subtitleAddress('https://cdn.example/a b.srt'), 'https://cdn.example/a%20b.srt');
  assert.equal(subtitleAddress('http://cdn.example/a.vtt'), 'http://cdn.example/a.vtt');
  for (const bad of ['javascript:alert(1)', 'data:text/plain,1', 'blob:https://cdn.example/1', 'file:///etc/passwd', 'ftp://cdn.example/a.srt', 'https://user:secret@cdn.example/a.srt', '/a.srt', '', null, 7, 'https://cdn.example/' + 'a'.repeat(5000)]) assert.equal(subtitleAddress(bad), '', String(bad).slice(0, 30));
});

// A stand-in for fetch: answers from a table and records what was asked. No network.
function withFetch(routes, run) {
  const real = globalThis.fetch, asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const route = routes[String(url)];
    if (!route) throw new TypeError('Failed to fetch');
    return typeof route === 'function' ? route() : route;
  };
  return Promise.resolve(run(asked)).finally(() => { globalThis.fetch = real; });
}
const answer = (body, headers = {}, status = 200) => new Response(body, { status, headers });

test('6: a chosen file is downloaded only while it looks like subtitles', async () => {
  const good = srt('Hello', 'World');
  let pulled = 0, cancelled = false;
  // A body that never ends: 1 MB pieces for as long as it is read.
  const endless = () => new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1 << 20).fill(65)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/plain' } });
  const zip = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 14, 15, 16, 17]);
  await withFetch({
    'https://cdn.example/good.srt': () => answer(good, { 'content-type': 'application/octet-stream' }),
    'https://cdn.example/film.srt': () => answer('x', { 'content-type': 'video/x-matroska' }),
    'https://cdn.example/pack.srt': () => answer('x', { 'content-type': 'application/zip' }),
    'https://cdn.example/big.srt': () => answer('x', { 'content-type': 'text/plain', 'content-length': String(MAX_SUBTITLE_BYTES + 1) }),
    'https://cdn.example/endless.srt': endless,
    'https://cdn.example/zip.srt': () => answer(zip, { 'content-type': 'text/plain' }),
    'https://cdn.example/gone.srt': () => answer('no', {}, 404),
  }, async (asked) => {
    assert.equal(new TextDecoder().decode(await downloadSubtitle('https://cdn.example/good.srt')), good);
    const kind = (url, options) => downloadSubtitle(url, options).then(() => 'read', (e) => e.kind || e.name);
    assert.equal(await kind('https://cdn.example/film.srt'), 'type');
    assert.equal(await kind('https://cdn.example/pack.srt'), 'type');
    assert.equal(await kind('https://cdn.example/big.srt'), 'size');
    assert.equal(await kind('https://cdn.example/endless.srt'), 'size');
    assert.ok(cancelled && pulled <= 12, `the endless download is stopped just past the limit (${pulled} MB read)`);
    assert.equal(await kind('https://cdn.example/zip.srt'), 'binary');
    assert.equal(await kind('https://cdn.example/gone.srt'), 'http');
    assert.equal(await kind('https://cdn.example/small.srt', { maxBytes: 4 }), 'TypeError', 'a failed request stays the browser\'s own error');
    assert.equal(await kind('https://cdn.example/good.srt', { maxBytes: 4 }), 'size');
    const before = asked.length;
    assert.equal(await kind('javascript:alert(1)'), 'address');
    assert.equal(await kind('file:///sdcard/a.srt'), 'address');
    assert.equal(asked.length, before, 'nothing is asked of an address that is not http(s)');
    // No message carries the address.
    for (const url of ['https://cdn.example/film.srt', 'https://cdn.example/big.srt', 'https://cdn.example/gone.srt']) {
      const message = await downloadSubtitle(url).catch((e) => e.message);
      assert.ok(!/cdn\.example|https?:/.test(message), message);
    }
  });
  assert.equal(looksBinary(utf8(good)), false);
  assert.equal(looksBinary(inPage('windows-1251', srt('Привет'))), false);
  assert.equal(looksBinary(new Uint8Array(new Uint16Array([...good].map((ch) => ch.charCodeAt(0))).buffer)), false, 'UTF-16 is text');
  assert.equal(looksBinary(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0, 0, 0, 0, 0x23, 0x42, 0x86, 0x81, 1])), true, 'the start of a Matroska film');
});

test('6: an add-on\'s list is cut to what a menu can hold', async () => {
  const manifest = { id: 'example.subs', name: 'Example Subs ' + 'x'.repeat(500), version: '1.0.0', resources: ['subtitles'], types: ['movie'] };
  const subtitles = [
    { url: 'javascript:alert(1)', lang: 'eng' },
    { url: 'https://cdn.example/1.srt', lang: 'pob', label: 7, subtitleFileName: 'n'.repeat(999) },
    { url: 'https://cdn.example/1.srt', lang: 'eng' },
    { url: 'https://cdn.example/2.srt', lang: { toString() { return 'x'.repeat(1e6); } }, label: 'L'.repeat(999), m: 'h' },
    null, 'text', { url: 42 },
    ...Array.from({ length: 5000 }, (_, i) => ({ url: `https://cdn.example/many/${i}.srt`, lang: 'eng' })),
  ];
  await withFetch({
    'https://addon.example/list/manifest.json': () => answer(JSON.stringify(manifest)),
    'https://addon.example/list/subtitles/movie/tt0000001.json': () => answer(JSON.stringify({ subtitles })),
  }, async () => {
    const lists = [];
    const all = await fetchSubtitles([{ url: 'https://addon.example/list/manifest.json', name: 'Example' }], 'movie', 'tt0000001', {}, { onList: (l) => lists.push(l) });
    assert.equal(all.length, 300);
    assert.equal(lists.length, 1);
    assert.deepEqual(all[0], { url: 'https://cdn.example/1.srt', language: 'pt-BR', label: '7', source: manifest.name.slice(0, 60), exact: false, name: 'n'.repeat(120) });
    assert.deepEqual([all[1].url, all[1].language, all[1].label.length, all[1].exact], ['https://cdn.example/2.srt', '', 120, true]);
    assert.ok(all.every((e) => /^https:\/\/cdn\.example\//.test(e.url)));
  });
});
