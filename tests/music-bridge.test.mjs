// The ported player's data move (frontend/th/music/bridge.js, loaded by music/sw.js): the player's
// requests for its library, addressed to the old Worker, are answered from the new Worker (the
// catalog with its ETag, audio and art by signed links signed again near their end or on a 403, a
// waveform as bytes). Nothing ever goes to the old Worker (MIGRATION.md §8): while the new one can't
// answer (signed out, no catalog yet, no signing key, the bucket refusing a fresh link, a framed
// player) the player gets that refusal as it is, and any other address on the old origin is a 404. A
// network failure or a slow answer never goes there either: it is tried once more with longer
// waits (reusing a link already signed), then answered with a network error within ANSWER_MS. The next songs'
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
    calls.push({ url, method: init.method ?? (typeof input === 'string' ? 'GET' : input.method), headers, body: init.body, signal: init.signal, cache: init.cache });
    const hang = () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    if (url.startsWith(OLD)) return new Response('old', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    if (url.split('?')[0] === `${API}/v1/music/catalog`) {
      if (state.catalog === 'hang') return hang();
      if (state.catalog !== 200) return new Response('{}', { status: state.catalog });
      // Answers queued by a test: {status: 304, etag} or {body, etag}.
      const next = state.catalogs?.shift();
      if (next?.status === 304) return new Response(null, { status: 304, headers: { ETag: next.etag } });
      if (next) return new Response(JSON.stringify(next.body), { status: 200, headers: { ETag: next.etag, 'Content-Type': 'application/json' } });
      if (headers.get('If-None-Match') === '"m1-x"') return new Response(null, { status: 304, headers: { ETag: '"m1-x"' } });
      return new Response('{"version":1,"tracks":[]}', { status: 200, headers: { ETag: '"m1-x"', 'Content-Type': 'application/json' } });
    }
    if (url === `${API}/v1/media/sign`) {
      const sign = state.signs?.shift() ?? state.sign;
      if (sign === 'down') throw new TypeError('Failed to fetch');
      if (sign === 'hang') return hang();
      if (sign !== 200) return new Response('{}', { status: sign });
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
      if (state.waveform === 'hang') return hang();
      if (state.waveform) return new Response('{}', { status: state.waveform });
      return url.endsWith(ID) ? Response.json({ id: ID, bars: btoa('\x01\x02\x03') }) : new Response('{}', { status: 404 });
    }
    if (url.startsWith('https://r2.example.test/')) {
      const next = state.r2.shift() ?? 206;
      if (next === 'cors') throw new TypeError('Failed to fetch');
      if (next === 'hang') return hang();
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

test('every address on the old Worker’s origin is the bridge’s; one that isn’t a library file is a 404, never fetched', async () => {
  const { b, calls, get } = load();
  assert.equal(b.handles(new URL(`${OLD}/music/library.json`)), true);
  assert.equal(b.handles(new URL(`${OLD}/music/library/audio/${ID}`)), true);
  assert.equal(b.handles(new URL(`${OLD}/music/uploads/register`)), true);
  assert.equal(b.handles(new URL(`https://elsewhere.test/music/library.json`)), false);
  assert.equal((await get('/music/uploads/register')).status, 404);
  assert.equal((await get('/music/library.json?v=2')).status, 404);
  assert.equal((await b.answer(new Request(`${OLD}/music/library.json`, { method: 'POST', body: '{}' }), { clientId: 'c1' })).status, 404);
  assert.deepEqual(calls, [], 'nothing fetched');
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
  assert.equal(calls.at(-1).cache, 'no-store', 'never through the HTTP cache: no If-Range round trip before the bytes');
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

test('until the new Worker can answer, the player gets its refusal as it is, never the old Worker; ready, the new one answers at once', async () => {
  for (const [why, set, status, words] of [
    ['no catalog imported yet', (s) => (s.catalog = 409), 409, 'No songs yet.'],
    ['no signing key', (s) => (s.sign = 503), 503, "Your songs can't be reached right now."],
    ['signed out', (s) => (s.token = null), 401, 'Sign in to play your songs.'],
  ]) {
    const { get, state, calls } = load();
    set(state);
    const path = why === 'no signing key' ? `/music/library/audio/${ID}` : '/music/library.json';
    const r = await get(path);
    assert.equal(r.status, status, why);
    assert.deepEqual(await r.json(), { error: words }, why);
    assert.ok(onlyNew(calls), `${why}: no old-Worker call`);
    state.catalog = 200;
    state.sign = 200;
    state.token = 'th1_session';
    state.now += 60_001;
    assert.ok((await get(path)).ok, `${why}: the new Worker at once once ready`);
    assert.ok(onlyNew(calls), `${why}: still no old-Worker call`);
  }
});

test('a bucket that refuses a fresh link is that refusal; one that fails as a network would is asked again; a framed player never uses the session', async () => {
  const a = load();
  a.state.r2.push('cors', 'cors');
  assert.equal((await a.get(`/music/library/audio/${ID}`)).type, 'error', 'a failure without an answer is not a refusal: a network error');
  assert.equal((await a.get(`/music/library/audio/${ID}`)).status, 206, 'the next request asks the bucket again');
  a.state.r2.push(403, 403);
  assert.equal((await a.get(`/music/library/audio/${ID}`)).status, 403, 'refused a fresh link: that refusal');
  assert.equal((await a.get(`/music/library/audio/${ID}`)).status, 206, 'and the next request asks again');
  assert.ok(onlyNew(a.calls), 'no old-Worker call');
  const b = load({ top: false });
  assert.equal((await b.get('/music/library.json')).status, 401, 'a frame home did not open: signed out to it');
  assert.deepEqual(b.calls, [], 'nothing asked of either Worker');
});

// The catalog in changes (GET /v1/music/catalog?since=<generatedAt of the copy kept>).
const song = (id, title) => ({ id, metadata: { title } });
const FULL = { version: 1, kind: 'r2-library', complete: true, count: 2, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [song('a', 'One'), song('b', 'Two')] };
const delta = (since, generatedAt, count, tracks, removed = []) => ({ version: 1, kind: 'r2-library-delta', complete: true, count, since, generatedAt, tracks, removed });
const catalogCalls = (calls) => calls.filter((c) => c.url.startsWith(`${API}/v1/music/catalog`));
const sinceOf = (c) => new URL(c.url).searchParams.get('since');

test('a changed catalog comes as its changes, merged into the copy kept: the player still gets the whole catalog', async () => {
  const { calls, get, state } = load();
  const T2 = '2026-11-02T00:00:00.000Z';
  const T3 = '2026-11-03T00:00:00.000Z';
  state.catalogs = [
    { body: FULL, etag: '"m1-1"' },
    { body: delta(FULL.generatedAt, T2, 3, [song('b', 'Two, again'), song('c', 'Three')]), etag: '"m1-2"' },
    { body: delta(T2, T3, 2, [], ['a']), etag: '"m1-3"' },
    { status: 304, etag: '"m1-3"' },
  ];
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL);
  assert.equal(sinceOf(catalogCalls(calls)[0]), null, 'nothing kept: the whole catalog, no since');
  const r = await get('/music/library.json');
  const asked = catalogCalls(calls)[1];
  assert.equal(sinceOf(asked), FULL.generatedAt, 'since the copy kept');
  assert.equal(asked.headers.get('If-None-Match'), '"m1-1"', 'with its ETag');
  assert.equal(r.headers.get('ETag'), '"m1-2"');
  assert.equal(r.headers.get('TH-Generated'), null, 'what the bridge keeps beside the copy is its own');
  const whole = await r.json();
  assert.equal(whole.kind, 'r2-library', 'the whole catalog, as the player reads it');
  assert.equal(whole.count, 3);
  assert.equal(whole.generatedAt, T2);
  assert.deepEqual(whole.tracks.map((t) => [t.id, t.metadata.title]), [['a', 'One'], ['b', 'Two, again'], ['c', 'Three']], 'changed in place, new ones after');
  const less = await (await get('/music/library.json')).json();
  assert.equal(sinceOf(catalogCalls(calls)[2]), T2);
  assert.deepEqual(less.tracks.map((t) => t.id), ['b', 'c'], 'a removed song is gone');
  assert.equal(less.count, 2);
  const same = await get('/music/library.json');
  assert.equal(same.status, 200);
  assert.equal(catalogCalls(calls)[3].headers.get('If-None-Match'), '"m1-3"');
  assert.deepEqual(await same.json(), less, 'unchanged: a 304, the copy kept');
  assert.equal(catalogCalls(calls).length, 4, 'one request each time');
  assert.ok(onlyNew(calls));
});

test('changes that don’t add up to the count, or a kept copy that can’t be read, bring the whole catalog again; a whole answer is kept as it is', async () => {
  const { calls, get, state, store } = load();
  const FULL2 = { ...FULL, count: 3, generatedAt: '2026-11-04T00:00:00.000Z', tracks: [...FULL.tracks, song('c', 'Three')] };
  state.catalogs = [
    { body: FULL, etag: '"m1-1"' },
    { body: delta(FULL.generatedAt, FULL2.generatedAt, 5, [song('c', 'Three')]), etag: '"m1-2"' },
    { body: FULL2, etag: '"m1-4"' },
  ];
  await get('/music/library.json');
  const r = await get('/music/library.json');
  assert.deepEqual(await r.json(), FULL2, 'three songs, not five: the whole catalog');
  assert.equal(r.headers.get('ETag'), '"m1-4"');
  const [, mismatch, full] = catalogCalls(calls);
  assert.equal(sinceOf(mismatch), FULL.generatedAt);
  assert.equal(sinceOf(full), null, 'asked again without since');
  assert.equal(full.headers.get('If-None-Match'), null, 'and without the ETag');
  // The copy kept can't be read: the changes can't be merged.
  store.set('/music/th-catalog.json', new Response('not json', { headers: { ETag: '"m1-4"', 'TH-Generated': FULL2.generatedAt } }));
  state.catalogs.push({ body: delta(FULL2.generatedAt, '2026-11-05T00:00:00.000Z', 3, []), etag: '"m1-5"' }, { body: FULL2, etag: '"m1-4"' });
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL2);
  assert.equal(sinceOf(catalogCalls(calls).at(-1)), null);
  // Asked since, the Worker may answer with the whole catalog: kept as it comes.
  const FULL3 = { ...FULL, generatedAt: '2026-11-06T00:00:00.000Z' };
  state.catalogs.push({ body: FULL3, etag: '"m1-6"' });
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL3);
  assert.equal(sinceOf(catalogCalls(calls).at(-1)), FULL2.generatedAt);
  state.catalogs.push({ status: 304, etag: '"m1-6"' });
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL3);
  assert.equal(sinceOf(catalogCalls(calls).at(-1)), FULL3.generatedAt, 'the next ask is since the whole one kept');
  assert.ok(onlyNew(calls));
});

