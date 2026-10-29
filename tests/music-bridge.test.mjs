// The ported player's data move (frontend/th/music/bridge.js, loaded by music/sw.js): the player's
// requests for its library, addressed to the old Worker, are answered from the new Worker (the
// catalog with its ETag, audio and art by signed links signed again near their end or on a 403, a
// waveform as bytes) and go to the old Worker as before while the new one can't answer (signed out,
// no catalog yet, no signing key, the bucket closed to the site, a framed player), asking again 5
// minutes later. Run in a plain VM with stubbed fetch, caches and session; no network.
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
  vm.runInNewContext(SOURCE, { self, URL, Headers, Response, Request, atob, Uint8Array, Symbol, JSON, Promise, Map });
  const b = self.thMusicBridge;
  b.use(OLD);
  const calls = [];
  const state = { now: 1_000_000, catalog: 200, sign: 200, r2: [], token, top, signed: 0 };
  const store = new Map();
  b.deps.now = () => state.now;
  b.deps.token = async () => state.token;
  b.deps.api = async () => API;
  b.deps.topLevel = async () => state.top;
  b.deps.caches = () => ({ open: async () => ({ match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r) }) });
  b.deps.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(typeof input === 'string' ? init.headers : input.headers);
    calls.push({ url, method: init.method ?? (typeof input === 'string' ? 'GET' : input.method), headers, body: init.body });
    if (url.startsWith(OLD)) return new Response('old', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    if (url === `${API}/v1/music/catalog`) {
      if (state.catalog !== 200) return new Response('{}', { status: state.catalog });
      if (headers.get('If-None-Match') === '"m1-x"') return new Response(null, { status: 304, headers: { ETag: '"m1-x"' } });
      return new Response('{"version":1,"tracks":[]}', { status: 200, headers: { ETag: '"m1-x"', 'Content-Type': 'application/json' } });
    }
    if (url === `${API}/v1/media/sign`) {
      if (state.sign !== 200) return new Response('{}', { status: state.sign });
      const [ref] = JSON.parse(init.body).refs;
      if (ref.endsWith('#art') && state.noArt) return Response.json({ items: [], errors: [{ ref, code: 'not_found' }] });
      state.signed++;
      return Response.json({ items: [{ ref, url: `https://r2.example.test/${encodeURIComponent(ref)}?n=${state.signed}`, expires_at: state.now + 3 * 3_600_000 }], errors: [] });
    }
    if (url.startsWith(`${API}/v1/music/waveforms/`))
      return url.endsWith(ID) ? Response.json({ id: ID, bars: btoa('\x01\x02\x03') }) : new Response('{}', { status: 404 });
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
  const get = (path, headers = {}) => b.answer(new Request(OLD + path, { headers }), { clientId: 'c1' });
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
  const b = load({ top: false });
  assert.equal(await (await b.get('/music/library.json')).text(), 'old');
  assert.ok(b.calls.every((c) => c.url.startsWith(OLD)), 'nothing asked of the new Worker');
});
