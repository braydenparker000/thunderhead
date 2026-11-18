// Seek previews' pure parts (frontend/astra/src/engine/preview.js, preview-frames.js, player-preview.js): the
// cue lookup (time → key frame's block), the key frame's bytes read with bounded side requests and checked
// against Mediabunny's own key packet, an MP4's key frame found from its sample table, the size cap (and how it
// follows a film's bitrate), the cache's order (a fetch under way finishes and is shown early, then the latest
// place) and LRU with fake reads and a fake decoder, the decoder's worker, and the switches that turn previews off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MB from '../frontend/astra/vendor/mediabunny.js';
import { readLayout } from '../frontend/astra/src/engine/mkv.js';
import { cueAt, previewsOff, PreviewCache, frameCap, PREVIEW } from '../frontend/astra/src/engine/preview.js';
import { previewDecoder, WorkerDecoder } from '../frontend/astra/src/engine/preview-decode.js';
import { mkvPlaces, mkvKeyFrame, bounded, TooLarge, findMoov, mp4Samples } from '../frontend/astra/src/engine/preview-frames.js';
import { previewMethods } from '../frontend/astra/src/engine/player-preview.js';

const film = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/astra/${name}`, import.meta.url)));
const tick = () => new Promise((r) => setTimeout(r, 0));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

test('the cue at or before a time; before the first, the first; none without cues', () => {
  const cues = [{ ticks: 0 }, { ticks: 2000 }, { ticks: 4000 }];
  assert.equal(cueAt(cues, 3999).ticks, 2000);
  assert.equal(cueAt(cues, 4000).ticks, 4000);
  assert.equal(cueAt(cues, 99999).ticks, 4000);
  assert.equal(cueAt([{ ticks: 500 }], 0).ticks, 500);
  assert.equal(cueAt([], 5), null);
});

for (const name of ['multi.mkv', 'clusters.mkv', 'open.webm']) {
  test(`${name}: a time finds its key frame's block from the index alone, and two bounded side requests bring exactly Mediabunny's key packet`, async () => {
    const bytes = film(name);
    let reads = 0;
    const layout = await readLayout(async (s, e) => bytes.slice(s, e), bytes.length);
    const places = mkvPlaces(layout);
    const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS });
    const sink = new MB.EncodedPacketSink((await input.getVideoTracks())[0]);
    for (const time of [0, 3.3, 11, 19.9]) {
      const place = places.locate(time), want = await sink.getKeyPacket(time);
      assert.equal(place.key, want.timestamp, `${time}s: the key frame's time`);
      const asked = [];
      const data = await mkvKeyFrame(places, place.cue, bounded(async (s, e) => { reads++; asked.push(e - s); return bytes.slice(s, e); }));
      assert.ok(same(data, want.data), `${time}s: the key frame's bytes`);
      assert.ok(asked.length <= 2, `${time}s: ${asked.length} requests`);
      assert.ok(asked.reduce((a, b) => a + b, 0) <= want.data.length + (17 << 10), `${time}s: ${asked} bytes for a ${want.data.length}-byte frame`);
    }
    assert.ok(reads > 0);
    // The film's clock shifted (a file that starts later): the same frames, earlier by the shift.
    assert.equal(mkvPlaces(layout, 2).locate(3.3).key, (await sink.getKeyPacket(5.3)).timestamp - 2);
  });
}

test('a key frame past the cap is not downloaded: the request is refused before it is made', async () => {
  const bytes = film('multi.mkv');
  const layout = await readLayout(async (s, e) => bytes.slice(s, e), bytes.length);
  const places = mkvPlaces(layout), cue = places.locate(10).cue;
  const made = [];
  const side = async (s, e) => { made.push(e - s); return bytes.slice(s, e); };
  await assert.rejects(mkvKeyFrame(places, cue, bounded(side, 3000)), TooLarge);
  assert.ok(made.reduce((a, b) => a + b, 0) <= 3000, 'nothing past the cap was asked for');
  // And no more than a handful of requests, however the cluster is laid out.
  let n = 0;
  const one = bounded(async () => { n++; return new Uint8Array(1); }, 1e9, 6);
  for (let i = 0; i < 6; i++) await one(0, 1);
  await assert.rejects(one(0, 1), TooLarge);
  assert.equal(n, 6);
});

