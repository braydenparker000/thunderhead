// What a playback batch holds and how batches go (frontend/th/music/report-batch.js, report-fields.js,
// frontend/ui/scrub.js; MUSIC.md §5.10), without a page. Only known fields leave the phone, and the
// phone's copy of the fields and of the cleaning gives what the Worker's (shared/contract/reports*.ts)
// gives, on the same awkward inputs: unknown names (trackTitle, songName, key, q, meta.tags.TIT2),
// addresses in any case or scheme, with a user and password, percent-encoded or with spaces in the
// path, quoted text and patterns, long text. Each event has its number in the page load; a batch is
// under 30 KB; one goes a minute while playing and when hidden, never two at once; the mark moves
// only when the Worker takes a batch, so a batch whose answer was lost goes again with the same
// numbers; 401/403 stop until the session changes; no answer, 408, 429 and 5xx wait and go again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_BYTES, WAIT_MAX_MS, batches, batchOf, since, stateOf } from '../frontend/th/music/report-batch.js';
import * as phone from '../frontend/th/music/report-fields.js';
import { cleanText as phoneText } from '../frontend/ui/scrub.js';
import * as clean from '../shared/contract/reports-clean.ts';
import * as lists from '../shared/contract/reports.ts';

const shared = { ...lists, ...clean };

const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
const TEXTS = [
  ['MEDIA_ERR HTTPS://Bucket.Example/audio/A.opus?sig=s3cr3t', 'MEDIA_ERR Bucket.Example/…'],
  ['open file:///storage/Music/My Song.opus (gone)', 'open file:… (gone)'],
  ['at content://media/external/audio/My Song', 'at media/…'],
  ['fetch https%3A%2F%2Fh.example%2FMy%20Song.opus%3Fsig%3Dx', 'fetch h.example/…'],
  ['GET http://user:secret@host.example/My Song.mp3', 'GET host.example/…'],
  ['blob:http://127.0.0.1:8080/0c2f-11 gone', '127.0.0.1:8080/…'],
  ['TypeError: "my typed words" cannot be parsed as a URL', 'TypeError: … cannot be parsed as a URL'],
  ["SyntaxError: Unexpected identifier 'hello'", 'SyntaxError: Unexpected identifier …'],
  ['SyntaxError: Invalid regular expression: /a(b/: Unterminated group', 'SyntaxError: Invalid regular expression: …: Unterminated group'],
  ["Cannot read properties of undefined (reading 'foo'); can't", "Cannot read properties of undefined (reading …); can't"],
  ['PIPELINE_ERROR_DECODE: audio decode failed', 'PIPELINE_ERROR_DECODE: audio decode failed'],
  ['net::ERR_FAILED', 'net::ERR_FAILED'],
  [`session ${TOKEN} sent`, 'session [token] sent'],
  ['data:audio/ogg;base64,AAAA', 'data:…'],
  ['x'.repeat(400), 'x'.repeat(160)],
];

test('a text: an address only its host in any form, quoted text and patterns cut, at most 160; the Worker agrees', () => {
  assert.equal(shared.REPORT_LIMITS.text_max, phone.TEXT_MAX);
  for (const [input, want] of TEXTS) {
    assert.equal(phoneText(input, phone.TEXT_MAX), want, input);
    assert.equal(shared.cleanText(input), want, `${input} (Worker)`);
  }
});

