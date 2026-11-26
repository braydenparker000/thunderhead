// Music's files kept for their release (th/music/release.js, music/sw.js; PERFORMANCE.md §3.1): the safety
// rules. Without a complete kept set a page and /release.json come from the network and a new release takes
// over on the next open; a file is kept only for the release still live when it arrives; a set lives at most
// 7 days; with no answer from /release.json (it says so: `down()`), or on any cache error, the worker's own
// way answers. Once a page has started from a complete set (`booted`), an open of the same release asks the
// network for nothing but /release.json, in the background; a new release is saved whole and the next open
// takes it whole; a set a page did not start from, or one missing a file of another release, sends the next
// open the network's way.
// The clock is the test's: `now` and `wait` are fakes, so no test waits for time to pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../frontend/th/music/release.js', import.meta.url), 'utf8');
const ORIGIN = 'https://site.example.test';
const DAY = 86_400_000;

/** Fake Cache Storage, keyed by URL. `broken` makes every call throw. */
function fakeCaches() {
  const stores = new Map();
  const io = {
    broken: false,
    stores,
    async open(name) {
      if (io.broken) throw new Error('storage gone');
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
      return {
        match: async (r) => { if (io.broken) throw new Error('storage gone'); return m.get(key(r))?.clone(); },
        put: async (r, res) => { if (io.broken) throw new Error('storage gone'); m.set(key(r), res); },
        delete: async (r) => m.delete(key(r)),
      };
    },
    async delete(name) { return stores.delete(name); },
  };
  return io;
}

/** The module with a network the test answers: `files` path → body, `live` the release, `down` no signal,
 * `hang` /release.json never answers, `held` a path whose answer waits for `release()`. */
