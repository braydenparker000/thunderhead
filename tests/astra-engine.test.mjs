// Astra's playback engine, the parts that need no browser: the range reader against invented hosts
// that cut, stall, answer with nothing or move (http-source.js, source-stream.js); reading a file's
// header without trusting its sizes (mkv.js, mkv-cluster.js, mp4.js); a film with nothing to play
// (plan.js); the stall watchdog's rules (stall-watch.js); early fragments against Mediabunny's own
// writer (early.js); and playlists served without byte ranges (probe.js). Hosts are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';
import { readLayout, subtitleTracks, uint } from '../frontend/astra/src/engine/mkv.js';
import { parseCluster, walkCluster } from '../frontend/astra/src/engine/mkv-cluster.js';
import { sampleTable } from '../frontend/astra/src/engine/mp4.js';
import { remedy } from '../frontend/astra/src/engine/stall-watch.js';
import { EarlyCuts } from '../frontend/astra/src/engine/early.js';
import { probe } from '../frontend/astra/src/engine/probe.js';
import * as MB from '../frontend/astra/vendor/mediabunny.js';

Object.assign(TIMING, { open: 400, stall: 150, keepTrying: 1500, backoff: 20 });
const SIZE = 3 * BLOCK;
const byteAt = (offset) => (offset * 13 + (offset >> 16)) & 255;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A host for the file. `answer(call)` may return 'hang' (never answers), 'empty' (206 and no body), a number of
 * bytes after which the connection is cut, or nothing (the rest of the file). Each request is kept in `calls`.
 */
