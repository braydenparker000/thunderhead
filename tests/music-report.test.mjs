// What a playback batch holds (frontend/th/music/report-batch.js; MUSIC.md §5.10), without a page:
// named fields never go and addresses keep only their host; the events since the last batch, and a
// note when the log let some go first; the counters without the browser's name; a batch kept under
// 30 KB by leaving out the oldest events; once a minute while music plays, once when the page is
// hidden, nothing when nothing is new, and a batch not taken for now goes again with the next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_BYTES, bare, batches, batchOf, clean, since, stateOf } from '../frontend/th/music/report-batch.js';

test('clean: named fields dropped, addresses cut to their host, numbers to 0.1, nothing too deep', () => {
  assert.equal(bare('MEDIA_ERR https://bucket.example/audio/Song%20Name.opus?X-Amz-Signature=abc failed'), 'MEDIA_ERR bucket.example/… failed');
  assert.equal(bare('blob:http://127.0.0.1:8080/0c2f-11 gone'), '127.0.0.1:8080/… gone');
  assert.equal(bare('x'.repeat(500)).length, 160);
  const e = {
    t: 1234, type: 'track', id: 'r2_native_abc', format: 'opus', kbps: 160.44, source: 'stream',
    title: 'A Song', Artist: 'Someone', album: 'Album', path: 'Music/A Song.opus', src: 'https://x.example/a', name: 'n',
    error: { code: 2, kind: 'network', message: 'Failed https://x.example/a?sig=1' },
  };
  assert.deepEqual(clean(e), {
    t: 1234, type: 'track', id: 'r2_native_abc', format: 'opus', kbps: 160.4, source: 'stream',
    error: { code: 2, kind: 'network', message: 'Failed x.example/…' },
  });
  assert.deepEqual(clean({ a: Number.NaN, b: undefined, c: () => 1, d: true }), { a: null, d: true });
  let deep = /** @type {any} */ ({ v: 1 });
  for (let i = 0; i < 9; i++) deep = { deep };
  assert.ok(!JSON.stringify(clean(deep)).includes('"v"'), 'cut at depth 6');
});

test('since: the events after the last one sent; all, with lost, when it fell out of the log', () => {
  const a = { t: 1 }, b = { t: 2 }, c = { t: 3 };
  assert.deepEqual(since([a, b, c], null), { events: [a, b, c], lost: false });
  assert.deepEqual(since([a, b, c], b), { events: [c], lost: false });
  assert.deepEqual(since([a, b, c], c), { events: [], lost: false });
  assert.deepEqual(since([b, c], { t: 0 }), { events: [b, c], lost: true });
});

test('stateOf: the counters without the event list, the browser or the start date', () => {
  const s = stateOf({ version: 1, startedAt: '2026-10-31T10:00:00Z', browser: 'Mozilla/5.0 …', events: [{ t: 1 }],
    track: { id: 'r2_native_abc', format: 'opus', source: 'stream' }, decks: [{ index: 0, waits: 2, lastError: { kind: 'network', message: 'at https://h.example/p' } }] });
  assert.deepEqual(s, { version: 1, track: { id: 'r2_native_abc', format: 'opus', source: 'stream' }, decks: [{ index: 0, waits: 2, lastError: { kind: 'network', message: 'at h.example/…' } }] });
});

test('batchOf: under 30 KB, the oldest events left out and counted', () => {
  const events = Array.from({ length: 600 }, (_, i) => ({ t: i, type: 'waiting', deck: 0, note: 'x'.repeat(100) }));
  const b = batchOf({ page: 'p1', seq: 3, why: 'minute', build: 80, t0: 1000.4, lost: false, events, state: { decks: [] } });
  assert.ok(new TextEncoder().encode(JSON.stringify(b)).length <= BATCH_BYTES);
  assert.equal(b.dropped + b.events.length, 600);
  assert.ok(b.dropped > 0);
  assert.equal(/** @type {any} */ (b.events.at(-1)).t, 599, 'the newest kept');
  assert.deepEqual(Object.keys(b), ['v', 'page', 'seq', 'why', 'build', 't0', 'lost', 'dropped', 'events', 'state']);
  assert.equal(b.t0, 1000);
  const small = batchOf({ page: 'p1', seq: 1, why: 'hidden', build: 80, t0: 0, lost: true, events: [{ t: 1, type: 'play' }], state: null });
  assert.deepEqual([small.dropped, small.lost, small.events], [0, true, [{ t: 1, type: 'play' }]]);
});

/** A log and a Worker for `batches`: `answer` is what the next post gets. */
function rig() {
  const log = { events: /** @type {object[]} */ ([]), now: () => 5000, snapshot: () => ({ browser: 'b', events: [], decks: [] }) };
  const posts = /** @type {any[]} */ ([]);
  const r = { log, posts, playing: false, answer: { ok: true, status: 201 } };
  const b = batches({ log, page: 'p1', build: 80, now: () => 1_000_000, everyMs: 60_000, playing: () => r.playing, post: async (body) => { posts.push(body); return r.answer; } });
  return { ...r, r, b };
}

test('batches: once a minute while playing, once when hidden, nothing when nothing is new', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { r, b, log, posts } = rig();
  log.events.push({ t: 1, type: 'track', id: 'r2_a' });
  r.playing = true;
  b.follow();
  b.follow();
  t.mock.timers.tick(59_000);
  assert.equal(posts.length, 0);
  t.mock.timers.tick(1_000);
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0].seq, posts[0].why, posts[0].t0, posts[0].events.length, posts[0].state], [1, 'minute', 995_000, 1, { decks: [] }]);
  t.mock.timers.tick(60_000);
  assert.equal(posts.length, 1, 'nothing new, nothing sent');
  log.events.push({ t: 70_000, type: 'waiting', deck: 0 });
  t.mock.timers.tick(60_000);
  assert.deepEqual(posts.map((p) => p.events.map((/** @type {any} */ e) => e.t)), [[1], [70_000]]);
  r.playing = false;
  b.follow();
  log.events.push({ t: 200_000, type: 'pause' });
  t.mock.timers.tick(180_000);
  assert.equal(posts.length, 2, 'paused: no minute batches');
  await b.hidden();
  assert.deepEqual([posts.length, posts[2].why, posts[2].seq], [3, 'hidden', 3]);
  assert.equal(b.hidden(), null, 'hidden again with nothing new: nothing sent');
});

test('batches: one not taken for now goes again with the next; one refused does not', async () => {
  const { r, b, log, posts } = rig();
  log.events.push({ t: 1, type: 'play' });
  r.answer = { ok: false, status: 503 };
  await b.hidden();
  log.events.push({ t: 2, type: 'waiting' });
  r.answer = { ok: false, status: 422 };
  await b.hidden();
  assert.deepEqual(posts[1].events.map((/** @type {any} */ e) => e.t), [1, 2], 'the 503 batch went again');
  assert.equal(b.hidden(), null, 'the refused one is not sent again');
  log.events.push({ t: 3, type: 'pause' });
  r.answer = { ok: true, status: 201 };
  await b.hidden();
  assert.deepEqual(posts[2].events.map((/** @type {any} */ e) => e.t), [3]);
});
