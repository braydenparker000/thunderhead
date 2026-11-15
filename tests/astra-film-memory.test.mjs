// A film remembered (film-memory.js): what describing a film read is kept by its size and the hash of its first
// 64 KiB, and the next open answers those reads without the network; a damaged entry, another film of the same
// size, or storage that fails changes nothing but the cost. Also: the first part of a block a seek began inside
// is fetched on the side once a subtitle scanner wants whole blocks (side-read.js). Invented host, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';
import { MEMORY } from '../frontend/astra/src/engine/film-memory.js';

const SIZE = 8 * BLOCK, INDEX = SIZE - 300_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A host for a film whose bytes depend on `seed`; requests are in `calls`. */
function host(seed = 1) {
  const calls = [], byteAt = (o) => (o * 7 + seed * 31 + (o >> 16)) & 255;
  const fetchFn = async (url, { headers, signal }) => {
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(headers.Range);
    const from = +a, to = b ? +b + 1 : SIZE;
    calls.push(from);
    let at = from;
    const body = new ReadableStream({
      async pull(c) {
        await sleep(1);
        if (signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
        if (at >= to) return c.close();
        const piece = new Uint8Array(Math.min(64 << 10, to - at));
        for (let i = 0; i < piece.length; i++) piece[i] = byteAt(at + i);
        at += piece.length; c.enqueue(piece);
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${SIZE}` } });
  };
  return { calls, fetchFn, byteAt };
}

/** A store in memory with the IndexedDB store's calls; `fail` makes every call reject. */
function store() {
  const films = new Map();
  return {
    films, fail: false,
    async get(key) { if (this.fail) throw Error('quota'); return films.get(key) ?? null; },
    async put(entry) { if (this.fail) throw Error('quota'); films.set(entry.key, structuredClone(entry)); },
    async drop(key) { films.delete(key); },
  };
}

/** Describes the film the way the probe does: the header, the first 64 KiB, the index near the end. */
async function describe(h, memory) {
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory, connection: null });
  source.probing = true;
  await source.open();
  const parts = [await source.read(0, 800), await source.read(0, 65536), await source.read(INDEX, INDEX + 16), await source.read(INDEX + 16, INDEX + 2000)];
  source.learn(100);
  source.doneProbing();
  await sleep(30); // the entry is written in the background
  return { source, parts };
}
const right = (h, bytes, start) => bytes.every((b, i) => b === h.byteAt(start + i));

test('a film opened again: its index comes from memory, not from the end of the file', async () => {
  const memory = store(), h = host();
  const first = await describe(h, memory);
  assert.ok(first.parts.every((p, i) => right(h, p, [0, 0, INDEX, INDEX + 16][i])));
  assert.ok(h.calls.includes(INDEX), 'the first time, the index is fetched');
  first.source.close();
  assert.equal(memory.films.size, 1);
  const [entry] = memory.films.values();
  assert.match(entry.key, new RegExp(`^${SIZE}:[0-9a-f]{64}$`), 'known by size and hash, not by address');
  assert.ok(!JSON.stringify(Object.keys(entry)).includes('url'));
  assert.deepEqual(entry.ranges.map((r) => [r.start, r.bytes.length]), [[INDEX, 2000]], 'the first 64 KiB are not kept: they are always read');
  h.calls.length = 0;
  const again = await describe(h, memory);
  assert.ok(again.parts.every((p, i) => right(h, p, [0, 0, INDEX, INDEX + 16][i])));
  assert.deepEqual(h.calls, [0], 'only the first request: the index came from memory');
  again.source.close();
});

test('a damaged entry, or another film of the same size, is not used; a damaged one is replaced', async () => {
  const memory = store(), h = host();
  (await describe(h, memory)).source.close();
  const [entry] = memory.films.values();
  entry.ranges[0].bytes[5] ^= 0xff; // a byte gone wrong on the disk
  h.calls.length = 0;
  const after = await describe(h, memory);
  assert.ok(after.parts.every((p, i) => right(h, p, [0, 0, INDEX, INDEX + 16][i])), 'the damaged bytes were not handed out');
  assert.ok(h.calls.includes(INDEX), 'the index was fetched again');
  after.source.close();
  assert.ok(right(h, [...memory.films.values()][0].ranges[0].bytes, INDEX), 'and the entry was written afresh');
  const other = host(2); // same size, other first bytes
  const twin = await describe(other, memory);
  assert.ok(twin.parts.every((p, i) => right(other, p, [0, 0, INDEX, INDEX + 16][i])));
  assert.ok(other.calls.includes(INDEX));
  twin.source.close();
  assert.equal(memory.films.size, 2);
});

test('storage that fails, or answers too slowly, changes nothing but the cost', async () => {
  const memory = store(), h = host();
  memory.fail = true;
  const failing = await describe(h, memory);
  assert.ok(failing.parts.every((p, i) => right(h, p, [0, 0, INDEX, INDEX + 16][i])));
  failing.source.close();
  const saved = MEMORY.wait;
  MEMORY.wait = 20;
  const slow = { get: () => new Promise(() => {}), put: async () => {}, drop: async () => {} };
  const waiting = await describe(h, slow);
  assert.ok(waiting.parts.every((p, i) => right(h, p, [0, 0, INDEX, INDEX + 16][i])));
  waiting.source.close();
  MEMORY.wait = saved;
});

test('a block a seek began inside is made whole on the side once a subtitle scanner looks at blocks', async () => {
  const saved = TIMING.hole;
  TIMING.hole = 20;
  const h = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory: null, connection: null });
  await source.open();
  await source.read(0, 16);
  const seen = [];
  source.onBlock((i) => seen.push(i));
  const at = 4 * BLOCK + 600_000;
  await source.read(at, at + 10);
  await source.read(5 * BLOCK + 10, 5 * BLOCK + 20); // the download has finished the block it began inside
  await sleep(150);
  assert.ok(seen.includes(4), 'the block landed whole');
  assert.ok(right(h, source.peek(4 * BLOCK, 5 * BLOCK), 4 * BLOCK));
  source.close();
  TIMING.hole = saved;
});