test('a copy kept without its time (the app before `since`) has it read from its body once and recorded; never through the HTTP cache', async () => {
  const { calls, get, state, store } = load();
  // Kept by the app before: its ETag, no TH-Generated.
  store.set('/music/th-catalog.json', new Response(JSON.stringify(FULL), { headers: { 'Content-Type': 'application/json', ETag: '"m1-1"' } }));
  state.catalogs = [{ status: 304, etag: '"m1-1"' }, { status: 304, etag: '"m1-1"' }];
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL);
  const [first] = catalogCalls(calls);
  assert.equal(sinceOf(first), FULL.generatedAt, 'since the time in the copy');
  assert.equal(first.headers.get('If-None-Match'), '"m1-1"');
  assert.equal(first.cache, 'no-store', 'the browser never revalidates it on its own, without since');
  assert.equal(store.get('/music/th-catalog.json').headers.get('TH-Generated'), FULL.generatedAt, 'recorded beside the copy');
  assert.deepEqual(await store.get('/music/th-catalog.json').clone().json(), FULL, 'the copy kept as it was');
  assert.deepEqual(await (await get('/music/library.json')).json(), FULL);
  assert.equal(sinceOf(catalogCalls(calls)[1]), FULL.generatedAt);
});

test('generatedAt is found past the head too: a long head, or the time last', async () => {
  for (const body of [
    `{"version":1,"kind":"r2-library","note":"${'x'.repeat(5000)}","count":0,"tracks":[],"generatedAt":"2026-11-07T00:00:00.000Z"}`,
    `{"version":1,"kind":"r2-library","count":1,"tracks":[{"id":"a","path":"${'y'.repeat(6000)}"}],"generatedAt":"2026-11-07T00:00:00.000Z"}`,
  ]) {
    const { calls, get, state, store } = load();
    state.catalogs = [{ body: JSON.parse(body), etag: '"m1-7"' }, { status: 304, etag: '"m1-7"' }];
    await get('/music/library.json');
    assert.equal(store.get('/music/th-catalog.json').headers.get('TH-Generated'), '2026-11-07T00:00:00.000Z');
    // And from the body of a copy kept without it.
    store.set('/music/th-catalog.json', new Response(body, { headers: { ETag: '"m1-7"' } }));
    await get('/music/library.json');
    assert.equal(sinceOf(catalogCalls(calls).at(-1)), '2026-11-07T00:00:00.000Z');
  }
});

