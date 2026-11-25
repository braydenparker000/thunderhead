// The data meter's arithmetic and its workers' side (frontend/th/data/, docs/engineering/DATA-METER.md):
// a count's size from headers (a range is its range, a 304 its headers), from a timeline entry; the day
// and the month at the owner's local midnight; the Wi-Fi / mobile / unknown split; the 62-day cut; a
// reset; sizes in words; an answer with no size counted by the bytes read, as they pass; Music's catalogue
// and its app's own files as rows of their own, its worker's release files among them; Settings' search
// finds the page; and nothing in the meter sends anything.
// Invented numbers only.
process.env.TZ = 'America/Denver';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { HEADERS, KEY, add, dayOf, empty, entrySize, firstSight, merge, netOf, parse, prune, sizeOf, totals, words } from '../frontend/th/data/tally.js';
import { find } from '../frontend/apps/settings/finder.js';

const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();

test('sizes from headers: a range counts its range, a 304 its headers, nothing said is not guessed', () => {
  assert.equal(sizeOf({ status: 206, length: '1000', range: 'bytes 5000-5999/9000000' }), 1000 + HEADERS);
  assert.equal(sizeOf({ status: 206, length: null, range: 'bytes 0-99/9000000' }), 100 + HEADERS);
  assert.equal(sizeOf({ status: 200, length: '4096' }), 4096 + HEADERS);
  assert.equal(sizeOf({ status: 304, length: null }), HEADERS);
  assert.equal(sizeOf({ status: 304, length: '4096' }), HEADERS, 'a 304 is its headers only');
  assert.equal(sizeOf({ status: 200, length: null, range: null }), null);
  assert.equal(sizeOf({ status: 200, length: '' }), null);
});

test('sizes from the timeline: caches and workers count nothing here, then transfer, body, a held length', () => {
  assert.equal(entrySize({ transferSize: 0, encodedBodySize: 5000, deliveryType: 'cache' }), 0, 'a service worker answered: it counts');
  assert.equal(entrySize({ transferSize: 10_300, encodedBodySize: 10_000, deliveryType: '' }), 10_300);
  assert.equal(entrySize({ transferSize: 0, encodedBodySize: 800, deliveryType: '' }), 800);
  assert.equal(entrySize({ transferSize: 0, encodedBodySize: 0, deliveryType: '' }, 1200), 1200);
  assert.equal(entrySize({ transferSize: 0, encodedBodySize: 0, deliveryType: '' }), null);
});

test('a page’s own load counts once, though Chrome hands its navigation entry over twice', () => {
  // What Chrome gives a buffered observer started before the load ends: the entry at once, then again at loadEventEnd.
  const fresh = firstSight(), nav = { entryType: 'navigation' }, again = { entryType: 'navigation' }, css = { entryType: 'resource' }, css2 = { entryType: 'resource' };
  assert.deepEqual([nav, css, again, nav, css, css2].map(fresh), [true, true, false, false, false, true], 'the same file fetched twice is two entries, both counted');
  assert.equal(firstSight()(again), true, 'each document has its own');
});

test('the network as the browser says, never guessed', () => {
  assert.deepEqual(['wifi', 'cellular', 'ethernet', 'none', undefined, 'unknown'].map(netOf), [0, 1, 2, 2, 2, 2]);
});

