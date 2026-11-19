// How fresh the address is that Astra hands its engine (frontend/astra/src/addons/debrid.js), against a stand-in for
// the Worker's POST /v1/astra/play: an address is kept 45 minutes (a TorBox link lives three hours), never longer,
// not even when the phone's clock is set back; a renewed address replaces the kept one, and an older answer that
// arrives late does not put the old one back; a press that found the film ready on TorBox (no address before a tap)
// is told apart from a miss and kept as long as the server keeps what it learnt; and a tap gives a press still
// under way only a moment before asking to play itself. Everything here is invented.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStream, renewStream, forgetAnswers, answerFor, SAID, KEEP, MISS, READY, GRACE } from '../frontend/astra/src/addons/debrid.js';

const H = '0123456789abcdef0123456789abcdef01234567';
const LINK = `https://addon.example/resolve/torbox/invented-key/${H}/null/0/Invented.Film.mkv`;
const STREAM = { url: LINK, filename: 'Invented.Film.mkv', size: 1_500_000_000 };
const read = async () => ({ api: 'https://api.example', token: 'invented-session' });
const flush = () => new Promise((r) => setImmediate(r));

/** The Worker's stand-in: each answer is `answer(body, n)` ([status, json], or a promise of one); `asked` the modes. */
function worker(answer) {
  const asked = [];
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.mode);
    const [status, json] = await answer(body, asked.length);
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { asked, opts: (o = {}) => ({ fetchFn, read, ...o }) };
}
const address = (n) => [200, { url: `https://cdn.example/${n}/film.mkv`, via: 'torbox', size: 1, type: null, readable: null, ready: false, steps: [], total_ms: 400 }];
const noAddress = (ready) => [200, { url: null, via: null, size: null, type: null, readable: null, ready, steps: [{ step: 'cached', ok: true, ms: 300 }], total_ms: 351 }];

beforeEach(() => forgetAnswers());

test('no address older than 45 minutes is handed over, not even with the clock set back', async (t) => {
  let now = 5_000_000;
  t.mock.method(Date, 'now', () => now);
  const w = worker((_b, n) => address(n));
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/1/film.mkv');
  now += KEEP - 1;
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/1/film.mkv', 'within 45 minutes: the kept one');
  now += 1;
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/2/film.mkv', 'at 45 minutes: a fresh one');
  // The phone's clock corrected backwards: the kept address's age is unknown, so it is asked for afresh.
  now -= 60_000;
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/3/film.mkv');
  // The same for a press's address taken by a tap.
  forgetAnswers();
  now += 10 * 60e3;
  await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  now += KEEP;
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/5/film.mkv');
  assert.deepEqual(w.asked, ['play', 'play', 'play', 'ahead', 'play']);
});

test('a renewed address replaces the kept one, and an older answer arriving late does not put it back', async () => {
  let release;
  const late = new Promise((r) => { release = r; });
  const w = worker((body, n) => (n === 2 ? late.then(() => address(n)) : address(n)));
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/1/film.mkv');
  // Renewed while a press's ask (the second) is still on its way.
  forgetAnswers();
  const press = resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  await flush();
  const renewed = await renewStream(STREAM, w.opts());
  assert.equal(renewed.url, 'https://cdn.example/3/film.mkv');
  release();
  assert.equal((await press).url, 'https://cdn.example/2/film.mkv');
  assert.equal((await resolveStream(STREAM, w.opts())).url, 'https://cdn.example/3/film.mkv', 'the renewed one is kept');
  assert.equal(answerFor('https://cdn.example/3/film.mkv'), renewed, 'and is the one the report describes');
  assert.deepEqual(w.asked, ['play', 'ahead', 'play']);
});

test('a press that found the film ready on TorBox is not a miss: said so, kept half an hour; the tap asks to play', async (t) => {
  let now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const w = worker((body, n) => (body.mode === 'ahead' ? noAddress(body.hash === H) : address(n)));
  const ready = await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  assert.deepEqual([ready.url, ready.via, ready.ready, ready.reason, ready.total], [LINK, 'addon', true, SAID.ready, 351]);
  now += MISS + 1;
  await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  assert.deepEqual(w.asked, ['ahead'], 'pressed again past a minute: still kept');
  now += READY;
  await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  assert.deepEqual(w.asked, ['ahead', 'ahead'], 'past half an hour: asked again');
  assert.equal((await resolveStream(STREAM, w.opts())).via, 'torbox');
  assert.deepEqual(w.asked, ['ahead', 'ahead', 'play']);
  // A miss (not on TorBox, or the server could not tell) is kept a minute only.
  forgetAnswers();
  const other = { url: 'https://addon.example/watch/7' };
  const miss = await resolveStream(other, w.opts({ mode: 'ahead' }));
  assert.deepEqual([miss.ready, miss.reason], [false, SAID.noAddress]);
  now += MISS;
  await resolveStream(other, w.opts({ mode: 'ahead' }));
  assert.deepEqual(w.asked.slice(3), ['ahead', 'ahead']);
  assert.equal(answerFor(LINK), null, 'a press without an address is not what plays');
});

test('a tap waits a moment for a press under way, then asks to play; whichever address comes first is played', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The press is slow (its answer would bring an address); the tap asks to play after GRACE and takes that.
  let pressAnswer;
  const slowPress = new Promise((r) => { pressAnswer = r; });
  const w = worker((body, n) => (body.mode === 'ahead' ? slowPress : address(n)));
  const press = resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  await flush();
  let tapped = null;
  resolveStream(STREAM, w.opts()).then((a) => { tapped = a; });
  await flush();
  t.mock.timers.tick(GRACE - 1); await flush();
  assert.deepEqual(w.asked, ['ahead'], 'within the moment: the press alone');
  t.mock.timers.tick(1); await flush(); await flush(); await flush();
  assert.deepEqual(w.asked, ['ahead', 'play']);
  assert.equal(tapped?.url, 'https://cdn.example/2/film.mkv');
  pressAnswer(address(1));
  assert.equal((await press).url, 'https://cdn.example/1/film.mkv');
  // A press that answers within the moment: its address, one request in all.
  forgetAnswers();
  const quick = worker((_b, n) => address(n));
  const p2 = resolveStream(STREAM, quick.opts({ mode: 'ahead' }));
  const t2 = await resolveStream(STREAM, quick.opts());
  assert.equal(t2, await p2);
  assert.deepEqual(quick.asked, ['ahead']);
  // A press that answers without an address: the tap asks to play at once, not after the moment.
  forgetAnswers();
  const ready = worker((body, n) => (body.mode === 'ahead' ? noAddress(true) : address(n)));
  resolveStream(STREAM, ready.opts({ mode: 'ahead' }));
  const t3 = resolveStream(STREAM, ready.opts());
  await flush(); await flush(); await flush();
  assert.deepEqual(ready.asked, ['ahead', 'play']);
  assert.equal((await t3).url, 'https://cdn.example/2/film.mkv');
});