function host(answer = () => {}) {
  const calls = [];
  const fetchFn = async (url, { headers = {}, signal, method }) => {
    const from = Number(/bytes=(\d+)-/.exec(headers.Range || 'bytes=0-')[1]);
    const call = { url, from, method, n: calls.length };
    calls.push(call);
    const how = answer(call);
    if (how === 'hang') return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const head = { 'content-range': `bytes ${from}-${SIZE - 1}/${SIZE}`, 'content-length': String(SIZE - from), 'content-type': 'video/x-matroska' };
    if (method === 'HEAD') return new Response(null, { status: 200, headers: head });
    let at = from;
    const until = how === 'empty' ? from : typeof how === 'number' ? Math.min(SIZE, from + how) : SIZE;
    const body = new ReadableStream({
      async pull(c) {
        await sleep(1);
        if (signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
        if (at >= until) return until < SIZE && how !== 'empty' ? c.error(new TypeError('network error')) : c.close();
        const piece = new Uint8Array(Math.min(64 << 10, until - at));
        for (let i = 0; i < piece.length; i++) piece[i] = byteAt(at + i);
        at += piece.length;
        c.enqueue(piece);
      },
    });
    return new Response(body, { status: 206, headers: head });
  };
  return { calls, fetchFn };
}
const same = (bytes, start) => bytes.every((b, i) => b === byteAt(start + i));

test('a host that cuts every connection after 150 kB: each break is continued from the byte it reached', async () => {
  const { calls, fetchFn } = host(() => 150_000);
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  const bytes = await source.read(0, 2 * BLOCK + 10);
  assert.ok(same(bytes, 0), 'the bytes are the file’s, across every cut');
  const starts = calls.slice(1).map((c) => c.from);
  assert.ok(starts.every((s, i) => s === (i + 1) * 150_000), `each request starts where the last one stopped: ${starts.slice(0, 5)}`);
  source.close();
});

test('a range answered with nothing is a failure with a pause, not a request loop', async () => {
  const { calls, fetchFn } = host((c) => (c.n === 0 ? BLOCK : 'empty'));
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  const reading = source.read(BLOCK, BLOCK + 10);
  await assert.rejects(reading, (e) => e.kind === 'network');
  assert.ok(calls.length < 20, `a minute (here 1.5 s) of retries is a handful of requests, not thousands (${calls.length})`);
  source.close();
});

test('a later range request whose answer never begins is given up on and asked again', async () => {
  const { calls, fetchFn } = host((c) => (c.n === 0 ? BLOCK : c.n === 1 ? 'hang' : undefined));
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  const bytes = await source.read(2 * BLOCK, 2 * BLOCK + 4);
  assert.ok(same(bytes, 2 * BLOCK));
  assert.ok(calls.length >= 3, 'the place the silent request was for was asked for again');
  source.close();
});

test('read-ahead that drops with nobody waiting starts no clock: a read much later gets its own minute', async () => {
  let down = false;
  const { fetchFn } = host((c) => (c.n === 0 ? BLOCK + 100 : c.n === 1 || down ? 'empty' : undefined));
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  await source.read(0, 4);
  await sleep(100); // the download broke off, and its continuation brought nothing, while nobody waited for more
  assert.equal(source.failingSince, 0, 'no clock started');
  await sleep(TIMING.keepTrying + 100);
  down = true;
  const started = Date.now();
  const late = source.read(2 * BLOCK, 2 * BLOCK + 4);
  setTimeout(() => { down = false; }, 300); // the host comes back well within the minute
  assert.ok(same(await late, 2 * BLOCK), 'served once the host is back');
  assert.ok(Date.now() - started >= 250, 'it waited rather than failing at once');
  source.close();
});

test('two downloads that fail together: both reads are served when the host comes back', async () => {
  let down = true;
  const { fetchFn } = host((c) => (c.n === 0 ? 10 : down ? 'empty' : undefined));
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  const near = source.read(BLOCK, BLOCK + 4), far = source.read(2 * BLOCK + 500_000, 2 * BLOCK + 500_004);
  setTimeout(() => { down = false; }, 200);
  assert.ok(same(await near, BLOCK));
  assert.ok(same(await far, 2 * BLOCK + 500_000));
  source.close();
});

test('a redirect target that stops working: the address given is asked again', async () => {
  const { calls, fetchFn } = host((c) => (c.n === 0 ? BLOCK : c.url.includes('signed') ? 'empty' : undefined));
  const redirected = async (url, init) => Object.defineProperty(await fetchFn(url, init), 'url', { value: url.includes('given') ? 'https://cdn.example/signed?e=1' : url });
  const source = new HttpSource('https://files.example/given.mkv', { fetchFn: redirected });
  await source.open();
  assert.equal(source.url, 'https://cdn.example/signed?e=1');
  assert.ok(same(await source.read(2 * BLOCK, 2 * BLOCK + 4), 2 * BLOCK));
  assert.ok(calls.some((c) => c.n > 0 && c.url.includes('given')), 'the original address was tried again');
  source.close();
});

test('a load ended while the file opens or is read leaves nothing downloading', async () => {
  const { fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  const controller = new AbortController();
  await source.open(controller.signal);
  const waiting = source.read(2 * BLOCK, 2 * BLOCK + 4);
  controller.abort();
  await assert.rejects(waiting, (e) => e.kind === 'closed');
  assert.equal(source.closed, true);
  assert.equal(source.streams.size, 0);
  const before = source.bytesFetched;
  await sleep(50);
  assert.equal(source.bytesFetched, before, 'nothing more arrives');
});

test('a playlist served whole (no byte ranges) or with no length still plays as HLS', async () => {
  const playlist = (status, length) => async () => new Response('#EXTM3U\n', { status, headers: { 'content-type': 'application/vnd.apple.mpegurl', ...(length ? { 'content-length': '8' } : {}) } });
  assert.equal((await probe('https://cdn.example/live/index', { fetchFn: playlist(200, true) })).adaptive, 'hls');
  assert.equal((await probe('https://cdn.example/a/master.m3u8?t=1', { fetchFn: playlist(200, true) })).adaptive, 'hls');
  assert.equal((await probe('https://cdn.example/live/index', { fetchFn: playlist(206, false) })).adaptive, 'hls');
});

test('Matroska sizes are not trusted: a child past its parent, an integer of 2^56 bytes', () => {
  assert.equal(uint(new Uint8Array(4), 0, 2 ** 56), 0, 'refused at once instead of looping');
  assert.equal(uint(new Uint8Array([1, 2]), 0, 2), 258);
  // A cluster whose timestamp claims to be 2^56 bytes long: dropped, quickly.
  const bad = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x88, 0xe7, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0x05, 0, 0, 0, 0]);
  const t = Date.now();
  assert.equal(parseCluster(bad, new Set([3]), 1e6).valid, false);
  assert.equal(walkCluster((s, e) => bad.subarray(s, e), 0, bad.length, new Set([3]), 1e6).state, 'drop');
  assert.ok(Date.now() - t < 50);
});

test('reading a cluster in place finds the same subtitle blocks as reading it whole', async () => {
  const film = new Uint8Array(readFileSync(new URL('./fixtures/astra/multi.mkv', import.meta.url)));
  const layout = await readLayout(async (s, e) => film.subarray(s, e), film.length);
  const wanted = new Set(subtitleTracks(layout).map((s) => s.number));
  let blocks = 0;
  for (const { position } of layout.cues) {
    const whole = parseCluster(film.subarray(position), wanted, layout.timestampScale);
    const walked = walkCluster((s, e) => film.subarray(s, Math.min(e, film.length)), position, film.length, wanted, layout.timestampScale);
    assert.equal(walked.length, whole.length);
    assert.deepEqual(walked.blocks.map((b) => [b.start, b.duration, [...b.data]]), whole.blocks.map((b) => [b.start, b.duration, [...b.data]]));
    blocks += walked.blocks.length;
  }
  assert.ok(blocks > 0, 'the film’s subtitles were found');
  // Bytes not cached yet: wait, rather than drop or guess.
  const first = layout.cues[0].position;
  assert.equal(walkCluster((s, e) => (e > first + 2000 ? null : film.subarray(s, e)), first, film.length, wanted, layout.timestampScale).state, 'wait');
});