test('today and this month turn over at the owner’s local midnight, split by network, parts largest first', () => {
  const t = empty(at(2026, 11, 1));
  add(t, dayOf(at(2026, 11, 20, 23, 59, 59)), 'music.songs', 0, 1000);
  add(t, dayOf(at(2026, 11, 21, 0, 0, 1)), 'music.songs', 1, 2000);
  add(t, dayOf(at(2026, 11, 21, 0, 0, 1)), 'music.covers', 2, 300);
  add(t, dayOf(at(2026, 11, 21, 8)), 'api', 0, 5000);
  add(t, dayOf(at(2026, 10, 31, 23, 59)), 'home', 0, 7000);
  assert.equal(dayOf(at(2026, 11, 21, 0, 0, 1)), '2026-11-21');
  assert.equal(new Date(at(2026, 11, 21, 0, 0, 1)).toISOString().slice(0, 10), '2026-11-21', 'Denver’s midnight is 07:00 UTC');
  const { today, month } = totals(t, at(2026, 11, 21, 9));
  assert.deepEqual(today.all, [5000, 2000, 300]);
  assert.deepEqual(month.all, [6000, 2000, 300], 'October’s last minute is not in November');
  assert.deepEqual(month.rows.slice(0, 2).map((r) => r.id), ['api', 'music']);
  const music = month.rows.find((r) => r.id === 'music');
  assert.deepEqual(music.split, [1000, 2000, 300]);
  assert.deepEqual(music.pieces.map((p) => [p.name, p.split]), [['Songs', [1000, 2000, 0]], ['Covers', [0, 0, 300]], ['Catalogue', [0, 0, 0]], ['App files', [0, 0, 0]], ['The rest', [0, 0, 0]]]);
  // The catalogue and the app's own files are Music's, each its own row.
  add(t, '2026-11-21', 'music.catalog', 0, 400);
  add(t, '2026-11-21', 'music.app', 1, 500);
  const after = totals(t, at(2026, 11, 21, 9)).month.rows.find((r) => r.id === 'music');
  assert.deepEqual(after.split, [1400, 2500, 300]);
  assert.deepEqual(after.pieces.slice(2, 4).map((p) => [p.name, p.split]), [['Catalogue', [400, 0, 0]], ['App files', [0, 500, 0]]]);
  // The next month starts empty.
  assert.deepEqual(totals(t, at(2026, 12, 1, 0, 0, 1)).month.all, [0, 0, 0]);
  // Unknown parts and nothing at all are not counted.
  add(t, '2026-11-21', 'elsewhere', 0, 99);
  add(t, '2026-11-21', 'home', 0, 0);
  assert.deepEqual(totals(t, at(2026, 11, 21, 9)).today.all, [5000, 2000, 300]);
});

test('62 days are kept, today included; a batch merges in; a broken store starts again', () => {
  const now = at(2026, 11, 21, 9);
  const t = empty(now);
  add(t, '2026-09-21', 'home', 0, 1);   // today - 61: kept
  add(t, '2026-09-20', 'home', 0, 1);   // today - 62: cut
  prune(t, now);
  assert.deepEqual(Object.keys(t.days), ['2026-09-21']);
  const b = empty(0);
  add(b, '2026-11-21', 'photos', 1, 50);
  b.unsized = 2;
  merge(t, b);
  assert.deepEqual([t.days['2026-11-21'].photos, t.unsized], [[0, 50, 0], 2]);
  assert.deepEqual(parse(JSON.parse(JSON.stringify(t)), now), t);
  assert.deepEqual(parse({ v: 9 }, now), empty(now));
  assert.deepEqual(parse({ v: 1, since: 1, days: { '2026-11-21': { home: [1, -2, 3], api: [1, 2, 3] } } }, now).days, { '2026-11-21': { api: [1, 2, 3] } });
});

test('the store: batches merge into one localStorage entry under th.p., and Reset starts again from now', async () => {
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  const { mergeIn, read, reset } = await import('../frontend/th/data/store.js');
  assert.match(KEY, /^th\.p\./, 'signing out clears it');
  const b = empty(0);
  add(b, '2026-11-21', 'guitar', 0, 4000);
  mergeIn(b, at(2026, 11, 21, 9));
  mergeIn(b, at(2026, 11, 21, 9));
  assert.deepEqual(read(at(2026, 11, 21, 9)).days['2026-11-21'].guitar, [8000, 0, 0]);
  reset(at(2026, 11, 21, 10));
  assert.deepEqual(read(), empty(at(2026, 11, 21, 10)));
  delete globalThis.localStorage;
});

test('sizes in plain words, one decimal', () => {
  assert.deepEqual([0, 20, 300, 1536, 1024 * 1024, 1024 * 1024 - 10, 5.5 * 1024 ** 3].map(words), ['0 KB', '0.1 KB', '0.3 KB', '1.5 KB', '1.0 MB', '1.0 MB', '5.5 GB'].map((w) => w.replace(' ', '\u00a0')), 'the number and its unit never part');
});

