// Repair without a browser (MENU-AND-SETTINGS.md §6.8, OPERATIONS.md §3.3): what /repair/repair.js clears and
// keeps, that the service worker never answers /repair/, and the boot guard (frontend/boot-guard.js): two
// starts in a row with no mark within 12 s on screen show its panel, a slow start that marks does not, and it
// never reloads by itself. The browser half is tests/repair-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadWorker } from './fixtures/sw-harness.mjs';

const SITE = new URL('../frontend/', import.meta.url);
const read = (p) => readFileSync(new URL(p, SITE), 'utf8');

/** repair.js in a context with no page (it only defines thRepair there). */
function repairModule() {
  const context = vm.createContext({ URL, Promise });
  vm.runInContext(read('repair/repair.js'), context);
  return context.thRepair;
}

test('repair clears the code caches and the three service workers, and keeps every data cache', async () => {
  const { repair } = repairModule();
  const names = ['th-412', 'th-411', 'th-lab-412', 'th-vendor', 'claude-player-v1', 'claude-player-release', 'jarvis-podcast-shell-v6',
    'claude-player-audio', 'claude-player-heads', 'jarvis-podcast-audio-v1', 'jarvis-podcast-art-v1', 'th-music-catalog',
    'astra-data-v1', 'astra-state', 'th-photos-thumbs'];
  const caches = new Set(names);
  const store = { keys: async () => [...caches], delete: async (n) => caches.delete(n) };
  const gone = [];
  const reg = (scope) => ({ scope: `https://site.example.test${scope}`, unregister: async () => { gone.push(scope); return true; } });
  const nav = { serviceWorker: { getRegistrations: async () => ['/', '/music/', '/podcasts/', '/astra/'].map(reg) } };
  const done = await repair(nav, store);
  assert.deepEqual({ ...done }, { workers: 3, caches: 7 });
  assert.deepEqual(gone, ['/', '/music/', '/podcasts/']);
  assert.deepEqual([...caches].sort(), ['astra-data-v1', 'astra-state', 'claude-player-audio', 'claude-player-heads', 'jarvis-podcast-art-v1', 'jarvis-podcast-audio-v1', 'th-music-catalog', 'th-photos-thumbs']);
});

test('repair with no service workers or caches still finishes; its line says what it did and that data stayed', async () => {
  const { repair, line } = repairModule();
  assert.deepEqual({ ...(await repair({}, undefined)) }, { workers: 0, caches: 0 });
  assert.match(line({ workers: 3, caches: 1 }), /^Repaired: 1 code cache and 3 workers cleared\. Sign-in and your data stayed\.$/);
});

test('repair proves it can reach home and the release file first, with HEAD past every cache', async () => {
  const { reach } = repairModule();
  const asked = [];
  assert.equal(await reach(async (u, init) => { asked.push([u, init.method, init.cache]); return { ok: true }; }), true);
  assert.deepEqual(asked, [['/', 'HEAD', 'no-store'], ['/release.json', 'HEAD', 'no-store']]);
  assert.equal(await reach(async () => { throw new TypeError('Failed to fetch'); }), false, 'no signal');
  assert.equal(await reach(async (u) => ({ ok: u === '/' })), false, 'the release file missing');
  assert.equal(await reach(undefined), false);
});

/** /repair/ as a page: what it clears and what it says, with `get` as its fetch. */
async function repairPage(get) {
  const els = { say: { textContent: '' }, again: { hidden: true } };
  const cleared = [];
  const location = { pathname: '/repair/', to: '', replace(u) { this.to = u; } };
  const context = vm.createContext({
    URL, Promise, location, fetch: get,
    document: { getElementById: (id) => els[id] },
    localStorage: { setItem() {}, removeItem() {} },
    navigator: { serviceWorker: { getRegistrations: async () => [{ scope: 'https://site.example.test/', unregister: async () => { cleared.push('worker'); return true; } }] } },
    caches: { keys: async () => ['th-1'], delete: async (n) => { cleared.push(n); return true; } },
  });
  context.top = context.self = context.globalThis = context;
  vm.runInContext(read('repair/repair.js'), context);
  for (let i = 0; i < 50 && !location.to && els.again.hidden; i++) await new Promise((r) => setImmediate(r));
  return { els, cleared, location };
}

