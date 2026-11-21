// frontend/podcasts/cache-first.js, how Podcasts' worker answers its page and files: from the cache
// at once when it has a copy (the network asked behind it, refreshing the copy for the next open),
// from the network when it has none (keeping what came), and from the cache when the network is
// down. Fake caches and fetch; no browser.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cacheFirst } from '../frontend/podcasts/cache-first.js';

let stores, fetched, net;
beforeEach(() => {
  stores = new Map();
  fetched = [];
  net = (url) => Promise.resolve(new Response(`new ${url}`));
  globalThis.caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return { match: async (k) => m.get(String(k))?.clone(), put: async (k, r) => void m.set(String(k), r) };
    },
  };
  globalThis.fetch = (req) => (fetched.push(String(req)), net(String(req)));
});
const event = () => { const e = { waits: [], waitUntil: (p) => e.waits.push(p) }; return e; };

test('a cached page answers at once; the network refreshes the copy behind it', async () => {
  (await caches.open('shell-v6')).put('/podcasts/', new Response('old page'));
  let release;
  net = (url) => new Promise((r) => { release = () => r(new Response(`new ${url}`)); });
  const e = event();
  const r = await cacheFirst('shell-v6', e, '/podcasts/?th-frame=x', '/podcasts/');
  assert.equal(await r.text(), 'old page', 'not waiting on the network');
  assert.deepEqual(fetched, ['/podcasts/?th-frame=x']);
  release();
  await Promise.all(e.waits);
  assert.equal(await (await (await caches.open('shell-v6')).match('/podcasts/')).text(), 'new /podcasts/?th-frame=x');
});

test('nothing cached: the network answers and fills the cache; network down: the copy answers', async () => {
  const r = await cacheFirst('shell-v6', event(), '/podcasts/app.js');
  assert.equal(await r.text(), 'new /podcasts/app.js');
  assert.ok(await (await caches.open('shell-v6')).match('/podcasts/app.js'));
  net = () => Promise.reject(new TypeError('offline'));
  const e = event();
  assert.equal(await (await cacheFirst('shell-v6', e, '/podcasts/app.js')).text(), 'new /podcasts/app.js');
  await Promise.all(e.waits);
});