function setup() {
  const net = { live: 'aaa', down: false, hang: false, asked: [], held: '', release: null, files: new Map([['/music/src/app.js', 'v1 app'], ['/music/app.css', 'v1 css'], ['/music/', '<html>v1</html>']]) };
  const fetch = async (r) => {
    const url = new URL(typeof r === 'string' ? r : r.url, ORIGIN);
    net.asked.push(url.pathname);
    if (net.down) throw new TypeError('Failed to fetch');
    if (url.pathname === '/release.json') {
      if (net.hang) return new Promise(() => {});
      return new Response(JSON.stringify({ commit: net.live, staged_at: 't' }), { status: 200 });
    }
    if (url.pathname === net.held) await new Promise((ok) => { net.release = ok; });
    const body = net.files.get(url.pathname);
    const res = new Response(body ?? 'missing', { status: body ? 200 : 404 });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const clock = { t: Date.UTC(2026, 10, 22), waits: [] };
  const caches = fakeCaches();
  const context = vm.createContext({ URL, Response, Request, AbortController, Symbol, Map, Set, Promise, JSON, Number, setTimeout });
  vm.runInContext(SOURCE, context);
  const wait = (ms) => { clock.waits.push(ms); return Promise.resolve(); };
  // The wait for /release.json resolves at once (as if its 3 s had passed) only when the network hangs.
  const release = context.thMusicRelease.make({ fetch, caches, waitMs: 3000, now: () => clock.t, wait: (ms) => (net.hang ? wait(ms) : new Promise(() => {})) });
  return { net, caches, release, clock };
}
const file = (path, o = {}) => new Request(`${ORIGIN}${path}`, o);
const text = async (r) => (r ? r.text() : null);
/** A file as kept in the current set, or undefined. */
const stored = async (caches, release, path) => {
  const s = await release.state();
  return caches.stores.get(release.NAME)?.get(release.keyOf(`${ORIGIN}${path}`, s.current))?.clone().text();
};
const page = (path = '/music/') => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate', destination: 'document', headers: new Headers() });
/** A load the network's way: the open, its page from the network (kept), its files, and the page's start. */
async function networkLoad(release, client, files = ['/music/src/app.js', '/music/app.css']) {
  assert.equal(await release.open(page(), client), null, 'the network\'s way');
  const res = new Response('<html>v1</html>');
  Object.defineProperty(res, 'type', { value: 'basic' });
  await release.keepPage(page(), res, client);
  for (const f of files) await release.answer(file(f), undefined, client);
  await release.booted(client);
}

test('a file of the same release comes from its cache with no request; a new release takes over on the next open', async () => {
  const { net, release } = setup();
  release.check();
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v1 app');
  net.asked.length = 0;
  release.check();
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v1 app');
  assert.deepEqual(net.asked, ['/release.json'], 'only the release was asked');
  net.live = 'bbb';
  net.files.set('/music/src/app.js', 'v2 app');
  release.check();
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v2 app', 'the new release, from the network');
});

test('a page, a navigation and /release.json are never answered from the cache', async () => {
  const { release } = setup();
  release.check();
  for (const r of [file('/music/'), file('/music/index.html'), file('/release.json'), { url: `${ORIGIN}/music/src/app.js`, method: 'GET', mode: 'navigate', destination: 'document', headers: new Headers() }]) {
    assert.equal(await release.answer(r), null, `${r.url} goes the worker's own way`);
  }
});

test('no signal: nothing is answered here and down() says so; a release.json that answers with no release is not "down"', async () => {
  const { net, release } = setup();
  net.down = true;
  release.check();
  assert.equal(await release.answer(file('/music/src/app.js')), null);
  assert.equal(release.down(), true);
  net.down = false;
  net.live = '';
  release.check();
  assert.equal(await release.answer(file('/music/src/app.js')), null);
  assert.equal(release.down(), false, 'the network answered');
});

test('a release.json that never answers: one wait of 3 s, then null and down(), so the worker goes to its offline copies', async () => {
  const { net, release, clock } = setup();
  net.hang = true;
  release.check();
  assert.equal(await release.answer(file('/music/src/app.js')), null);
  assert.equal(await release.answer(file('/music/app.css')), null);
  assert.deepEqual(clock.waits, [3000], 'the files share the one wait');
  assert.equal(release.down(), true);
  assert.deepEqual(net.asked.filter((p) => p !== '/release.json'), [], 'no file was asked of the network here');
});

test('a cache error falls back to the network (the worker\'s own way)', async () => {
  const { caches, release } = setup();
  release.check();
  caches.broken = true;
  assert.equal(await release.answer(file('/music/src/app.js')), null);
  caches.broken = false;
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v1 app', 'and it works again once storage does');
});

test('the release changes while the cache is being filled: the file that arrives after is given, not kept', async () => {
  const { net, caches, release } = setup();
  release.check();
  net.held = '/music/src/app.js';
  const pending = release.answer(file('/music/src/app.js'));
  while (!net.release) await new Promise((ok) => setImmediate(ok));
  net.live = 'bbb';   // another open found a new release meanwhile
  release.check();
  net.release();
  assert.equal(await text(await pending), 'v1 app', 'the page that asked still gets its answer');
  assert.equal(await stored(caches, release, '/music/src/app.js'), undefined, 'but it is not kept for either release');
  net.held = '';
  net.files.set('/music/src/app.js', 'v2 app');
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v2 app', 'the next ask is all new');
});

test('a deploy caught halfway (assets new, release.json old): the next release, or at most 7 days, starts the cache again', async () => {
  const { net, release } = setup();
  release.check();
  assert.equal(await text(await release.answer(file('/music/app.css'))), 'v1 css');
  // The deploy uploads the new assets; release.json still names the old release.
  net.files.set('/music/src/app.js', 'v2 app');
  net.files.set('/music/app.css', 'v2 css');
  release.check();
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v2 app');
  // Finished: release.json names the new release, and the next open is all new.
  net.live = 'bbb';
  release.check();
  assert.equal(await text(await release.answer(file('/music/app.css'))), 'v2 css');
  assert.equal(await text(await release.answer(file('/music/src/app.js'))), 'v2 app');

  // Never finished (a failed publish, nobody deploying): the mix lives at most 7 days.
  const second = setup();
  second.release.check();
  assert.equal(await text(await second.release.answer(file('/music/app.css'))), 'v1 css');
  second.net.files.set('/music/src/app.js', 'v2 app');
  second.net.files.set('/music/app.css', 'v2 css');
  assert.equal(await text(await second.release.answer(file('/music/src/app.js'))), 'v2 app');
  second.clock.t += 6 * DAY;
  second.release.check();
  assert.equal(await text(await second.release.answer(file('/music/app.css'))), 'v1 css', 'within the week, the kept copy');
  second.clock.t += 2 * DAY;
  second.release.check();
  second.net.asked.length = 0;
  assert.equal(await text(await second.release.answer(file('/music/app.css'))), 'v2 css', 'after it, the cache started again: all from the network');
  assert.deepEqual(second.net.asked, ['/music/app.css']);
  await second.release.saved();
  const mark = JSON.parse(await second.caches.stores.get(second.release.NAME).get(`${ORIGIN}/music/th-release-id`).clone().text());
  assert.equal(mark.sets[mark.current].id, 'aaa t', 'the marker holds the release');
  assert.equal(mark.sets[mark.current].started, second.clock.t, 'and when its set started');
});

test('a failed answer is not kept, a range or non-GET request is not touched, and each file the network gave is handed on', async () => {
  const { net, caches, release } = setup();
  release.check();
  const r = await release.answer(file('/music/src/missing.js'));
  assert.equal(r.status, 404);
  assert.equal(await stored(caches, release, '/music/src/missing.js'), undefined);
  assert.equal(await release.answer(file('/music/src/app.js', { headers: { range: 'bytes=0-' } })), null);
  assert.equal(await release.answer(file('/music/src/app.js', { method: 'POST', body: 'x' })), null);
  const heard = [];
  await release.answer(file('/music/src/app.js'), (req) => heard.push(new URL(req.url).pathname));
  assert.deepEqual(heard, ['/music/src/app.js']);
  assert.ok(net.asked.includes('/release.json'));
});

test('an unchanged release opens from the kept set with no request for the page or any file; /release.json is asked in the background', async () => {
  const { net, release } = setup();
  await networkLoad(release, 'p1');
  net.asked.length = 0;
  const hit = await release.open(page('/music/?demo'), 'p2');
  assert.equal(await text(hit), '<html>v1</html>', 'the page from the set (its query is not part of its key)');
  assert.equal(await text(await release.answer(file('/music/src/app.js'), undefined, 'p2')), 'v1 app');
  assert.equal(await text(await release.answer(file('/music/app.css'), undefined, 'p2')), 'v1 css');
  await release.behind();
  assert.deepEqual(net.asked, ['/release.json'], 'only the release, and nothing waited for it');
  await release.booted('p2');
});

test('a new release is saved whole in the background and the next open takes it whole; the open that found it stays on the old set', async () => {
  const { net, release } = setup();
  await networkLoad(release, 'p1');
  net.live = 'bbb';
  net.files.set('/music/src/app.js', 'v2 app');
  net.files.set('/music/app.css', 'v2 css');
  net.files.set('/music/', '<html>v2</html>');
  assert.equal(await text(await release.open(page(), 'p2')), '<html>v1</html>', 'this open: the kept set');
  assert.equal(await text(await release.answer(file('/music/app.css'), undefined, 'p2')), 'v1 css', 'with its own files, though the network has new ones');
  await release.behind();
  await release.booted('p2');
  assert.equal(await text(await release.answer(file('/music/src/app.js'), undefined, 'p2')), 'v1 app', 'a later file of that page: still its set');
  release.follow('w2', 'p2');
  assert.equal(await text(await release.answer(file('/music/app.css'), undefined, 'w2')), 'v1 css', 'and of a worker it started');
  net.asked.length = 0;
  assert.equal(await text(await release.open(page(), 'p3')), '<html>v2</html>', 'the next open: the new set');
  assert.equal(await text(await release.answer(file('/music/src/app.js'), undefined, 'p3')), 'v2 app');
  assert.equal(await text(await release.answer(file('/music/app.css'), undefined, 'p3')), 'v2 css');
  await release.behind();
  assert.deepEqual(net.asked, ['/release.json'], 'from the new set, with no request but the release');
});

test('a new release that changes again while it is saved is not used, nor one with a file that fails; the old set opens meanwhile', async () => {
  const { net, release } = setup();
  await networkLoad(release, 'p1');
  net.live = 'bbb';
  net.files.set('/music/app.css', 'v2 css');
  net.held = '/music/app.css';
  await release.open(page(), 'p2');
  while (!net.release) await new Promise((ok) => setImmediate(ok));
  net.live = 'ccc';   // another deploy while the files of bbb were saved
  net.release();
  await release.behind();
  await release.booted('p2');
  assert.equal((await release.state()).next, null, 'nothing saved for the next open');
  net.held = '';
  assert.equal(await text(await release.open(page(), 'p3')), '<html>v1</html>', 'the old set opens');

  const second = setup();
  await networkLoad(second.release, 'p1');
  second.net.live = 'bbb';
  second.net.files.delete('/music/app.css');
  await second.release.open(page(), 'p2');
  await second.release.behind();
  await second.release.booted('p2');
  assert.equal((await second.release.state()).next, null, 'a file the new release did not give: nothing saved');
  second.net.files.set('/music/app.css', 'v2 css');
  assert.equal(await text(await second.release.open(page(), 'p3')), '<html>v1</html>', 'the old set opens, and the new one is saved again');
  await second.release.behind();
  await second.release.booted('p3');
  assert.equal(await text(await second.release.open(page(), 'p4')), '<html>v1</html>');
  assert.equal(await text(await second.release.answer(file('/music/app.css'), undefined, 'p4')), 'v2 css', 'the new release whole once it was all in');
});

test('a page that never says it started sends the next open the network\'s way, and its set is filled again', async () => {
  const { release } = setup();
  await networkLoad(release, 'p1');
  assert.ok(await release.open(page(), 'p2'), 'from the set');
  // p2 never boots (a broken set, a crash).
  assert.equal(await release.open(page(), 'p3'), null, 'the next open: the network\'s way');
  await networkLoad(release, 'p4');
  assert.ok(await release.open(page(), 'p5'), 'once a page started again, the set opens pages again');
});

test('a file the kept set lacks: kept into it while its release is live; under another release the set is incomplete and the next open is the network\'s', async () => {
  const { net, release } = setup();
  await networkLoad(release, 'p1');
  net.files.set('/music/src/later.js', 'v1 later');
  await release.open(page(), 'p2');
  await release.behind();
  assert.equal(await text(await release.answer(file('/music/src/later.js'), undefined, 'p2')), 'v1 later');
  await release.booted('p2');
  net.asked.length = 0;
  await release.open(page(), 'p3');
  assert.equal(await text(await release.answer(file('/music/src/later.js'), undefined, 'p3')), 'v1 later');
  assert.ok(!net.asked.includes('/music/src/later.js'), 'kept: asked of the network once only');
  await release.behind();
  await release.booted('p3');
  // Another release is live and the page asks for a file the set lacks: the network's, and the set is incomplete.
  net.files.set('/music/src/other.js', 'v2 other');
  net.live = 'bbb';
  net.held = '/music/src/app.js'; // the new release's background save stays unfinished
  await release.open(page(), 'p4');
  assert.equal(await text(await release.answer(file('/music/src/other.js'), undefined, 'p4')), 'v2 other');
  await release.booted('p4');
  assert.equal(await release.open(page(), 'p5'), null, 'incomplete: the network\'s way');
});
