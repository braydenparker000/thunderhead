// Music's streaming path, one song's reader (frontend/th/music/stream/track.js; MUSIC.md §5, §6.2)
// against a fake bucket: Range requests read as their bytes arrive, a seek that bisects the file on
// granule positions and lands on the right page in a few requests, an expired link signed again
// once, failures that may pass tried again from the byte reached, and the rest refused with a code.
// Node only, no network: the fetch is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OggError, OggOpusDemuxer, readPage } from '../frontend/th/music/stream/ogg.js';
import { PREROLL, StreamError, TrackReader } from '../frontend/th/music/stream/track.js';
import { APPEND_MIN, CHUNK_FIRST, CHUNK_MAX, CHUNK_MIN, CLUSTER_MAX, appendRoom, nextFetch } from '../frontend/th/music/stream/plan.js';
import { TONE, longTone } from './fixtures/ogg-make.mjs';

const URL1 = 'https://bucket.example.test/audio/a.opus?sig=1';

/** A bucket answering Range requests on `bytes` in pieces of `piece`; `script` overrides answers in turn. */
function bucket(bytes, { piece = 1500, script = /** @type {((a: number, b: number) => Response | Error | null)[]} */ ([]) } = {}) {
  const log = [];
  const fetch = async (url, init) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), bytes.length - 1);
    log.push({ url, a, b: Number(m[2]) });
    const s = script.shift()?.(a, b);
    if (s instanceof Error) throw s;
    if (s) return s;
    if (a >= bytes.length) return new Response(null, { status: 416 });
    const data = bytes.slice(a, b + 1);
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += piece) c.enqueue(data.slice(i, i + piece));
        c.close();
      },
    });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${bytes.length}` } });
  };
  return { fetch, log };
}

const signal = () => new AbortController().signal;
const noSleep = async () => {};

async function readAll(reader, n = 32 * 1024) {
  const out = [];
  while (!reader.done) await reader.fill(n, () => out.push(...reader.take(Infinity)), signal());
  return out.concat(reader.take(Infinity));
}

test('a song read in Range requests: packets as the bytes arrive, its end found, nothing asked twice', async () => {
  const { fetch, log } = bucket(TONE);
  const reader = new TrackReader({ url: () => URL1 }, { fetch });
  let calls = 0;
  await reader.fill(4096, () => calls++, signal());
  assert.ok(reader.head && calls > 0, 'packets come while the first request is still arriving');
  assert.equal(reader.size, TONE.length, 'the size from Content-Range');
  const packets = reader.take(Infinity).concat(await readAll(reader, 4096));
  const direct = new OggOpusDemuxer().push(TONE, { last: true }).packets;
  assert.deepEqual(packets.map((p) => [p.start, p.samples, p.discard]), direct.map((p) => [p.start, p.samples, p.discard]));
  assert.equal(reader.endGranule, 144312);
  assert.equal(reader.origin, 0);
  assert.equal(reader.audioStart, 137);
  for (let i = 1; i < log.length; i++) assert.equal(log[i].a, log[i - 1].b + 1, 'each request starts where the last ended');
  assert.ok(log.every((r) => r.b - r.a < 4096));
});

test('seeking bisects on granules: the last page ending before the target less 80 ms, in a few requests', async () => {
  const bytes = longTone(20); // 60 s
  const pages = [];
  for (let at = 0; at < bytes.length; ) {
    const p = readPage(bytes, at);
    pages.push({ at, granule: p.granule });
    at += p.size;
  }
  const { fetch, log } = bucket(bytes);
  const reader = new TrackReader({ url: () => URL1, durationMs: 60_000, bytes: bytes.length }, { fetch });
  await reader.fill(16 * 1024, () => {}, signal());
  for (const s of [0.05, 1, 7.3, 30, 45.5, 59.9]) {
    const granule = reader.origin + 312 + Math.round(s * 48000);
    log.length = 0;
    await reader.seek(granule, signal());
    const audio = pages.filter((p) => p.at >= reader.audioStart);
    // No page ends early enough (the target is inside the first page): the first audio page.
    const expected = (audio.filter((p) => p.granule <= granule - PREROLL).at(-1) ?? { at: reader.audioStart }).at;
    assert.equal(reader.pos, expected, `seek to ${s} s`);
    assert.ok(log.length <= 8, `${log.length} requests to seek to ${s} s`);
    const got = [];
    while (!got.length) await reader.fill(8192, () => got.push(...reader.take(Infinity)), signal());
    assert.ok(got[0].start <= Math.max(reader.origin, granule - PREROLL), 'decoding starts at least 80 ms before the target (or at the start)');
    assert.ok(got[0].start > granule - PREROLL - 2 * 48000, 'and not much more than a page before it');
  }
  // Without the catalog's figures it still lands, from the bytes read so far.
  const plain = new TrackReader({ url: () => URL1 }, { fetch: bucket(bytes).fetch });
  await plain.fill(16 * 1024, () => {}, signal());
  await plain.seek(312 + 40 * 48000, signal());
  assert.equal(plain.pos, pages.filter((p) => p.at >= plain.audioStart && p.granule <= 312 + 40 * 48000 - PREROLL).at(-1).at);
});

test('an expired link is signed again once; failures that may pass are tried again, from the byte reached', async () => {
  const fresh = [];
  const status = (s) => () => new Response('x', { status: s });
  // 403 then fine: one fresh link.
  let b = bucket(TONE, { script: [status(403)] });
  let reader = new TrackReader({ url: (f) => (fresh.push(Boolean(f)), URL1) }, { fetch: b.fetch, sleep: noSleep });
  await readAll(reader);
  assert.deepEqual(fresh.slice(0, 2), [false, true]);
  // 403 twice: the bucket really refuses.
  b = bucket(TONE, { script: [status(403), status(403)] });
  reader = new TrackReader({ url: () => URL1 }, { fetch: b.fetch, sleep: noSleep });
  await assert.rejects(readAll(reader), (e) => e instanceof StreamError && e.code === 'http-403');
  // 503, then the network down, then a body cut off mid-way: tried again each time, nothing lost.
  const retries = [];
  const cut = (a, end) => {
    const data = TONE.slice(a, a + 3000);
    let sent = false;
    const body = new ReadableStream({ pull: (c) => (sent ? c.error(new TypeError('network')) : ((sent = true), c.enqueue(data))) });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${a}-${end}/${TONE.length}` } });
  };
  b = bucket(TONE, { script: [status(503), () => new TypeError('failed to fetch'), cut] });
  reader = new TrackReader({ url: () => URL1 }, { fetch: b.fetch, sleep: noSleep, onRetry: (code, n) => retries.push([code, n]) });
  const packets = await readAll(reader);
  assert.deepEqual(retries, [['http-503', 1], ['network', 2], ['network', 1]], 'the cut body made progress, so its count starts over');
  assert.equal(b.log[3].a, 3000, 'asked again from the byte reached');
  assert.equal(packets.length, 151);
  // Four failures in a row: given up.
  b = bucket(TONE, { script: Array(5).fill(status(500)) });
  reader = new TrackReader({ url: () => URL1 }, { fetch: b.fetch, sleep: noSleep });
  await assert.rejects(readAll(reader), (e) => e.code === 'http-500');
});