test('/repair/ that cannot reach the site clears nothing and says so; reached, it clears and goes home', async () => {
  const off = await repairPage(async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(off.cleared, [], 'nothing cleared');
  assert.equal(off.location.to, '', 'stays');
  assert.equal(off.els.say.textContent, 'Repair needs a connection, and the site can’t be reached now. Nothing was cleared.');
  assert.equal(off.els.again.hidden, false);
  const on = await repairPage(async () => ({ ok: true }));
  assert.deepEqual(on.cleared, ['worker', 'th-1']);
  assert.equal(on.location.to, '/');
});

test('/repair/ is a static page with no module and nothing of the site but its own script', () => {
  const html = read('repair/index.html');
  assert.deepEqual([...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u !== '/' && u !== '/repair/'), ['/repair/repair.js']);
  assert.doesNotMatch(html, /type="module"|<style|\sstyle=|\son[a-z]+=/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
  assert.doesNotMatch(read('repair/repair.js'), /^\s*(import|export)\s|import\(/m);
});

test('the service worker never answers /repair/: not from the cache, not at all', async () => {
  const w = loadWorker(async () => new Response('net'));
  w.stores.set('th-0', new Map([['/repair/index.html', { bytes: new TextEncoder().encode('old'), status: 200, type: 'text/html' }]]));
  for (const [path, mode] of [['/repair/', 'navigate'], ['/repair', 'navigate'], ['/repair/repair.js', 'no-cors']]) {
    let answered = false;
    w.listeners.get('fetch')({ request: { method: 'GET', url: `https://site.example.test${path}`, mode, destination: mode === 'navigate' ? 'document' : 'script' }, respondWith: () => { answered = true; } });
    assert.equal(answered, false, path);
  }
});

/** boot-guard.js in a fake page: its timers, storage and the elements it adds; `hidden` starts it off screen. */
function page(store = new Map(), { hidden = false, full = false, fetch = async () => ({ ok: true }) } = {}) {
  const timers = new Map();
  let next = 1;
  const listeners = {};
  const added = [];
  const location = { reloads: 0, to: '', reload() { this.reloads++; }, assign(u) { this.to = u; } };
  const el = (tag) => {
    const e = { tag, style: {}, children: [], textContent: '', attrs: {}, append(...k) { this.children.push(...k); }, setAttribute(k, v) { this.attrs[k] = v; },
      remove() { added.splice(added.indexOf(this), 1); }, focus() {}, attachShadow() { e.shadow = el('#shadow'); return e.shadow; } };
    return e;
  };
  const document = { visibilityState: hidden ? 'hidden' : 'visible', createElement: el, documentElement: { append: (e) => added.push(e) },
    addEventListener: (t, f) => { listeners[t] = f; } };
  const self = {};
  const context = vm.createContext({
    document, location, self, fetch, AbortSignal,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); store.set(k, String(v)); }, removeItem: (k) => store.delete(k) },
    setTimeout: (f, ms) => { timers.set(next, { f, ms }); return next++; }, clearTimeout: (id) => timers.delete(id),
  });
  context.top = context.self = self;
  Object.assign(self, { top: self });
  vm.runInContext(read('boot-guard.js'), context);
  const run = () => { const [[id, t]] = [...timers]; assert.equal(t.ms, 12000); timers.delete(id); t.f(); };
  const text = (e) => [e.textContent, ...(e.shadow ? [text(e.shadow)] : []), ...e.children.map(text)].join(' ');
  return { store, timers, run, added, text, location, self, show: (v) => { document.visibilityState = v; listeners.visibilitychange(); } };
}

test('boot guard: two starts in a row with no mark within 12 s show the panel; one does not', () => {
  const one = page();
  one.run();
  assert.equal(one.added.length, 0, 'the first miss shows nothing');
  const two = page(one.store);
  two.run();
  assert.equal(two.added.length, 1);
  assert.match(two.text(two.added[0]), /Thunderhead didn’t start\..*Repair.*Try again/);
  assert.equal(two.location.reloads, 0, 'never reloads by itself');
  // the app started after all: the panel goes and the count starts again
  two.self.thStarted();
  assert.equal(two.added.length, 0);
  assert.equal(two.store.has('th.boot'), false);
});

test('boot guard: with the phone\'s storage full it can\'t count, so the first miss shows the panel', () => {
  const p = page(new Map(), { full: true });
  p.run();
  assert.equal(p.added.length, 1);
  assert.match(p.text(p.added[0]), /Thunderhead didn’t start\..*Repair/);
});

test('boot guard: Repair goes to /repair/ only once it answers; with no or too weak a signal a line says so', async () => {
  const settle = () => new Promise((r) => setImmediate(r));
  const asked = [];
  const store = new Map([['th.boot', '1']]);
  const on = page(store, { fetch: async (u, init) => { asked.push([u, init.method, init.cache]); return { ok: true }; } });
  on.run();
  const button = (p) => p.added[0].shadow.children.find((e) => e.textContent === 'Repair');
  button(on).onclick();
  await settle();
  assert.deepEqual(asked, [['/repair/', 'HEAD', 'no-store']]);
  assert.equal(on.location.to, '/repair/');
  const off = page(new Map([['th.boot', '1']]), { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  off.run();
  button(off).onclick();
  await settle();
  assert.equal(off.location.to, '', 'stays');
  assert.match(off.text(off.added[0]), /Repair needs a connection\./);
});

test('boot guard: a slow start that marks itself shows nothing, however many times; off screen counts nothing', () => {
  const store = new Map();
  for (let i = 0; i < 3; i++) {
    const p = page(store);
    p.self.thStarted();
    assert.equal(p.timers.size, 0);
    assert.equal(p.added.length, 0);
  }
  const p = page(store, { hidden: true });
  assert.equal(p.timers.size, 0, 'no clock while off screen (a prerender, a locked phone)');
  p.show('visible');
  p.show('hidden');
  assert.equal(p.timers.size, 0);
  assert.equal(store.has('th.boot'), false);
});

test('boot guard: the line Repair left is handed to home once', () => {
  const p = page(new Map([['th.repaired', 'Repaired: 1 code cache and 1 worker cleared. Sign-in and your data stayed.']]));
  assert.match(p.self.thStarted(), /^Repaired:/);
  assert.equal(p.self.thStarted(), null);
});

test('boot guard: a classic script under 1.5 KB, the first script home loads', () => {
  const src = read('boot-guard.js');
  assert.ok(Buffer.byteLength(src) < 1536, `${Buffer.byteLength(src)} bytes`);
  assert.doesNotMatch(src, /^\s*(import|export)\s|import\(/m);
  const html = read('index.html');
  assert.match(html.slice(html.indexOf('<script')), /^<script src="\/boot-guard\.js"><\/script>/);
  // home marks itself started at its first paint
  assert.match(read('apps/home/home.js'), /requestAnimationFrame\(\(\)=>\{const said=globalThis\.thStarted\?\.\(\);if\(said\)toast\(said\)\}\)/);
});
