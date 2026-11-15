// Astra's service worker (frontend/astra/sw.js) without a browser: it runs in a vm context with an
// in-memory Cache Storage that outlives the worker (a restart is a new context on the same caches),
// fake clients and a static site the test changes from release to release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileHash } from '../scripts/astra/files.mjs';

const ORIGIN = 'https://site.example';
const SCOPE = `${ORIGIN}/astra/`;
const SOURCE = readFileSync(new URL('../frontend/astra/sw.js', import.meta.url), 'utf8');

/** Cache Storage in memory; keys are full addresses (relative ones resolve against the worker's). */
function fakeCaches() {
  const all = new Map();
  const norm = (r) => new URL(typeof r === 'string' ? r : r.url, `${SCOPE}sw.js`).href;
  const bare = (u) => u.split('?')[0];
  const cache = (m) => ({
    async match(r, o) { const u = norm(r); const hit = m.get(u) ?? (o?.ignoreSearch ? [...m].find(([k]) => bare(k) === bare(u))?.[1] : undefined); return hit && basic(hit.clone()); },
    async put(r, res) { m.set(norm(r), new Response(await res.arrayBuffer(), { headers: res.headers })); },
    async keys() { return [...m.keys()].map((url) => ({ url })); },
    async delete(r) { return m.delete(norm(r)); },
  });
  return {
    all,
    async open(name) { if (!all.has(name)) all.set(name, new Map()); return cache(all.get(name)); },
    async has(name) { return all.has(name); },
    async delete(name) { return all.delete(name); },
    async keys() { return [...all.keys()]; },
  };
}
const basic = (res) => Object.defineProperty(res, 'type', { value: 'basic' });

/** The site: `release` names it; `files` are Astra's files by path; `fail` paths answer 500. */
function site(release, files, { list = true, legacy = false } = {}) {
  return { release, files, list, legacy, fail: new Set(), asked: [] };
}
const listOf = (s) => ({ tree: s.release, files: Object.fromEntries(Object.entries(s.files).map(([p, b]) => [p, fileHash(b)])) });