test('MP4: the key frame Mediabunny names without reading (metadataOnly) is found in the movie box, byte for byte', async () => {
  const bytes = film('plain.mp4');
  const at = await findMoov(async (pos) => bytes.slice(pos, pos + 16), bytes.length);
  assert.ok(at, 'the movie box');
  const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS });
  const track = (await input.getVideoTracks())[0], sink = new MB.EncodedPacketSink(track);
  const samples = mp4Samples(bytes.slice(at.start, at.end), track.id);
  for (const time of [0, 4.2, 9, 19]) {
    const meta = await sink.getKeyPacket(time, { metadataOnly: true }), whole = await sink.getKeyPacket(time);
    const where = samples.sampleAt(meta.sequenceNumber);
    assert.equal(where.size, meta.byteLength);
    assert.ok(same(bytes.slice(where.offset, where.offset + where.size), whole.data), `${time}s`);
  }
  assert.equal(samples.sampleAt(-1), null);
  assert.equal(samples.sampleAt(samples.count), null);
});

/** A fake load: each call waits until released; counts what was fetched and what was closed. */
function fakes() {
  const log = { loads: [], closed: [], finished: [] };
  const pending = new Map();
  const load = (place, signal) => new Promise((resolve, reject) => {
    log.loads.push(place.key);
    signal.addEventListener('abort', () => reject(new Error('ended')));
    pending.set(place.key, () => { log.finished.push(place.key); resolve({ key: place.key, close() { log.closed.push(place.key); } }); });
  });
  const locate = (time) => ({ key: Math.floor(time / 2) * 2 });
  return { log, pending, locate, load };
}

test('one fetch at a time: the one under way finishes and is shown early, the latest place comes next, places passed over never', async () => {
  const f = fakes(), cache = new PreviewCache(f), early = [];
  const first = cache.at(1), second = cache.at(5), third = cache.at(9, null, (pic) => early.push(pic.key));
  await tick();
  assert.deepEqual(f.log.loads, [8], 'the places passed over before the first fetch were never fetched');
  f.pending.get(8)();
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal((await third).key, 8);
  // The same place asked again while it loads shares the one fetch.
  const a = cache.at(2), b = cache.at(3);
  await tick();
  assert.deepEqual(f.log.loads, [8, 2]);
  f.pending.get(2)();
  assert.equal(await a, null, 'the older of two asks is dropped');
  assert.equal((await b).key, 2);
  // Back to a place already fetched: no fetch at all.
  assert.equal((await cache.at(8.5)).key, 8);
  assert.deepEqual(f.log.loads, [8, 2]);
  // A fetch under way is let finish while the finger moves on (a 4K key frame outlasts a finger's rest): its
  // picture goes to the latest request as an early one, then the latest place is fetched; 14 is passed over.
  const x = cache.at(13); await tick();
  const y = cache.at(15); await tick();
  const z = cache.at(17, null, (pic) => early.push(pic.key)); await tick();
  assert.deepEqual(f.log.loads, [8, 2, 12], 'nothing else starts while 12 loads');
  f.pending.get(12)();
  assert.equal(await x, null);
  assert.equal(await y, null);
  await tick();
  assert.deepEqual(early, [12], 'the landed picture was handed over early');
  assert.deepEqual(f.log.loads, [8, 2, 12, 16], 'then the latest place, never 14');
  f.pending.get(16)();
  assert.equal((await z).key, 16);
  assert.deepEqual([...cache.pictures.keys()], [2, 8, 12, 16], 'both kept');
});

test('the largest key frame fetched follows the film’s bitrate: half a second of its data, 1.5 to 4 MB', () => {
  const MB1 = 1 << 20;
  assert.equal(frameCap(400e6, 40), 4 * MB1, 'a very dense film: 4 MB at most');
  assert.equal(frameCap(506e6, 7200), 1.5 * MB1, 'a two-hour 300 kbit/s film keeps 1.5 MB');
  assert.equal(frameCap(625e6, 180), Math.round(625e6 / 180 / 2), 'the 25 Mbit/s 1080p film: 1.7 MB');
  assert.ok(frameCap(302e6, 40) > 3661 << 10, 'a 60 Mbit/s 4K film: its 3.6 MB first key frame is fetched');
  for (const [size, duration] of [[0, 100], [1e9, 0], [NaN, NaN], [-1, 5]]) assert.equal(frameCap(size, duration), PREVIEW.maxFrame);
});