test('an MP4 sample table that claims 40 million samples in 100 bytes is read in no time', () => {
  const bytes = new Uint8Array(200), view = new DataView(bytes.buffer);
  const box = (at, size, type) => { view.setUint32(at, size); for (let i = 0; i < 4; i++) bytes[at + 4 + i] = type.charCodeAt(i); };
  box(0, 200, 'stbl');
  box(8, 24, 'stts'); view.setUint32(20, 40e6); view.setUint32(24, 40e6); view.setUint32(28, 1);
  box(32, 28, 'stsc'); view.setUint32(44, 1); view.setUint32(48, 1); view.setUint32(52, 40e6);
  box(60, 20, 'stsz'); view.setUint32(72, 4); view.setUint32(76, 40e6);
  box(80, 20, 'stco'); view.setUint32(92, 40e6); view.setUint32(96, 1000);
  const t = Date.now();
  const samples = sampleTable(bytes, { start: 8, end: 200 }, 1000);
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
  assert.ok(samples.length <= 200000);
});

test('the stall watchdog: a small hole is stepped over, sound that ran out is reported, data on its way is waited for', () => {
  const kind = (over) => ({ buffered: true, next: Infinity, ended: false, readPast: true, has: () => true, ...over });
  // Sound has a hole from 10 to 11.5; the picture is there.
  assert.deepEqual(remedy({ video: kind(), audio: kind({ buffered: false, next: 11.5 }) }, 10), { seek: 11.55 });
  // The sound pipeline is still reading towards here: nothing to do.
  assert.equal(remedy({ video: kind(), audio: kind({ buffered: false, next: 11.5, readPast: false }) }, 10), null);
  // The sound ended for good at 50:00 while the picture goes on.
  assert.deepEqual(remedy({ video: kind(), audio: kind({ buffered: false, ended: true }) }, 3000), { audioEnded: true });
  // Both have run out: the stream is ended so the film can finish.
  assert.deepEqual(remedy({ video: kind({ ended: true }), audio: kind({ buffered: false, ended: true }) }, 3000), { end: true });
});

test('a key frame that repeats an earlier time begins no fragment, so later fragments keep their flags', async () => {
  const cuts = new EarlyCuts(), seen = [];
  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0, onMoof: () => seen.push(cuts.forced.shift()) }), target: new MB.NullTarget() });
  const source = new MB.EncodedVideoPacketSource('vp9');
  output.addVideoTrack(source);
  await output.start();
  const packets = [[0, 'key'], [0.04, 'delta'], [0.6, 'delta'], [0.6, 'key'], [0.64, 'delta'], [1.3, 'delta'], [1.34, 'key'], [1.38, 'delta']];
  for (const [i, [t, type]] of packets.entries()) await source.add(cuts.mark(new MB.EncodedPacket(new Uint8Array(10), type, t, 0.04)), i ? undefined : { decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 64, codedHeight: 64 } });
  await output.finalize();
  // Fragments begin at 0 (key), 0.6 (cut here), 1.3 (cut here) and 1.34 (key): each settled with its own flag.
  assert.deepEqual(seen, [false, true, true, false]);
  assert.deepEqual(cuts.forced, []);
});

test('the frame rate, from a Matroska header or an MP4 index: a number to step by, or nothing', async () => {
  const { frameRate } = await import('../frontend/astra/src/engine/probe.js');
  const film = readFileSync(new URL('./fixtures/astra/multi.mkv', import.meta.url));
  const layout = await readLayout(async (s, e) => film.subarray(s, e), film.length);
  assert.equal(frameRate(1e9 / layout.tracks.find((t) => t.type === 1).defaultDuration), 12);
  assert.equal(frameRate(1e9 / 41708333), 23.976);
  assert.equal(frameRate(30000 / 1001), 29.97);
  for (const nonsense of [null, NaN, 0, 0.2, Infinity, 1e6]) assert.equal(frameRate(nonsense), undefined, String(nonsense));
  // An MP4 (through Mediabunny, as the probe asks): the rate from the first frames' times in its index.
  const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target: new MB.BufferTarget() });
  const source = new MB.EncodedVideoPacketSource('avc');
  output.addVideoTrack(source);
  await output.start();
  const config = { codec: 'avc1.42001e', codedWidth: 16, codedHeight: 16, description: new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe0, 0]) };
  for (let i = 0; i < 60; i++) await source.add(new MB.EncodedPacket(new Uint8Array([0, 0, 0, 1, 0x65]), i % 25 ? 'delta' : 'key', i / 25, 1 / 25), i ? undefined : { decoderConfig: config });
  await output.finalize();
  const input = new MB.Input({ source: new MB.BufferSource(output.target.buffer), formats: MB.ALL_FORMATS });
  const [track] = await input.getVideoTracks();
  const m = await track.computeFrameRateMetrics({ targetPacketCount: 48 });
  assert.equal(frameRate(m.underlyingFrameRate ?? m.bestGuessFrameRate), 25);
});