function worker(caches, web) {
  const listeners = new Map(), told = [];
  const self = {
    location: { origin: ORIGIN },
    registration: { scope: SCOPE },
    addEventListener: (type, f) => listeners.set(type, f),
    clients: { list: [], matchAll: async () => self.clients.list, claim: async () => {} },
    skipWaiting: async () => {},
  };
  const fetch = async (r) => {
    const url = new URL(typeof r === 'string' || r instanceof URL ? r : r.url);
    const s = web.site;
    s.asked.push(url.pathname + url.search);
    if (url.pathname === '/release.json') return basic(Response.json(s.legacy ? { commit: s.release } : { commit: 'c0ffee', components: { astra: { tree: s.release } } }));
    const path = url.pathname.replace(/^\/astra\//, '').replace(/(^|\/)$/, '$1index.html');
    if (path === 'files.json') return basic(s.list ? Response.json(s.listFor ?? listOf(s)) : new Response('', { status: 404 }));
    if (s.fail.has(path)) return basic(new Response('', { status: 500 }));
    return basic(path in s.files ? new Response(s.files[path]) : new Response('', { status: 404 }));
  };
  const context = vm.createContext({ self, fetch, caches, crypto: globalThis.crypto, URL, Response, Headers, JSON, Promise, Date: { now: () => Date.now() + (web.skew ?? 0) }, Map, Set, Object, Uint8Array, setTimeout, Error });
  vm.runInContext(SOURCE, context);
  const jobs = [];
  const run = async (type, event) => {
    let answer;
    listeners.get(type)({ ...event, respondWith: (p) => { answer = p; }, waitUntil: (p) => jobs.push(p) });
    const response = await answer;
    while (jobs.length) await jobs.shift();
    return response;
  };
  const client = (id) => ({ id, url: SCOPE, postMessage: (m) => m.type === 'astra-updated' && told.push(id) });
  return {
    self, told, context,
    open: async (id, path = '') => { self.clients.list.push(client(id)); return text(await run('fetch', { request: req(SCOPE + path, 'navigate'), resultingClientId: id, clientId: '' })); },
    get: async (id, path) => text(await run('fetch', { request: req(SCOPE + path, 'no-cors'), clientId: id, resultingClientId: '' })),
    close: (id) => { self.clients.list = self.clients.list.filter((c) => c.id !== id); },
    activate: () => run('activate', {}),
    respond: (request, ids) => run('fetch', { request, clientId: '', resultingClientId: '', ...ids }),
    precache: (id, paths) => run('message', { data: { type: 'astra-precache', urls: paths.map((p) => SCOPE + p) }, source: client(id) }),
  };
}
const req = (url, mode, destination = mode === 'navigate' ? 'document' : '') => ({ url, mode, destination, method: 'GET', headers: new Headers() });
const text = async (res) => res && res.text();
const APP = { 'index.html': 'page A', 'src/main.js': 'main A', 'src/player/player.js': 'export const a = 1;', 'vendor/big.wasm': 'wasm 1', 'README.md': 'docs' };

/** A first visit on release A (the page loaded before the worker), then a saved open. */
async function started() {
  const caches = fakeCaches(), web = { site: site('A', { ...APP }) };
  const w = worker(caches, web);
  await w.activate();
  await w.precache('p0', ['', 'src/main.js', 'vendor/big.wasm']);
  return { caches, web, w };
}

test('the first visit saves the app whole (not vendor/ it did not use, nor docs) under its release', async () => {
  const { caches } = await started();
  const keys = [...caches.all.get('astra-app-A').keys()].sort();
  assert.deepEqual(keys, [SCOPE, `${SCOPE}src/main.js`, `${SCOPE}src/player/player.js`, `${SCOPE}vendor/big.wasm`]);
});

test('a page keeps its release after an update and a worker restart; unchanged files are copied, not fetched', async () => {
  const { caches, web, w } = await started();
  assert.equal(await w.open('p1'), 'page A');
  web.site = site('B', { ...APP, 'index.html': 'page B', 'src/player/player.js': 'export const b = 2;' });
  await w.open('p2'); // the visit that finds B and saves it in the background
  assert.deepEqual(web.site.asked.filter((p) => p.startsWith('/astra/')).sort(), ['/astra/', '/astra/files.json', '/astra/src/player/player.js'], 'only the changed files');
  assert.deepEqual(w.told.sort(), ['p1', 'p2'], 'pages on A are told');
  const again = worker(caches, web); // Chrome stopped the idle worker
  again.self.clients.list = w.self.clients.list;
  assert.equal(await again.get('p1', 'src/player/player.js'), 'export const a = 1;', 'p1 started on A gets A');
  assert.equal(await again.open('p3'), 'page B');
  assert.equal(await again.get('p3', 'src/player/player.js'), 'export const b = 2;');
  assert.equal(await again.get('p3', 'vendor/big.wasm'), 'wasm 1', 'carried over');
});

test('an update with a file that fails is not used, not told, and finishes later from where it stopped', async () => {
  const { caches, web, w } = await started();
  web.site = site('B', { ...APP, 'src/main.js': 'main B', 'src/player/player.js': 'export const b = 2;' });
  web.site.fail.add('src/player/player.js');
  await w.open('p1');
  assert.equal(w.told.length, 0);
  assert.equal(await w.get('p1', 'src/main.js'), 'main A', 'still A');
  web.site.fail.clear(); web.site.asked = [];
  await w.open('p2');
  assert.deepEqual(web.site.asked.filter((p) => p.startsWith('/astra/src')), ['/astra/src/player/player.js'], 'main.js was saved by the first try');
  assert.equal(await w.open('p3'), 'page A');
  assert.equal(await w.get('p3', 'src/main.js'), 'main B');
});

test('a list or a file that is another release\'s (a deploy part-way) stops the update', async () => {
  const { web, w } = await started();
  web.site = site('B', { ...APP, 'src/main.js': 'main B' });
  web.site.listFor = { ...listOf(web.site), tree: 'C' };
  await w.open('p1');
  web.site.listFor = { tree: 'B', files: { ...listOf(web.site).files, 'src/main.js': fileHash('main C') } };
  await w.open('p2');
  assert.equal(w.told.length, 0);
  assert.equal(await w.get('p2', 'src/main.js'), 'main A');
});

test('after an update, only the current, the previous and open pages\' releases stay', async () => {
  const { caches, web, w } = await started();
  await w.open('p1');
  caches.all.set('astra-app-cut-short', new Map());
  for (const r of ['B', 'C', 'D']) { web.site = site(r, { ...APP, 'src/main.js': `main ${r}` }); await w.open(`on-${r}`); }
  // Each page opened on the release before the one it found: A (p1, on-B), B (on-C), C (on-D).
  assert.deepEqual([...caches.all.keys()].filter((n) => n.startsWith('astra-app-')).sort(), ['astra-app-A', 'astra-app-B', 'astra-app-C', 'astra-app-D']);
  assert.equal(await w.get('p1', 'src/main.js'), 'main A');
  for (const id of ['p1', 'on-B', 'on-C', 'on-D']) w.close(id);
  web.skew = 120_000; // a page being opened is kept for a minute before it is listed
  web.site = site('E', { ...APP, 'src/main.js': 'main E' });
  await w.open('on-E');
  assert.deepEqual([...caches.all.keys()].filter((n) => n.startsWith('astra-app-')).sort(), ['astra-app-D', 'astra-app-E']);
});

test('a page\'s query is never part of a key; old keys with a query go on activation', async () => {
  const { caches, web, w } = await started();
  caches.all.get('astra-app-A').set(`${SCOPE}lab/?src=https%3A%2F%2Fcdn.example%2Fa.m3u8%3Ftoken%3Dx`, new Response('old'));
  await w.activate();
  web.site.files['lab/index.html'] = 'lab';
  assert.equal(await w.open('p1', 'lab/?src=https%3A%2F%2Fcdn.example%2Fb.m3u8'), 'lab');
  assert.ok([...caches.all.get('astra-app-A').keys()].every((k) => !k.includes('?')));
  web.site = site('B', { ...APP, 'lab/index.html': 'lab B' });
  await w.open('p2');
  assert.ok(web.site.asked.every((p) => !p.includes('?')), 'nothing re-asked with a query');
});

test('a site without lists (release.json with a commit only) works as before', async () => {
  const caches = fakeCaches(), web = { site: site('c1', { ...APP }, { list: false, legacy: true }) };
  const w = worker(caches, web);
  await w.precache('p0', ['', 'src/main.js']);
  assert.deepEqual([...caches.all.get('astra-app-c1').keys()].sort(), [SCOPE, `${SCOPE}src/main.js`]);
  web.site = site('c2', { ...APP, 'src/main.js': 'main 2' }, { list: false, legacy: true });
  await w.open('p1');
  assert.equal(await w.open('p2'), 'page A');
  assert.equal(await w.get('p2', 'src/main.js'), 'main 2');
});

test('the pages it serves are cross-origin isolated, the workers they start get COEP, nothing else does', async () => {
  const caches = fakeCaches(), web = { site: site('A', { ...APP, 'lab/index.html': 'lab', 'src/w.js': 'worker' }) };
  const w = worker(caches, web);
  const policy = (res) => [res.headers.get('cross-origin-opener-policy'), res.headers.get('cross-origin-embedder-policy')];
  const isolatedPage = ['same-origin', 'credentialless'];
  // The first page from the network (it is saved as it loads), then from the saved copy, and the lab.
  const first = await w.respond(req(SCOPE, 'navigate'), { resultingClientId: 'p1' });
  assert.deepEqual(policy(first), isolatedPage);
  assert.equal(await first.text(), 'page A', 'the page itself, whole');
  assert.equal(await (await caches.open('astra-app-A')).match(SCOPE).then((r) => r.text()), 'page A', 'and saved whole');
  assert.deepEqual(policy(await w.respond(req(SCOPE, 'navigate'), { resultingClientId: 'p2' })), isolatedPage, 'from the saved copy');
  assert.deepEqual(policy(await w.respond(req(`${SCOPE}lab/?src=x`, 'navigate'), { resultingClientId: 'p3' })), isolatedPage, 'the lab');
  assert.deepEqual(policy(await (await caches.open('astra-app-A')).match(SCOPE)), [null, null], 'saved without them: added as served');
  // A worker the page starts gets COEP alone; its other files nothing; a page that is not there nothing.
  assert.deepEqual(policy(await w.respond(req(`${SCOPE}src/w.js`, 'same-origin', 'worker'), { clientId: 'p2', resultingClientId: 'w1' })), [null, 'credentialless']);
  assert.deepEqual(policy(await w.respond(req(`${SCOPE}src/main.js`, 'cors', 'script'), { clientId: 'p2' })), [null, null]);
  assert.deepEqual(policy(await w.respond(req(`${SCOPE}nowhere/`, 'navigate'), { resultingClientId: 'p4' })), [null, null]);
});