/** A batch with every kind of thing that must not leave the phone. */
const raw = () => ({
  v: 1, page: '0123456789abcdef', seq: 2, why: 'minute', build: 81, t0: 1000.4, lost: false, dropped: 0,
  trackTitle: 'A Song', q: 'what I searched',
  events: [
    { n: 1, t: 5, type: 'track', id: 'r2_native_abc', format: 'OPUS', kbps: 160.44, source: 'stream', trackTitle: 'A Song', songName: 'A Song', key: 'audio/Artist/Song.opus', q: 'what I searched', meta: { tags: { TIT2: 'A Song' } } },
    { n: 2, t: 6, type: 'error', deck: 0, code: 2, kind: 'network', message: `MEDIA_ERR HTTPS://Bucket.Example/audio/A.opus?sig=s3cr3t with ${TOKEN}` },
    { n: 3, t: 7, type: 'stream_error', code: 4, message: 'open file:///storage/Music/My Song.opus (gone)' },
    { n: 4, t: 8, type: 'first sound', track: 'r2_native_abc', ms: 412 },
    { n: 5, t: 9, type: 'my own type', title: 'A Song' },
    { n: 6, t: 10, type: 'track', id: 'Artist - My Song.opus', source: 'my folder' },
    { n: 7, t: 11, type: 'waiting', deck: 1, at: Number.NaN },
  ],
  state: {
    browser: 'Mozilla/5.0', startedAt: '2026-10-31T10:00:00Z', events: [{ t: 1 }],
    track: { id: 'r2_native_abc', format: 'OPUS', source: 'stream', title: 'A Song' },
    decks: [{ index: 0, waits: 2, waitSeconds: 1.25, lastError: { code: 2, kind: 'network', message: 'at https://h.example/p' }, path: '/My Song', startMs: [120, 'x', 340] }],
    offline: { tracks: 3, lastError: 'GET HTTPS://h.example/My Song.opus', urls: ['https://h.example/a'] },
    output: { engine: 'worklet', state: 'running', latencyHint: 0.02 },
  },
});
const WANT = {
  v: 1, page: '0123456789abcdef', seq: 2, why: 'minute', build: 81, t0: 1000.4, lost: false, dropped: 0,
  events: [
    { n: 1, t: 5, type: 'track', id: 'r2_native_abc', format: 'OPUS', kbps: 160.4, source: 'stream' },
    { n: 2, t: 6, type: 'error', deck: 0, code: 2, kind: 'network', message: 'MEDIA_ERR Bucket.Example/…' },
    { n: 3, t: 7, type: 'stream_error', code: 4, message: 'open file:… (gone)' },
    { n: 4, t: 8, type: 'first sound', track: 'r2_native_abc', ms: 412 },
    { n: 5, t: 9, type: 'other' },
    { n: 6, t: 10, type: 'track' },
    { n: 7, t: 11, type: 'waiting', deck: 1 },
  ],
  state: {
    track: { id: 'r2_native_abc', format: 'OPUS', source: 'stream' },
    decks: [{ index: 0, waits: 2, waitSeconds: 1.3, lastError: { code: 2, kind: 'network', message: 'at h.example/…' }, startMs: [120, 340] }],
    offline: { tracks: 3, lastError: 'GET h.example/…' },
    output: { engine: 'worklet', state: 'running' },
  },
};

test('a batch keeps only its known fields, on the phone and again on the Worker, with the same lists', () => {
  assert.deepEqual(phone.PLAYBACK_EVENTS, shared.PLAYBACK_EVENTS);
  assert.deepEqual(phone.PLAYBACK_STATE, shared.PLAYBACK_STATE);
  assert.deepEqual(phone.PLAYBACK_BATCH, shared.PLAYBACK_BATCH);
  const kept = phone.cleanBatch(raw());
  assert.deepEqual(kept, WANT);
  assert.deepEqual(shared.cleanReport('playback', raw()), WANT, 'the Worker keeps the same');
  assert.deepEqual(shared.cleanReport('playback', kept), WANT, 'and cleaning again changes nothing');
  assert.doesNotMatch(JSON.stringify(kept), /Song|Artist|search|TIT2|s3cr3t|sig|storage|Mozilla|AAAAAAAA|folder/);
  assert.deepEqual(stateOf(raw().state), WANT.state);
});

test('since: the events after the last one taken; all, with lost, when it fell out of the log', () => {
  const a = { t: 1 }, b = { t: 2 }, c = { t: 3 };
  assert.deepEqual(since([a, b, c], null), { events: [a, b, c], lost: false });
  assert.deepEqual(since([a, b, c], b), { events: [c], lost: false });
  assert.deepEqual(since([a, b, c], c), { events: [], lost: false });
  assert.deepEqual(since([b, c], { t: 0 }), { events: [b, c], lost: true });
});

test('batchOf: under 30 KB, the oldest events left out and counted', () => {
  const events = Array.from({ length: 300 }, (_, i) => ({ n: i, t: i, type: 'stream_error', code: 2, message: 'x'.repeat(150), atMs: 1 }));
  const b = /** @type {any} */ (batchOf({ page: 'ab12', seq: 3, why: 'minute', build: 80, t0: 1000.4, lost: false, events, state: { decks: [] } }));
  assert.ok(new TextEncoder().encode(JSON.stringify(b)).length <= BATCH_BYTES);
  assert.ok(b.dropped > 0);
  assert.equal(b.dropped + b.events.length, 300);
  assert.deepEqual(b.events.at(-1), { n: 299, t: 299, type: 'stream_error', code: 2, message: 'x'.repeat(150), atMs: 1 }, 'the newest kept');
  assert.deepEqual(Object.keys(b), ['v', 'page', 'seq', 'why', 'build', 't0', 'lost', 'dropped', 'events', 'state']);
  assert.equal(b.t0, 1000);
});