test('what can’t pass is refused with a code: 404, no Range support past the start, corrupt pages', async () => {
  let reader = new TrackReader({ url: () => URL1 }, { fetch: bucket(TONE, { script: [() => new Response('', { status: 404 })] }).fetch });
  await assert.rejects(readAll(reader), (e) => e instanceof StreamError && e.code === 'http-404');
  // A server that ignores Range: fine from byte 0 (the whole file comes), refused anywhere else.
  const whole = () => new Response(TONE.slice(), { status: 200, headers: { 'content-length': String(TONE.length) } });
  reader = new TrackReader({ url: () => URL1 }, { fetch: bucket(TONE, { script: [whole] }).fetch });
  assert.equal((await readAll(reader)).length, 151);
  reader = new TrackReader({ url: () => URL1 }, { fetch: bucket(TONE, { script: [null, whole] }).fetch });
  await assert.rejects(readAll(reader, 4096), (e) => e.code === 'no-range');
  const bad = TONE.slice();
  bad[9000] ^= 1;
  reader = new TrackReader({ url: () => URL1 }, { fetch: bucket(bad).fetch });
  await assert.rejects(readAll(reader), (e) => e instanceof OggError && e.code === 'ogg-crc');
  reader = new TrackReader({ url: () => Promise.reject(new Error('signed out')) }, { fetch: bucket(TONE).fetch });
  await assert.rejects(readAll(reader), (e) => e.code === 'sign');
});

test('the cap’s decisions: fetch to 15 s, wait until under 10 s, append in steps under the cap', () => {
  const bps = 20_000; // 160 kb/s
  // The first request of a song, then requests sized to the room left (32–128 KB).
  assert.deepEqual(nextFetch({ ahead: 0, queued: 0, full: false, bytesPerSecond: bps, head: false }), { bytes: CHUNK_FIRST, full: false });
  assert.deepEqual(nextFetch({ ahead: 0, queued: 0, full: false, bytesPerSecond: bps, head: true }), { bytes: CHUNK_MAX, full: false });
  assert.deepEqual(nextFetch({ ahead: 13, queued: 1, full: false, bytesPerSecond: bps, head: true }), { bytes: CHUNK_MIN, full: false }, '1 s of room: the smallest request');
  assert.deepEqual(nextFetch({ ahead: 9, queued: 1, full: false, bytesPerSecond: bps, head: true }), { bytes: 5 * bps, full: false });
  // At the cap (bytes read but not yet appended count): stop, and stay stopped until under 10 s.
  assert.deepEqual(nextFetch({ ahead: 13, queued: 2, full: false, bytesPerSecond: bps, head: true }), { bytes: 0, full: true });
  assert.deepEqual(nextFetch({ ahead: 12, queued: 0, full: true, bytesPerSecond: bps, head: true }), { bytes: 0, full: true });
  assert.deepEqual(nextFetch({ ahead: 9.9, queued: 0, full: true, bytesPerSecond: bps, head: true }), { bytes: 102_000, full: false });
  // Appends: everything up to the cap at the start, then steps of at least 2 s, unless the song's rest fits.
  const at = (s) => Math.round(s * 48000);
  assert.equal(appendRoom({ now: 0, appended: 0, done: false, queued: at(30) }), CLUSTER_MAX);
  assert.equal(appendRoom({ now: 10, appended: at(23), done: false, queued: at(5) }), APPEND_MIN);
  assert.equal(appendRoom({ now: 10, appended: at(24), done: false, queued: at(5) }), 0, '1 s of room: wait for 2');
  assert.equal(appendRoom({ now: 10, appended: at(24), done: true, queued: at(0.5) }), at(1), 'the song’s last half second goes now');
  assert.equal(appendRoom({ now: 10, appended: at(25.5), done: false, queued: at(5) }), 0, 'never past the cap');
  assert.equal(appendRoom({ now: 10, appended: at(11.5), done: false, queued: at(5), capS: 3 }), at(1.5), '2 s or less buffered: no minimum step');
  assert.equal(appendRoom({ now: 10, appended: at(11), done: false, queued: at(9) }), CLUSTER_MAX, 'one Cluster at a time');
});