test('a worker counts an answer by its headers and posts it to a page that said hello', async () => {
  const posted = [], listeners = {};
  const page = { id: 'page-1', postMessage: (m) => posted.push(m) };
  const self = {
    navigator: { connection: { type: 'cellular' } },
    clients: { get: async (id) => (id === 'page-1' ? page : null), matchAll: async () => [page] },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  self.self = self;
  runInNewContext(await readFile(new URL('../frontend/th/data/worker.js', import.meta.url), 'utf8'), { self, Date, Map, Set, Number, String, URL, Promise });
  const res = (status, h = {}, type = 'cors') => ({ status, type, headers: { get: (k) => h[k] ?? null } });
  let waits = [];
  listeners.message({ data: { type: 'th-data-hello' }, source: { id: 'page-1' }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  self.thData.count('music.songs', res(206, { 'Content-Length': '1000', 'Content-Range': 'bytes 0-999/50000' }), 'page-1');
  self.thData.count('music.rest', res(304));
  self.thData.count('podcasts', res(200, {}, 'opaque'));
  self.thData.count('podcasts', res(200));
  await new Promise((r) => setTimeout(r, 10));
  const items = posted.flatMap((m) => m.items);
  assert.deepEqual(items.map((i) => [i.id, i.bytes, i.net]), [['music.songs', 1300, 1], ['music.rest', 300, 1]]);
  assert.equal(posted.reduce((n, m) => n + m.unsized, 0), 2, 'answers with no size are said, not guessed');
  assert.ok(posted.every((m) => m.type === 'th-data'));
  assert.deepEqual(['/precache.json', '/apps/photos/main.js', '/vendor/pdfjs-6.4.299/pdf.mjs', '/ui/theme.js'].map(self.thData.partOf), ['updates', 'photos', 'study', 'home']);
});

test('an answer with no size (the streamed, compressed catalogue) is counted by the bytes read, as they pass', async () => {
  const posted = [];
  const page = { id: 'page-1', postMessage: (m) => posted.push(m) };
  const self = { navigator: { connection: { type: 'wifi' } }, clients: { get: async () => page, matchAll: async () => [page] }, addEventListener() {} };
  self.self = self;
  runInNewContext(await readFile(new URL('../frontend/th/data/worker.js', import.meta.url), 'utf8'), { self, Date, Map, Set, Number, String, URL, Promise, Response, TransformStream });
  const chunks = [new Uint8Array(200_000), new Uint8Array(200_000), new Uint8Array(1234)];
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { if (pulled < chunks.length) c.enqueue(chunks[pulled++]); else c.close(); } });
  const raw = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"v7"' } });
  const r = self.thData.read('music.catalog', raw, 'page-1');
  assert.notEqual(r, raw, 'a counted answer in its place');
  assert.deepEqual([r.status, r.headers.get('ETag')], [200, '"v7"']);
  assert.equal((await r.arrayBuffer()).byteLength, 401_234, 'the same body, whole');
  await new Promise((res) => setTimeout(res, 10));
  const items = posted.flatMap((m) => m.items);
  assert.ok(items.every((i) => i.id === 'music.catalog' && i.net === 0));
  assert.equal(items.reduce((n, i) => n + i.bytes, 0), 401_234 + HEADERS, 'every byte read, plus its headers');
  assert.equal(posted.reduce((n, m) => n + m.unsized, 0), 0, 'not an answer without a size any more');
  // An answer whose headers say its size is counted by them and handed back as it is.
  const sized = new Response(new Uint8Array(10), { status: 200, headers: { 'Content-Length': '10' } });
  assert.equal(self.thData.read('music.rest', sized), sized);
});

test('Music’s worker counts the files it fetches for its release and its own files, as App files; the catalogue as Catalogue', async () => {
  const sw = await readFile(new URL('../frontend/music/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const own = \(req, init\) => fetch\(req, init\)\.then\(r => \{ self\.thData\?\.count\('music\.app', r\); return r; \}\);/);
  assert.match(sw, /thMusicRelease\?\.make\(\{ fetch: own, caches \}\)/, 'release.js fetches through it');
  assert.equal((sw.match(/own\(req\)/g) ?? []).length, 2, 'and the files it fetches network first, or when the release gives none');
  const bridge = await readFile(new URL('../frontend/th/music/bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /measured\(await upstream\(`\$\{base\}\/v1\/music\/catalog/, 'the catalogue is measured by the bytes read');
  assert.match(bridge, /'music\.catalog'/);
});

test('Settings’ search finds Data use by the words people use', () => {
  for (const q of ['data', 'usage', 'mobile data', 'wifi', 'megabytes', 'data use']) assert.ok(find(q).some((e) => e.page === 'data' && !e.focus), q);
});

test('nothing in the meter sends anything off the phone', async () => {
  const dir = new URL('../frontend/th/data/', import.meta.url);
  const files = [...(await readdir(dir)).map((f) => new URL(f, dir)), new URL('../frontend/apps/settings/data.js', import.meta.url)];
  assert.ok(files.length >= 5);
  for (const f of files) {
    const code = (await readFile(f, 'utf8')).replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\/th\/(api|client)\.js|https?:\/\//, `${f.pathname.split('/frontend/')[1]} sends nothing`);
  }
});