/** A log and a Worker for `batches`; each post waits until the test answers it. */
function rig() {
  const log = { events: /** @type {object[]} */ ([]), now: () => 5000, snapshot: () => ({ browser: 'b', decks: [] }) };
  const posts = /** @type {{ body: any, token: string, answer: (a: any) => void, fail: () => void }[]} */ ([]);
  const s = { log, posts, playing: false, token: /** @type {string | null} */ ('t1'), clock: 1_000_000 };
  const b = batches({
    log, page: 'ab12', build: 80, everyMs: 60_000, now: () => s.clock, playing: () => s.playing, token: () => s.token,
    post: (body, token) => new Promise((answer, reject) => posts.push({ body, token, answer, fail: () => reject(new Error('offline')) })),
  });
  return { s, b, log, posts };
}
const ns = (/** @type {any} */ p) => p.body.events.map((/** @type {any} */ e) => e.n);
const ok = { ok: true, status: 201 };
const settle = () => new Promise((r) => setImmediate(r));

test('batches: a minute apart while playing, when hidden, nothing new nothing sent, each event numbered', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { s, b, log, posts } = rig();
  log.events.push({ t: 1, type: 'track', id: 'r2_a' });
  s.playing = true;
  b.follow();
  b.follow();
  t.mock.timers.tick(59_000);
  assert.equal(posts.length, 0);
  t.mock.timers.tick(1_000);
  assert.deepEqual([posts.length, posts[0].body.seq, posts[0].body.why, posts[0].body.t0, posts[0].body.page, posts[0].token], [1, 1, 'minute', 995_000, 'ab12', 't1']);
  assert.deepEqual(posts[0].body.state, { decks: [] });
  posts[0].answer(ok);
  await settle();
  t.mock.timers.tick(60_000);
  assert.equal(posts.length, 1, 'nothing new, nothing sent');
  log.events.push({ t: 70_000, type: 'waiting', deck: 0 }, { t: 70_001, type: 'pause' });
  s.playing = false;
  b.follow();
  t.mock.timers.tick(180_000);
  assert.equal(posts.length, 1, 'paused: no minute batches');
  b.hidden();
  assert.deepEqual([posts.length, posts[1].body.why, posts[1].body.seq, ns(posts[0]), ns(posts[1])], [2, 'hidden', 2, [0], [1, 2]]);
});

test('batches: never two at once; the mark moves only when one is taken, so a lost answer resends the same numbers', async () => {
  const { s, b, log, posts } = rig();
  log.events.push({ t: 1, type: 'play' }, { t: 2, type: 'waiting', deck: 0 });
  b.hidden();
  log.events.push({ t: 3, type: 'pause' });
  assert.equal(b.hidden(), null, 'A is on its way: B does not start');
  assert.equal(posts.length, 1);
  // The Worker kept A, but its answer never came (a timeout): A's events go again with the same numbers.
  posts[0].fail();
  await settle();
  s.clock += 60_000;
  b.hidden();
  assert.deepEqual([ns(posts[0]), ns(posts[1])], [[0, 1], [0, 1, 2]]);
  posts[1].answer(ok);
  await settle();
  log.events.push({ t: 4, type: 'play' });
  b.hidden();
  assert.deepEqual(ns(posts[2]), [3], 'after it was taken, only what came later');
});

test('batches: 401/403 stop until the session changes; no answer, 408, 429, 5xx wait longer each time; 422 gives up', async () => {
  const { s, b, log, posts } = rig();
  log.events.push({ t: 1, type: 'play' });
  b.hidden();
  posts[0].answer({ ok: false, status: 401 });
  await settle();
  s.clock += 3_600_000;
  assert.equal(b.hidden(), null, 'the same session: nothing');
  s.token = 't2';
  b.hidden();
  assert.equal(posts[1].token, 't2', 'a new session: it goes');
  posts[1].answer({ ok: false, status: 503 });
  await settle();
  s.clock += 59_000;
  assert.equal(b.hidden(), null, 'a minute after a 503');
  s.clock += 1_000;
  b.hidden();
  posts[2].answer({ ok: false, status: 429, retryAfter: 300 });
  await settle();
  s.clock += 299_000;
  assert.equal(b.hidden(), null, 'the Worker\'s Retry-After, longer than the 2 minutes');
  s.clock += 1_000;
  b.hidden();
  for (const status of [408, 500, 502, 504, 500, 500]) {
    posts.at(-1)?.answer({ ok: false, status });
    await settle();
    s.clock += WAIT_MAX_MS;
    b.hidden();
  }
  assert.equal(posts.length, 10, 'never longer than 30 minutes');
  assert.deepEqual(ns(posts.at(-1)), [0], 'the same event each time');
  posts.at(-1)?.answer({ ok: false, status: 422 });
  await settle();
  assert.equal(b.hidden(), null, 'refused for good: dropped, not sent again');
  log.events.push({ t: 2, type: 'pause' });
  b.hidden();
  assert.deepEqual(ns(posts.at(-1)), [1]);
});
