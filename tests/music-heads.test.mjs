// Song heads (frontend/music/src/library/heads.js): what is kept of the songs ahead, and the song that
// starts streaming. A streamed song's head carries no Ogg tail; a head downloading when its song starts
// streaming finishes (up to a wait) instead of being fetched twice, and is not stopped by a hold; a list
// given while a download starts is the one that counts. Fake caches and fetch; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioHeads, headOf } from '../frontend/music/src/library/heads.js';

const song = (n, o = {}) => ({ src: `https://example.test/song-${n}`, size: 1_000_000, durationMs: 200_000, mime: 'audio/ogg', ...o });

/** Caches in memory. */
function fakeCaches() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(k) { return m.get(String(k))?.clone() ?? undefined; },
        async put(k, r) { m.set(String(k), r); },
        async delete(k) { return m.delete(String(k)); },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
      };
    },
  };
}

/** A bucket whose answers wait until let go (`gate`), recording each range asked for. */
function fakeFetch() {
  const asked = [];
  let open = () => {};
  let gate = new Promise((r) => (open = r));
  const fetch = async (url, init) => {
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    asked.push(`${url.split('/').pop()} ${a}-${b}`);
    await new Promise((resolve, reject) => {
      gate.then(resolve);
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const n = Number(b) - Number(a) + 1;
    return new Response(new Uint8Array(n), { status: 206, headers: { 'content-range': `bytes ${a}-${b}/1000000`, 'content-length': String(n) } });
  };
  return { asked, fetch, release: () => open(), hold: () => (gate = new Promise((r) => (open = r))) };
}

const make = (f) => new AudioHeads({ caches: fakeCaches(), fetch: f.fetch, worker: () => ({ controller: { postMessage() {} } }), scope: 'https://example.test/music/' });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('a streamed song keeps no Ogg tail; one played from the element does', () => {
  assert.ok(headOf(song(1)).tail > 0);
  assert.equal(headOf(song(1), { tail: false }).tail, 0);
  assert.equal(headOf(song(1), { tail: false }).head, headOf(song(1)).head);
  assert.equal(headOf(song(1, { mime: 'audio/mpeg' })).tail, 0);
});

test('a head downloading when its song starts streaming finishes, is kept, and a hold for that song spares it', async () => {
  const f = fakeFetch();
  const heads = make(f);
  const a = headOf(song(1), { tail: false });
  heads.want([a]);
  await tick();
  assert.equal(heads.busy?.url, a.url);
  // Play starts: the song stalls at first (a hold that names it), then its stream settles on the head.
  heads.hold(true, a.url);
  const settled = heads.settle(a.url, 5_000);
  await tick();
  assert.equal(heads.busy?.url, a.url, 'not stopped by the hold');
  f.release();
  await settled;
  assert.ok(heads.kept.has(a.url), 'kept: the stream reads it from the phone');
  assert.deepEqual(f.asked, [`song-1 0-${a.head - 1}`], 'fetched once');
  assert.ok(!heads.wanted.some((w) => w.url === a.url), 'not fetched again');
});

test('a head that does not finish within the wait stops, and is not fetched again', async () => {
  const f = fakeFetch();
  const heads = make(f);
  const a = headOf(song(1), { tail: false });
  heads.want([a]);
  await tick();
  await heads.settle(a.url, 20);
  await tick();
  assert.equal(heads.busy, null);
  assert.ok(!heads.kept.has(a.url));
  assert.equal(f.asked.length, 1);
});

test('a hold stops the download of a song ahead', async () => {
  const f = fakeFetch();
  const heads = make(f);
  const b = headOf(song(2), { tail: false });
  heads.want([b], song(1).src);
  await tick();
  assert.equal(heads.busy?.url, b.url);
  heads.hold(true, song(1).src);
  await tick();
  assert.equal(heads.busy, null);
});

test('let go and given a new list at once, the downloads follow the new list', async () => {
  const f = fakeFetch();
  f.release();
  const heads = make(f);
  const a = headOf(song(1), { tail: false });
  heads.hold(true);
  await heads.want([a]);
  // The song starts; once its stream is ahead the next songs are wanted, in the same turn as the hold lets go.
  const b = headOf(song(2), { tail: false });
  heads.hold(false);
  await heads.want([b], a.url);
  await heads.pumping;
  assert.deepEqual(f.asked, [`song-2 0-${b.head - 1}`]);
});
