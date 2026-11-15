// Astra's range reader at its best (http-source.js, source-blocks.js, source-tuning.js, side-read.js): reads
// answered as their bytes arrive, downloads that stop where describing the file stopped asking, a reach and a
// cache sized by the film's bitrate, side reads that leave playback's downloads alone, and downloads asked
// again at once when the network changes. Against an invented host, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';
import { saverTuning } from '../frontend/astra/src/engine/player-data.js';

const SIZE = 64 * BLOCK;
const byteAt = (offset) => (offset * 11 + (offset >> 18)) & 255;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A host that honours ranges (bounded ones too) and sends 64 KiB every `pace` ms. `silent(call)` true: the
 * answer sends one piece and then nothing, as a connection on a network that is gone. Requests are in `calls`.
 */
export function host({ pace = 2, silent = () => false, status = 206 } = {}) {
  const calls = [];
  const fetchFn = async (url, { headers, signal }) => {
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(headers.Range);
    const from = +a, to = b ? +b + 1 : SIZE, call = { from, to, sent: 0 };
    calls.push(call);
    if (status !== 206) return new Response(null, { status });
    const quiet = silent(call);
    let at = from;
    const body = new ReadableStream({
      async pull(c) {
        if (quiet && at > from) await new Promise((r) => signal?.addEventListener('abort', r, { once: true }));
        await sleep(pace);
        if (signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
        if (at >= to) return c.close();
        const piece = new Uint8Array(Math.min(64 << 10, to - at));
        for (let i = 0; i < piece.length; i++) piece[i] = byteAt(at + i);
        at += piece.length; call.sent += piece.length;
        c.enqueue(piece);
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${SIZE}`, 'content-length': String(to - from) } });
  };
  return { calls, fetchFn };
}
const same = (bytes, start) => bytes.length > 0 && bytes.every((b, i) => b === byteAt(start + i));
const open = async (options = {}) => { const h = host(options); const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory: null, connection: null }); await source.open(); return { ...h, source }; };
const settle = async (source) => { let last = -1; while (source.bytesFetched !== last) { last = source.bytesFetched; await sleep(40); } return last; };

test('a small read is answered as its bytes arrive, not when its megabyte block is whole', async () => {
  const { source } = await open({ pace: 15 });
  const bytes = await source.read(0, 20_000);
  assert.ok(same(bytes, 0));
  assert.ok(source.bytesFetched < BLOCK / 4, `answered after ${source.bytesFetched} bytes`);
  // What was handed out of a block still arriving stays right once the block is whole and has left the cache.
  const early = await source.read(100_000, 140_000);
  await source.read(BLOCK + 10, BLOCK + 20);
  source.blocks.clear();
  assert.ok(same(early, 100_000), 'a view of a filling block stays valid');
  assert.ok(same(source.peek(BLOCK + 10, BLOCK + 20), BLOCK + 10), 'peek answers from a block still arriving too');
  assert.equal(source.peek(30 * BLOCK, 30 * BLOCK + 4), null);
  source.close();
});

test('a read far inside a block is fetched from its own byte, not from the block’s start', async () => {
  const { source, calls } = await open({ pace: 15 });
  await source.read(0, 16);
  const at = 20 * BLOCK + 700_000;
  assert.ok(same(await source.read(at, at + 5000), at));
  assert.equal(calls.at(-1).from, at);
  assert.ok(calls.at(-1).sent < 300_000, 'the bytes before it were not fetched first');
  // Reading across the block's edge goes on with the same download.
  assert.ok(same(await source.read(21 * BLOCK - 10, 21 * BLOCK + 10), 21 * BLOCK - 10));
  assert.equal(calls.length, 2);
  source.close();
});

test('while the file is described, a download stops a little past the last byte asked of it, and is continued after', async () => {
  const h = host({ pace: 1 });
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory: null, connection: null });
  source.probing = true;
  await source.open();
  await source.read(0, 761);
  await source.read(0, 65536);
  await sleep(150);
  assert.equal(source.streams.size, 0, 'the first download stopped');
  assert.ok(source.bytesFetched <= 65536 + (64 << 10) + (64 << 10), `it brought ${source.bytesFetched} bytes`);
  const far = SIZE - 90_000;
  assert.ok(same(await source.read(far, far + 1300), far));
  assert.equal(h.calls.at(-1).from, far, 'the index near the end is asked for from its own byte');
  source.learn(400);
  source.doneProbing();
  // Playback from the start goes on from the byte the first download reached.
  const reached = source.cachedUntil(0);
  assert.ok(same(await source.read(reached - 10, reached + 10), reached - 10));
  assert.equal(h.calls.at(-1).from, reached);
  source.close();
});

test('the reach follows the film’s bitrate: 10 s of it (5 with the saver), never under 2 MiB nor over the limit', async () => {
  const { source } = await open({ pace: 0 });
  assert.equal(source.reach(), 24 * BLOCK, 'before the bitrate is known: the limit');
  source.learn(SIZE / (BLOCK / 4)); // a quarter of a megabyte a second: 10 s is 2.5 MiB
  assert.equal(source.reach(), 2.5 * BLOCK);
  await source.read(0, 16);
  const fetched = await settle(source);
  assert.ok(fetched >= 2.5 * BLOCK && fetched <= 4 * BLOCK, `about 2.5 MiB read ahead (${(fetched / BLOCK).toFixed(2)})`);
  const saver = saverTuning(true);
  source.setReadAhead(saver.readAhead, saver);
  assert.equal(source.reach(), 2 * BLOCK, '5 s is 1.25 MiB: never under 2 MiB');
  source.learn(SIZE / (4 * BLOCK)); // 4 MiB a second
  assert.equal(source.reach(), 8 * BLOCK, '20 MiB, held to the saver’s 8');
  const full = saverTuning(false);
  source.setReadAhead(full.readAhead, full);
  assert.equal(source.reach(), 24 * BLOCK, '40 MiB, held to 24');
  source.close();
});

test('the cache keeps a 30 s back-seek and the read-ahead at the film’s bitrate, between 16 and 96 MiB', async () => {
  const { source } = await open({ pace: 0 });
  assert.equal(source.maxBlocks, 96);
  source.learn(SIZE / (BLOCK / 8)); // 1 Mbit/s: 16 MiB, the least
  assert.equal(source.maxBlocks, 16);
  source.learn(SIZE / (BLOCK / 2)); // 4 Mbit/s: (80 s + 10 s) of half a megabyte
  assert.equal(source.maxBlocks, 45);
  const saver = saverTuning(true);
  source.setReadAhead(saver.readAhead, saver);
  assert.equal(source.maxBlocks, 30, 'with the saver: (55 s + 5 s)');
  source.learn(SIZE / (4 * BLOCK)); // 32 Mbit/s: the most
  source.setReadAhead(24 * BLOCK, saverTuning(false));
  assert.equal(source.maxBlocks, 96);
  source.close();
});

test('a side read is one bounded request of its own: playback’s download goes on untouched', async () => {
  const { source, calls } = await open({ pace: 3 });
  await source.read(0, 16);
  const before = source.bytesFetched, stream = [...source.streams][0];
  const at = 40 * BLOCK + 123;
  const bytes = await source.sideRead(at, at + 100_000);
  assert.ok(same(bytes, at) && bytes.length === 100_000);
  assert.deepEqual([calls.at(-1).from, calls.at(-1).to], [at, at + 100_000]);
  assert.equal(source.streams.size, 1); assert.ok(source.streams.has(stream), 'the download was not ended or replaced');
  assert.ok(source.bytesFetched - before >= 100_000, 'its bytes count in what the film cost');
  assert.equal(source.peek(at, at + 10), null, 'and it left nothing in the cache');
  const controller = new AbortController();
  const ended = source.sideRead(50 * BLOCK, 51 * BLOCK, { signal: controller.signal });
  controller.abort();
  await assert.rejects(ended, (e) => e.kind === 'closed');
  source.close();
  const gone = new HttpSource('https://files.example/film.mkv', { fetchFn: host({ status: 404 }).fetchFn, memory: null, connection: null });
  gone.size = SIZE;
  await assert.rejects(gone.sideRead(0, 10), (e) => e.kind === 'gone');
});

test('when the network changes, a download that has brought nothing for a while is asked again at once', async () => {
  const saved = { ...TIMING };
  Object.assign(TIMING, { quiet: 60 });
  const connection = new EventTarget();
  let n = 0;
  const h = host({ pace: 1, silent: (call) => call.from > 0 && n++ === 0 }); // the first download elsewhere goes silent
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory: null, connection });
  await source.open();
  await source.read(0, 16);
  const at = 30 * BLOCK;
  const reading = source.read(at + 200_000, at + 200_010);
  await sleep(150);
  assert.equal(h.calls.length, 2, 'the silent download is still waited on');
  connection.dispatchEvent(new Event('change'));
  assert.ok(same(await reading, at + 200_000));
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].from, at + (64 << 10), 'asked again from the byte it reached');
  assert.equal(source.failures, 0, 'no failure counted');
  source.close();
  Object.assign(TIMING, saved);
});
