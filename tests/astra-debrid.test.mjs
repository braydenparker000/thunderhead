// A stream's address asked of the owner's own server (frontend/astra/src/addons/debrid.js, addons/worker-api.js),
// against a stand-in for the Worker's POST /v1/astra/play: its answers, an answer without an address, its error
// envelope, a server that is slow (30 s to play, 6 s ahead), signed out, answers kept 45 minutes in memory and
// shared while under way, a press's answer taken by the tap, renew, and forgetting. Everything here is invented.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStream, renewStream, forgetAnswers, SAID, KEEP } from '../frontend/astra/src/addons/debrid.js';

const H = '0123456789abcdef0123456789abcdef01234567';
const LINK = `https://addon.example/resolve/torbox/invented-key/${H}/null/2/Invented.Film.mkv`;
const STREAM = { url: LINK, filename: 'Invented.Film.mkv', size: 1_500_000_000 };
const SESSION = { api: 'https://api.example', token: 'invented-session' };
const signedIn = async () => SESSION;
const signedOut = async () => null;
const DIRECT = 'https://cdn.example/1/Invented.Film.mkv';

/** The Worker's stand-in: `answer(body)` gives [status, json] (or throws, or never answers with 'hang'); `asked` is every request. */
function worker(answer = () => [200, { url: DIRECT, via: 'torbox', size: 1_500_000_000, type: 'video/x-matroska', readable: true, steps: [{ step: 'cached', ok: true, ms: 40 }] }]) {
  const asked = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push({ url, method: init.method, auth: init.headers.Authorization, type: init.headers['Content-Type'], credentials: init.credentials, body });
    const a = answer(body);
    if (a === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const [status, json] = a;
    return new Response(typeof json === 'string' ? json : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { asked, fetchFn, opts: (o = {}) => ({ fetchFn, read: signedIn, ...o }) };
}
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => forgetAnswers());

test('signed in: the link and what it says of the file go to the server, and its direct address comes back', async () => {
  const w = worker();
  const a = await resolveStream(STREAM, w.opts());
  assert.deepEqual(a, { url: DIRECT, via: 'torbox', size: 1_500_000_000, type: 'video/x-matroska', readable: true, steps: [{ step: 'cached', ok: true, ms: 40 }], reason: null });
  assert.equal(w.asked.length, 1);
  const [r] = w.asked;
  assert.deepEqual([r.url, r.method, r.auth, r.type, r.credentials], ['https://api.example/v1/astra/play', 'POST', 'Bearer invented-session', 'application/json', 'omit']);
  assert.deepEqual(r.body, { link: LINK, mode: 'play', hash: H, fileIndex: 2, fileName: 'Invented.Film.mkv', fileSize: 1_500_000_000 });
  // What the link does not say is left out, never sent as null.
  const plain = worker();
  await resolveStream({ url: 'https://addon.example/watch/7' }, plain.opts({ mode: 'ahead' }));
  assert.deepEqual(plain.asked[0].body, { link: 'https://addon.example/watch/7', mode: 'ahead' });
  // Where the add-on's link leads, followed by the server; odd steps are dropped.
  forgetAnswers();
  const follow = worker(() => [200, { url: DIRECT, via: 'follow', size: null, type: null, readable: false, steps: [{ step: 'follow', ok: true, ms: 12.6, note: 'Two hops.' }, { step: 'other' }, 'x'] }]);
  const f = await resolveStream(STREAM, follow.opts());
  assert.deepEqual([f.via, f.readable, f.steps], ['follow', false, [{ step: 'follow', ok: true, ms: 13, note: 'Two hops.' }]]);
});

test("without an address, after an error, from a slow or unreachable server: the add-on's own link, and why", async (t) => {
  const none = await resolveStream(STREAM, worker(() => [200, { url: null, via: null, steps: [{ step: 'owned', ok: false, ms: 5 }] }]).opts({ mode: 'ahead' }));
  assert.deepEqual(none, { url: LINK, via: 'addon', size: null, type: null, readable: null, steps: [{ step: 'owned', ok: false, ms: 5 }], reason: SAID.noAddress });
  const http = await resolveStream(STREAM, worker(() => [200, { url: 'http://cdn.example/x.mkv', via: 'torbox' }]).opts());
  assert.equal(http.via, 'addon', 'a plain-http address is not taken');
  const envelope = (status, details) => worker(() => [status, { error: { code: 'upstream', message: 'Fixed.', ...(details ? { details } : {}), request_id: 'r1' } }]);
  const said = await resolveStream(STREAM, envelope(502, { reason: 'TorBox did not answer.', steps: [{ step: 'key', ok: true, ms: 1 }, { step: 'cached', ok: false, ms: 900 }] }).opts());
  assert.deepEqual([said.url, said.via, said.reason, said.steps.length], [LINK, 'addon', 'TorBox did not answer.', 2]);
  assert.equal((await resolveStream(STREAM, envelope(404).opts())).reason, 'Your server does not offer this yet.');
  assert.equal((await resolveStream(STREAM, envelope(401).opts())).reason, 'Your sign-in on this phone has ended.');
  assert.equal((await resolveStream(STREAM, worker(() => [200, '<html>']).opts())).reason, 'Your server sent an answer Astra could not read.');
  const down = await resolveStream(STREAM, { read: signedIn, fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual([down.via, down.reason], ['addon', SAID.unreachable]);
  // Slow: six seconds ahead, thirty to play.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [mode, ms] of [['ahead', 6000], ['play', 30000]]) {
    const w = worker(() => 'hang');
    let done = null;
    resolveStream(STREAM, w.opts({ mode })).then((a) => { done = a; });
    await flush();
    t.mock.timers.tick(ms - 1); await flush();
    assert.equal(done, null, `${mode}: still waiting`);
    t.mock.timers.tick(1); await flush(); await flush();
    assert.deepEqual([done?.via, done?.url, done?.reason], ['addon', LINK, SAID.timeout], mode);
  }
});

test('signed out: nothing is asked, the add-on’s link is played, and what was kept is forgotten', async () => {
  const w = worker();
  await resolveStream(STREAM, w.opts());
  const out = await resolveStream(STREAM, w.opts({ read: signedOut }));
  assert.deepEqual([out.url, out.via, out.reason], [LINK, 'addon', SAID.signedOut]);
  assert.equal(w.asked.length, 1, 'not asked while signed out');
  await resolveStream(STREAM, w.opts());
  assert.equal(w.asked.length, 2, 'signed in again: asked afresh, nothing was kept');
  // A local player's or a plain link: nothing to ask, nothing to say.
  const local = await resolveStream({ url: 'http://127.0.0.1:8080/film.mkv' }, w.opts());
  assert.deepEqual([local.via, local.reason, w.asked.length], ['addon', null, 2]);
});

test('answers are kept 45 minutes, one under way is shared, a press’s address is taken by the tap', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const w = worker();
  const [a, b] = await Promise.all([resolveStream(STREAM, w.opts()), resolveStream(STREAM, w.opts())]);
  assert.equal(a, b);
  assert.equal(w.asked.length, 1, 'two taps, one request');
  now += KEEP - 1;
  await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  assert.equal(w.asked.length, 1, 'within 45 minutes: from memory, for a press too');
  now += 2;
  await resolveStream(STREAM, w.opts());
  assert.equal(w.asked.length, 2, 'after 45 minutes: asked again');
  // A press asks ahead; the tap that follows while it is under way takes its address.
  forgetAnswers();
  const p = worker();
  const pressed = resolveStream(STREAM, p.opts({ mode: 'ahead' }));
  const tapped = await resolveStream(STREAM, p.opts());
  assert.equal(tapped, await pressed);
  assert.deepEqual(p.asked.map((r) => r.body.mode), ['ahead']);
  // A press whose answer has no address (not in the account yet): the tap asks to play; that is not kept.
  forgetAnswers();
  const q = worker((body) => (body.mode === 'ahead' ? [200, { url: null, via: null, steps: [] }] : [200, { url: DIRECT, via: 'torbox', steps: [] }]));
  const ahead = resolveStream(STREAM, q.opts({ mode: 'ahead' }));
  const [first, second] = await Promise.all([resolveStream(STREAM, q.opts()), resolveStream(STREAM, q.opts())]);
  assert.equal((await ahead).via, 'addon');
  assert.deepEqual([first.via, second.via], ['torbox', 'torbox']);
  assert.deepEqual(q.asked.map((r) => r.body.mode), ['ahead', 'play'], 'two taps after the press: one request to play');
  const failing = worker(() => [503, { error: { code: 'unavailable', message: 'x' } }]);
  forgetAnswers();
  await resolveStream(STREAM, failing.opts()); await resolveStream(STREAM, failing.opts());
  assert.equal(failing.asked.length, 2, 'a failure is not kept: the next tap asks again');
});

test('renew asks afresh to play; forgetting drops every kept answer; a caller that stops waiting leaves the answer kept', async () => {
  const w = worker();
  await resolveStream(STREAM, w.opts({ mode: 'ahead' }));
  const renewed = await renewStream(STREAM, w.opts());
  assert.equal(renewed.url, DIRECT);
  assert.deepEqual(w.asked.map((r) => r.body.mode), ['ahead', 'play']);
  await resolveStream(STREAM, w.opts());
  assert.equal(w.asked.length, 2, 'the renewed answer is kept');
  forgetAnswers();
  await resolveStream(STREAM, w.opts());
  assert.equal(w.asked.length, 3, 'forgotten: asked again');
  forgetAnswers();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = { ...w.opts(), fetchFn: async (url, init) => { await gate; return w.fetchFn(url, init); } };
  const stop = new AbortController();
  const waiting = resolveStream(STREAM, { ...slow, mode: 'ahead', signal: stop.signal });
  await flush();
  stop.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  release();
  assert.equal((await resolveStream(STREAM, slow)).url, DIRECT);
  assert.deepEqual(w.asked.map((r) => r.body.mode), ['ahead', 'play', 'play', 'ahead'], 'the press’s ask went on, and the tap took its answer');
});
