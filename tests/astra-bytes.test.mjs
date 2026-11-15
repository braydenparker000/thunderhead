// Astra's range reader at its best (http-source.js, source-blocks.js, source-tuning.js, side-read.js): reads
// answered as their bytes arrive, downloads that stop where describing the file stopped asking, a reach and a
// cache sized by the film's bitrate, side reads that leave playback's downloads alone, and downloads asked
// again at once when the network changes. Against an invented host, no network.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';
import { saverTuning } from '../frontend/astra/src/engine/player-data.js';
import { TAIL } from '../frontend/astra/src/engine/source-tail.js';
import { GAP, REUSE_WINDOW, SOON, soon } from '../frontend/astra/src/engine/source-stream.js';
import { until } from './fixtures/waits.mjs';

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
  // The first download stops by itself and the tail arrives: waited for (a fixed 150 ms was too short on a busy machine).
  await until(() => source.streams.size === 0 && !source.tail, { timeout: 10_000, message: 'the first download stopped and the tail arrived' });
  assert.equal(source.streams.size, 0, 'the first download stopped');
  // Besides it, the film's last 256 KiB were asked for at once (source-tail.js).
  const first = h.calls.find((c) => c.from === 0).sent;
  assert.ok(first <= 65536 + (64 << 10) + (64 << 10), `it brought ${first} bytes`);
  assert.equal(source.bytesFetched, first + TAIL, 'the tail is counted in what the film cost');
  const far = SIZE - 40_000;
  assert.ok(same(await source.read(far, far + 1300), far));
  assert.equal(h.calls.length, 2, 'the index near the end is answered from the tail: no request of its own');
  const deeper = SIZE - 2 * BLOCK; // an index outside the tail costs what it did: a request from its own byte
  assert.ok(same(await source.read(deeper, deeper + 1300), deeper));
  assert.equal(h.calls.at(-1).from, deeper);
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
  source.learn(201.3); // a bitrate that does not divide (about 3.2 MiB in 10 s): a range request names whole bytes
  assert.ok(Number.isInteger(source.reach()), `a whole number of bytes (${source.reach()})`);
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

test('a download asks for its reach in parts, so a seek or a stop throws away little that was sent', async () => {
  const { source, calls } = await open({ pace: 0 });
  source.learn(SIZE / (BLOCK / 4)); // 10 s is 2.5 MiB
  await source.read(0, 16);
  await settle(source);
  const reached = source.cachedUntil(0);
  assert.ok(reached >= 2.5 * BLOCK && reached < 3 * BLOCK, `the first answer was left near the reach (${reached})`);
  assert.equal(calls.length, 1, 'nothing asked yet past it');
  const want = 2 * BLOCK + 16;
  await source.read(2 * BLOCK, want);
  await settle(source);
  assert.deepEqual([calls[1].from, calls[1].to], [reached, want + 2.5 * BLOCK], 'the next part: from where it stopped to the new reach');
  assert.equal(source.bytesFetched, want + 2.5 * BLOCK, 'and only that was sent');
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

test('a read ahead of a download waits for it only when it will get there within about a second, at its own speed', () => {
  const at = 1e12, playing = { probing: false };
  const run = (received, ms, more = {}) => soon(playing, { received, since: at - ms, ran: 0, paused: false, ...more }, at);
  assert.equal(SOON, 1000);
  assert.equal(run(500_000, 1000), 500_000, 'half a megabyte a second: half a megabyte ahead is waited for');
  assert.equal(run(375_000, 3000), GAP, 'a slow link: only what is just past it (the demuxer walking forward)');
  assert.equal(run(64 * BLOCK, 1000), REUSE_WINDOW, 'a fast one: never further than the old window');
  assert.equal(run(1_000_000, 500, { ran: 1500, paused: true }), Math.floor(1_000_000 / 1.5), 'a pause is not counted as running time');
  assert.equal(run(1_000_000, 500, { ran: 1500 }), 500_000, 'the time since it read on again is');
  assert.equal(run(0, 200), REUSE_WINDOW, 'a download just begun, with no measure yet, is waited for (and weighed again as blocks land)');
  assert.equal(run(30_000, 2000), GAP, 'one that has run a while and brought next to nothing: not worth waiting for');
  assert.equal(soon({ probing: true }, { received: 64 * BLOCK, since: at - 1000, ran: 0 }, at), GAP, 'while the file is described, reads stay close');
});

test('a read far ahead of a slow download asks for its own bytes; one just past it waits (on a fake clock)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1e12 }); // the host's pacing runs on real timers; the downloads' speed is read off this clock
  try {
    const { source, calls } = await open({ pace: 20 });
    await source.read(0, 16);
    const stream = [...source.streams][0];
    while (stream.received < 256 << 10) await sleep(10);
    // No time has passed on the clock: the download looks as fast as can be, and a read 3 MiB ahead waits for it.
    const near = stream.at + 3 * BLOCK;
    const a = source.read(near, near + 10);
    await Promise.resolve();
    assert.equal(calls.length, 1, 'waited for the running download');
    assert.ok(same(await a, near));
    // A minute on: what it brought over a minute is a slow link's worth.
    mock.timers.tick(60_000);
    assert.equal(soon(source, stream), GAP);
    const past = stream.at + 100_000, far = Math.ceil((stream.at + 4 * BLOCK) / BLOCK) * BLOCK + 1000;
    const b = source.read(past, past + 10);
    await Promise.resolve();
    assert.equal(calls.length, 1, 'a read just past the download waits for it: no request per read');
    const c = source.read(far, far + 10);
    await Promise.resolve();
    assert.equal(calls.length, 2, 'a read four megabytes on asks for its own bytes');
    assert.equal(calls[1].from, far - 1000, 'from the start of its block (a little before the byte, as before)');
    assert.ok(same(await b, past) && same(await c, far));
    source.close();
  } finally { mock.timers.reset(); }
});