test('asks at once are asked one after another: the later ones since the copy the first kept', async () => {
  const { calls, get, state, store } = load();
  state.catalogs = [{ body: FULL, etag: '"m1-1"' }, { status: 304, etag: '"m1-1"' }, { status: 304, etag: '"m1-1"' }];
  const all = await Promise.all([get('/music/library.json'), get('/music/library.json'), get('/music/library.json')]);
  for (const r of all) assert.deepEqual(await r.json(), FULL);
  const asks = catalogCalls(calls);
  assert.deepEqual(asks.map(sinceOf), [null, FULL.generatedAt, FULL.generatedAt]);
  assert.deepEqual(asks.map((c) => c.headers.get('If-None-Match')), [null, '"m1-1"', '"m1-1"']);
  assert.equal(store.get('/music/th-catalog.json').headers.get('TH-Generated'), FULL.generatedAt);
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

test('a network failure, a slow signature or a failed waveform is a network error, never the old Worker', async () => {
  const { calls, get, state } = load();
  state.sign = 'down';
  assert.equal((await get(`/music/library/audio/${ID}`)).type, 'error');
  state.sign = 'hang';
  assert.equal((await get(`/music/library/audio/${ID}`)).type, 'error', 'no signature in time');
  state.waveform = 500;
  assert.equal((await get(`/music/library/waveform/${ID}`)).type, 'error');
  assert.ok(onlyNew(calls), 'no old-Worker call');
  state.sign = 200;
  state.waveform = 0;
  assert.equal((await get(`/music/library/audio/${ID}`)).status, 206, 'the new Worker straight after');
  assert.equal((await get(`/music/library/waveform/${ID}`)).status, 200);
  // The API address that couldn't be read is read again.
  const next = load();
  next.state.api = new Error('offline');
  assert.equal((await next.get('/music/library.json')).type, 'error');
  assert.ok(onlyNew(next.calls));
  next.state.api = API;
  assert.equal((await next.get('/music/library.json')).status, 200);
  assert.equal(next.state.apiReads, 3, 'once per try, then again');
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

// The clocks run 100 times faster here: 4 s is 40 ms.
const elapsed = async (f) => {
  const t0 = performance.now();
  const out = await f();
  return [out, performance.now() - t0];
};

test('a slow signature is tried once more with a longer wait, then plays: no old-Worker request', async () => {
  const { calls, get, state } = load();
  state.signs = ['hang', 200];
  const r = await get(`/music/library/audio/${ID}`, { Range: 'bytes=0-' });
  assert.equal(r.status, 206);
  assert.equal(signCalls(calls).length, 2);
  assert.ok(onlyNew(calls));
});

test('a slow bucket is asked once more with the link already signed', async () => {
  const { calls, get, state } = load();
  state.r2.push('hang', 206);
  const [r, ms] = await elapsed(() => get(`/music/library/audio/${ID}`, { Range: 'bytes=0-' }));
  assert.equal(r.status, 206);
  assert.equal(signCalls(calls).length, 1, 'no second signature');
  assert.equal(calls.filter((c) => c.url.startsWith('https://r2.example.test/')).length, 2);
  assert.ok(ms >= 35, 'the first try waited its 4 s');
  assert.ok(onlyNew(calls));
  // A song already signed starts its bytes with no extra round trip.
  const before = calls.length;
  await get(`/music/library/audio/${ID}`, { Range: 'bytes=5-' });
  assert.deepEqual(calls.slice(before).map((c) => new URL(c.url).host), ['r2.example.test']);
});

test('both tries failing is a network error within the bound, never the old Worker', async () => {
  for (const [why, set, path] of [
    ['signature', (s) => (s.sign = 'hang'), `/music/library/audio/${ID}`],
    ['bucket', (s) => s.r2.push('hang', 'hang'), `/music/library/audio/${ID}`],
    ['signature then bucket', (s) => ((s.signs = ['hang', 200]), s.r2.push('hang')), `/music/library/audio/${ID}`],
    ['catalog', (s) => (s.catalog = 'hang'), '/music/library.json'],
    ['waveform', (s) => (s.waveform = 'hang'), `/music/library/waveform/${ID}`],
  ]) {
    const { calls, get, state } = load();
    set(state);
    const [r, ms] = await elapsed(() => get(path));
    assert.equal(r.type, 'error', `${why}: a network error (the player retries it), not a 404`);
    assert.ok(onlyNew(calls), `${why}: no old-Worker request`);
    assert.ok(ms < 240 + 150, `${why}: heard within ANSWER_MS (24 s), took ${Math.round(ms * 100)} ms`);
  }
});

test('a refusal is answered at once, with no try again and no old-Worker request', async () => {
  const { calls, get, state } = load();
  state.sign = 401;
  assert.equal((await get(`/music/library/audio/${ID}`)).status, 401);
  assert.equal(signCalls(calls).length, 1);
  assert.ok(onlyNew(calls));
});