test('the decoder runs in a worker where one starts, on the page where none does, nowhere for a codec neither can decode', async () => {
  const page = async () => 'page';
  assert.equal(await previewDecoder({ codec: 'avc1.64001f' }, {}, { worker: async () => 'worker', page }), 'worker');
  assert.equal(await previewDecoder({ codec: 'avc1.64001f' }, {}, { worker: async () => undefined, page }), 'page');
  assert.equal(await previewDecoder({ codec: 'hvc1.2.4.L153' }, {}, { worker: async () => null, page }), null);
  assert.equal(await previewDecoder({}, {}, { worker: async () => 'worker', page }), null, 'no codec: nothing starts');
  // A worker that cannot start (no Worker here, as in Node) is said so, and its requests go in order, one at a time.
  assert.equal(await WorkerDecoder.start({ codec: 'avc1.64001f' }, { width: 320, height: 180 }, () => { throw new Error('no workers'); }), undefined);
  const sent = [], fake = { postMessage: (m) => sent.push(m), terminate() { sent.push('end'); } };
  const d = new WorkerDecoder(fake), bitmap = (id) => ({ id, close() {} });
  const one = d.decode(new Uint8Array([1, 2, 3]).subarray(1)), two = d.decode(new Uint8Array([4]));
  await tick();
  assert.deepEqual(sent.map((m) => m.id), [1], 'the second waits for the first');
  assert.deepEqual([...sent[0].data], [2, 3], 'a view is sent as its own bytes');
  fake.onmessage({ data: { type: 'picture', id: 1, bitmap: bitmap(1) } });
  assert.equal((await one).id, 1);
  await tick();
  assert.deepEqual(sent.map((m) => m.id), [1, 2]);
  fake.onmessage({ data: { type: 'picture', id: 2, error: 'no picture' } });
  await assert.rejects(two, /no picture/);
  const ended = new AbortController(), three = d.decode(new Uint8Array([5]), ended.signal);
  await tick();
  ended.abort();
  assert.deepEqual(sent.at(-1), { type: 'stop' }, 'ending a request stops the worker\'s decode');
  fake.onmessage({ data: { type: 'picture', id: 3, error: 'reset' } });
  await assert.rejects(three);
  d.close();
  assert.equal(sent.at(-1), 'end');
  await assert.rejects(d.decode(new Uint8Array([6])), /stopped/);
});

test('the cache keeps at most `keep` pictures, closes each one it drops, and closes everything when the film closes', async () => {
  const f = fakes(), cache = new PreviewCache({ ...f, keep: 3 });
  for (const t of [0, 2, 4, 6]) {
    const p = cache.at(t);
    await tick();
    f.pending.get(t)();
    await p;
  }
  assert.deepEqual(f.log.closed, [0], 'the oldest went, closed');
  assert.deepEqual([...cache.pictures.keys()], [2, 4, 6]);
  await cache.at(2); // used again: now the newest
  const p = cache.at(8); await tick(); f.pending.get(8)(); await p;
  assert.deepEqual(f.log.closed, [0, 4]);
  // A fetch under way when the film closes: it ends, and a picture arriving after is closed, not kept.
  const late = cache.at(20); await tick();
  cache.close();
  assert.equal(await late, null);
  assert.deepEqual(f.log.closed.sort((x, y) => x - y), [0, 2, 4, 6, 8]);
  assert.equal(cache.pictures.size, 0);
  assert.equal(await cache.at(2), null, 'closed: nothing more');
});

test('the caller ending its request ends the fetch; a fake decoder that fails gives null, not an error', async () => {
  const f = fakes(), cache = new PreviewCache(f), c = new AbortController();
  const p = cache.at(4, c.signal);
  await tick();
  c.abort();
  assert.equal(await p, null);
  assert.equal(cache.busy, null);
  const failing = new PreviewCache({ locate: f.locate, load: async () => { throw new Error('decoder failed'); } });
  assert.equal(await failing.at(1), null);
});

test('previews are off outside Astra’s own unpacking, with the saver on, and while the host is unreachable', () => {
  assert.equal(previewsOff({ mode: 'remux', saver: false, state: 'connected' }), '');
  assert.equal(previewsOff({ mode: 'remux', saver: false }), '');
  for (const mode of ['native', 'software', 'hls', 'dash', null]) assert.equal(previewsOff({ mode }), 'mode');
  assert.equal(previewsOff({ mode: 'remux', saver: true }), 'saver');
  assert.equal(previewsOff({ mode: 'remux', state: 'reconnecting' }), 'offline');
  assert.equal(previewsOff({ mode: 'remux', state: 'lost' }), 'offline');
  assert.equal(previewsOff({ mode: 'remux', closed: true }), 'closed');
  // The engine's answer: also none without a decoder configuration or a reader that can side-read.
  const engine = (o = {}) => ({ mode: 'remux', dataSaver: false, info: { video: [{ decoderConfig: { codec: 'avc1.64001f' } }] }, probed: { source: { sideRead() {}, state: 'connected' } }, ...o });
  assert.equal(previewMethods.previewsOff.call(engine()), '');
  assert.equal(previewMethods.previewsOff.call(engine({ dataSaver: true })), 'saver');
  assert.equal(previewMethods.previewsOff.call(engine({ info: { video: [{}] } })), 'none');
  assert.equal(previewMethods.previewsOff.call(engine({ probed: null })), 'none');
});
