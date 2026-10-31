// The ported player's data move (frontend/th/music/bridge.js, loaded by music/sw.js): the player's
// requests for its library, addressed to the old Worker, are answered from the new Worker (the
// catalog with its ETag, audio and art by signed links signed again near their end or on a 403, a
// waveform as bytes) and go to the old Worker as before while the new one can't answer (signed out,
// no catalog yet, no signing key, the bucket refusing a fresh link, a framed player), asking again 5
// minutes later; a network failure or a slow answer sends only that request there. The next songs'
// links are signed ahead in one request, a link asked twice at once is signed once, and the session
// is read once a minute. Run in a plain VM with stubbed fetch, caches and session (and its clocks
// 100 times faster); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../frontend/th/music/bridge.js', import.meta.url), 'utf8');
const OLD = 'https://old.example.test';
const API = 'https://api.example.test';
const ID = `r2_native_${'a'.repeat(64)}`;

function load({ token = 'th1_session', top = true } = {}) {
  const self = {};
  const fast = { setTimeout: (f, ms) => setTimeout(f, ms / 100), clearTimeout };
  vm.runInNewContext(SOURCE, { self, URL, Headers, Response, Request, atob, Uint8Array, Symbol, JSON, Promise, Map, AbortController, AbortSignal, DOMException, ...fast });
  const b = self.thMusicBridge;
  b.use(OLD);
  const calls = [];
  const state = { now: 1_000_000, catalog: 200, sign: 200, r2: [], token, top, signed: 0, tokenReads: 0, apiReads: 0, api: API };
  const store = new Map();
  b.deps.now = () => state.now;
  b.deps.token = async () => (state.tokenReads++, state.token);
  b.deps.api = async () => {
    state.apiReads++;
    if (state.api instanceof Error) throw state.api;
    return state.api;
  };
  b.deps.topLevel = async () => state.top;
  b.deps.caches = () => ({ open: async () => ({ match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r) }) });
  b.deps.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(typeof input === 'string' ? init.headers : input.headers);
    calls.push({ url, method: init.method ?? (typeof input === 'string' ? 'GET' : input.method), headers, body: init.body, signal: init.signal });
    if (url.startsWith(OLD)) return new Response('old', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    if (url === `${API}/v1/music/catalog`) {
      if (state.catalog !== 200) return new Response('{}', { status: state.catalog });
      if (headers.get('If-None-Match') === '"m1-x"') return new Response(null, { status: 304, headers: { ETag: '"m1-x"' } });
      return new Response('{"version":1,"tracks":[]}', { status: 200, headers: { ETag: '"m1-x"', 'Content-Type': 'application/json' } });
    }
    if (url === `${API}/v1/media/sign`) {
      if (state.sign === 'down') throw new TypeError('Failed to fetch');
      if (state.sign === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
      if (state.sign !== 200) return new Response('{}', { status: state.sign });
      const { refs } = JSON.parse(init.body);
      if (state.signGate) await state.signGate;
      const out = { items: [], errors: [] };
      for (const ref of refs) {
        if (ref.endsWith('#art') && state.noArt) out.errors.push({ ref, code: 'not_found' });
        else out.items.push({ ref, url: `https://r2.example.test/${encodeURIComponent(ref)}?n=${++state.signed}`, expires_at: state.now + 3 * 3_600_000 });
      }
      return Response.json(out);
    }
    if (url.startsWith(`${API}/v1/music/waveforms/`)) {
      if (state.waveform) return new Response('{}', { status: state.waveform });
      return url.endsWith(ID) ? Response.json({ id: ID, bars: btoa('\x01\x02\x03') }) : new Response('{}', { status: 404 });
    }
    if (url.startsWith('https://r2.example.test/')) {
      const next = state.r2.shift() ?? 206;
      if (next === 'cors') throw new TypeError('Failed to fetch');
      return new Response(next === 206 ? 'bytes' : null, {
        status: next,
        headers: next === 206 ? { 'Content-Type': 'audio/ogg', 'Content-Range': 'bytes 0-4/100', 'Accept-Ranges': 'bytes', 'X-Other': 'dropped' } : {},
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const get = (path, headers = {}, signal) => b.answer(new Request(OLD + path, { headers, signal }), { clientId: 'c1' });
  return { b, calls, state, get, store };
}
const onlyNew = (calls) => calls.every((c) => !c.url.startsWith(OLD));

test('only the library paths on the old Worker are the bridge’s', () => {
  const { b } = load();
  assert.equal(b.handles(new URL(`${OLD}/music/library.json`)), true);
  assert.equal(b.handles(new URL(`${OLD}/music/library/audio/${ID}`)), true);
  assert.equal(b.handles(new URL(`${OLD}/music/uploads/register`)), false);
  assert.equal(b.handles(new URL(`https://elsewhere.test/music/library.json`)), false);
});

test('the catalog comes from the new Worker, kept with its ETag: an unchanged one costs a 304', async () => {
  const { calls, get } = load();
  const first = await get('/music/library.json');
  assert.equal(first.status, 200);
  assert.equal(await first.text(), '{"version":1,"tracks":[]}');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer th1_session');
  const again = await get('/music/library.json');
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('ETag'), '"m1-x"');
  assert.equal(await again.text(), '{"version":1,"tracks":[]}');
  assert.equal(calls[1].headers.get('If-None-Match'), '"m1-x"');
  assert.ok(onlyNew(calls), 'no old-Worker call');
});

test('audio by a signed link: ranges pass, the link is reused, signed again near its end and on a 403', async () => {
  const { calls, get, state } = load();
  const r = await get(`/music/library/audio/${ID}`, { Range: 'bytes=0-4' });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-4/100');
  assert.equal(r.headers.get('X-Other'), null);
  assert.equal(calls.at(-1).headers.get('Range'), 'bytes=0-4');
  assert.equal(calls.at(-1).headers.get('Authorization'), null, 'the bucket never sees the session');
  await get(`/music/library/audio/${ID}`, { Range: 'bytes=5-9' });
  assert.equal(state.signed, 1, 'the same link while it has time left');
  state.now += 2.7 * 3_600_000;
  await get(`/music/library/audio/${ID}`);
  assert.equal(state.signed, 2, 'signed again under 20 minutes from its end');
  state.r2.push(403, 206);
  assert.equal((await get(`/music/library/audio/${ID}`)).status, 206);
  assert.equal(state.signed, 3, 'a 403 signs once more');
  assert.ok(onlyNew(calls));
});

test('art and waveforms: a missing cover is a 404; the bars come as bytes', async () => {
  const { get, state, calls } = load();
  state.noArt = true;
  assert.equal((await get(`/music/library/art/${ID}`)).status, 404);
  const w = await get(`/music/library/waveform/${ID}`);
  assert.deepEqual([...new Uint8Array(await w.arrayBuffer())], [1, 2, 3]);
  assert.equal(w.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal((await get(`/music/library/waveform/r2_native_${'b'.repeat(64)}`)).status, 404);
  assert.ok(onlyNew(calls));
});

test('until the new Worker can answer, the old one does, and the new one is asked again 5 minutes later', async () => {
  for (const [why, set] of [
    ['no catalog imported yet', (s) => (s.catalog = 409)],
    ['no signing key', (s) => (s.sign = 503)],
    ['signed out', (s) => (s.token = null)],
  ]) {
    const { get, state, calls } = load();
    set(state);
    const path = why === 'no signing key' ? `/music/library/audio/${ID}` : '/music/library.json';
    assert.equal(await (await get(path)).text(), 'old', why);
    const asked = calls.length;
    await get(path);
    assert.equal(calls.length, asked + 1, `${why}: straight to the old Worker for a while`);
    assert.ok(calls.at(-1).url.startsWith(OLD));
    state.now += 5 * 60_000 + 1;
    state.catalog = 200;
    state.sign = 200;
    state.token = 'th1_session';
    assert.notEqual(await (await get(path)).text(), 'old', `${why}: the new Worker again once ready`);
  }
});

test('a bucket that refuses the site (no CORS rule yet) falls back; a framed player never uses the session', async () => {
  const a = load();
  a.state.r2.push('cors');
  assert.equal(await (await a.get(`/music/library/audio/${ID}`)).text(), 'old');
  // (A failure without an answer is not a refusal: the next request asks the bucket again.)
  assert.equal((await a.get(`/music/library/audio/${ID}`)).status, 206);
  a.state.r2.push(403, 403);
  assert.equal(await (await a.get(`/music/library/audio/${ID}`)).text(), 'old', 'refused a fresh link: the old Worker');
  const asked = a.calls.length;
  await a.get(`/music/library/audio/${ID}`);
  assert.equal(a.calls.length, asked + 1, 'and only the old one for a while');
  const b = load({ top: false });
  assert.equal(await (await b.get('/music/library.json')).text(), 'old');
  assert.ok(b.calls.every((c) => c.url.startsWith(OLD)), 'nothing asked of the new Worker');
});

const ID2 = `r2_native_${'b'.repeat(64)}`;
const ID3 = `r2_native_${'d'.repeat(64)}`;
const signCalls = (calls) => calls.filter((c) => c.url === `${API}/v1/media/sign`);

test('the next songs are signed ahead in one request; a skip to one of them needs no signature', async () => {
  const { b, calls, get } = load();
  const audio = (id) => `${OLD}/music/library/audio/${id}`;
  await b.ahead([audio(ID), audio(ID2), audio(ID), `${OLD}/music/library/art/${ID3}`, 'not a url', `https://elsewhere.test/music/library/audio/${ID3}`, audio(ID3)], { frameType: 'top-level' });
  const signs = signCalls(calls);
  assert.equal(signs.length, 1);
  assert.deepEqual(JSON.parse(signs[0].body).refs, [`music:${ID}`, `music:${ID2}`, `music:${ID3}`]);
  assert.equal((await get(`/music/library/audio/${ID2}`, { Range: 'bytes=0-' })).status, 206);
  assert.equal(signCalls(calls).length, 1, 'the link signed ahead');
  await b.ahead([audio(ID), audio(ID2)], { frameType: 'top-level' });
  assert.equal(signCalls(calls).length, 1, 'links still fresh are not signed again');
  await b.ahead([`${OLD}/music/library/audio/r2_native_${'e'.repeat(64)}`], { frameType: 'nested' });
  assert.equal(signCalls(calls).length, 1, 'never for a framed player');
});

test('a link asked for twice at once is signed once; the session is read once a minute', async () => {
  const { calls, get, state } = load();
  let open;
  state.signGate = new Promise((r) => (open = r));
  const both = Promise.all([get(`/music/library/audio/${ID}`, { Range: 'bytes=0-1' }), get(`/music/library/audio/${ID}`, { Range: 'bytes=2-3' })]);
  await new Promise((r) => setTimeout(r, 5));
  open();
  assert.deepEqual((await both).map((r) => r.status), [206, 206]);
  assert.equal(signCalls(calls).length, 1);
  assert.equal(state.tokenReads, 1);
  state.now += 61_000;
  await get('/music/library.json');
  assert.equal(state.tokenReads, 2);
  assert.equal(state.apiReads, 1, 'the API address read once');
});

test('a network failure, a slow signature or a failed waveform sends only that request to the old Worker', async () => {
  const { calls, get, state } = load();
  state.sign = 'down';
  assert.equal(await (await get(`/music/library/audio/${ID}`)).text(), 'old');
  state.sign = 'hang';
  assert.equal(await (await get(`/music/library/audio/${ID}`)).text(), 'old', 'no signature in time');
  state.waveform = 500;
  assert.equal(await (await get(`/music/library/waveform/${ID}`)).text(), 'old');
  state.sign = 200;
  state.waveform = 0;
  assert.equal((await get(`/music/library/audio/${ID}`)).status, 206, 'the new Worker straight after');
  assert.equal((await get(`/music/library/waveform/${ID}`)).status, 200);
  // The API address that couldn't be read is read again.
  const next = load();
  next.state.api = new Error('offline');
  assert.equal(await (await next.get('/music/library.json')).text(), 'old');
  next.state.api = API;
  assert.equal((await next.get('/music/library.json')).status, 200);
  assert.equal(next.state.apiReads, 2);
  assert.ok(calls.some((c) => c.url.startsWith('https://r2.example.test/')));
});

test('the bucket’s answer must start in time, then streams as long as the player wants it', async () => {
  const { calls, get } = load();
  const player = new AbortController();
  assert.equal((await get(`/music/library/audio/${ID}`, { Range: 'bytes=0-' }, player.signal)).status, 206);
  const bucket = calls.at(-1);
  assert.ok(bucket.url.startsWith('https://r2.example.test/'));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(bucket.signal.aborted, false, 'past the deadline, the body still streams');
  player.abort();
  assert.equal(bucket.signal.aborted, true, 'the player letting go ends the bucket request');
});
