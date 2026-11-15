// Astra's pages made cross-origin isolated by its own service worker (frontend/astra/sw.js adds COOP
// same-origin and COEP credentialless), in a real Chromium: the first visit is not isolated and is not
// reloaded; the second opening is. Isolated, what comes from other hosts still works: an add-on's Home row
// with posters from a host that sends no CORS headers, a film the page may not read played by the browser
// itself, a readable one through Astra's own engine, and the software decoder (with threads, held to one
// core fewer than the machine has). Back from Astra returns to the shell at /, a page that is not isolated.
// Both switches are off as shipped (ISOLATE in sw.js, THREADS in software-threads.js): a small server in
// front of the site turns them on, so this check says what switching them on would do.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the worker is on for a local server, synthetic films)', timeout: 60_000 };
// A 1×1 PNG, and an invented add-on whose posters come from its own host, two of four without CORS headers.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
let site, front, host, addon, browser, base, other;
const ON = { '/astra/sw.js': ['const ISOLATE = false;', 'const ISOLATE = true;'], '/astra/src/engine/software-threads.js': ['export const THREADS = false;', 'export const THREADS = true;'] };

before(async () => {
  if (live) return;
  site = await serve(0, {});
  front = createServer((req, res) => {
    const on = ON[new URL(req.url, 'http://x').pathname];
    const headers = on ? { ...req.headers, 'accept-encoding': 'identity' } : req.headers;
    req.pipe(request({ port: site.address().port, path: req.url, method: req.method, headers }, (r) => {
      if (!on) { res.writeHead(r.statusCode, r.headers); return r.pipe(res); }
      const parts = [];
      r.on('data', (c) => parts.push(c)).on('end', () => {
        const body = Buffer.concat(parts).toString('utf8');
        assert.ok(body.includes(on[0]), `${req.url} still has its switch`);
        const { 'content-length': _, etag: __, ...rest } = r.headers;
        res.writeHead(r.statusCode, rest).end(body.replace(on[0], on[1]));
      });
    }));
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${front.address().port}`;
  host = await astraHost();
  addon = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), cors = u.searchParams.has('nocors') ? {} : { 'Access-Control-Allow-Origin': '*' };
    const json = (v) => res.writeHead(200, { 'content-type': 'application/json', ...cors }).end(JSON.stringify(v));
    if (u.pathname.endsWith('.png')) return res.writeHead(200, { 'content-type': 'image/png', ...cors }).end(PNG);
    if (u.pathname === '/manifest.json') return json({ id: 'example', name: 'Example', version: '1.0.0', resources: ['catalog'], types: ['movie'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] });
    if (u.pathname.startsWith('/catalog/')) return json({ metas: [1, 2, 3, 4].map((i) => ({ id: `tt000040${i}`, type: 'movie', name: `Invented ${i}`, poster: `${other}/p${i}.png${i % 2 ? '?nocors' : ''}` })) });
    res.writeHead(404, cors).end();
  });
  await new Promise((r) => addon.listen(0, '127.0.0.1', r));
  other = `http://127.0.0.1:${addon.address().port}`;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); front?.close(); site?.close(); addon?.close(); await host?.close(); });

/** Plays `url` through Astra's engine in the page; {mode, played} once it has moved on half a second, or {error}. */
const play = (page, url) => page.evaluate(async (url) => {
  window.p?.destroy();
  const { AstraPlayer } = await import('/astra/src/engine/player.js');
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  document.body.append(video);
  const p = (window.p = new AstraPlayer(video, document.createElement('div')));
  let error = null, ready = false;
  p.addEventListener('error', (e) => { error = e.detail.message; });
  p.addEventListener('ready', () => { ready = true; });
  p.load({ url });
  const until = performance.now() + 20_000;
  while (!ready && !error && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
  if (!ready) return { error: error || 'not ready' };
  await video.play().catch(() => {});
  const from = video.currentTime;
  while (video.currentTime - from < 0.5 && !error && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
  return { mode: p.mode, played: video.currentTime - from >= 0.5, error };
}, url);

test('the second opening is cross-origin isolated, and posters, films, the software decoder and Back still work', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('astra.dev.sw', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let loads = 0;
  page.on('load', () => loads++);

  // The first visit: not isolated, and left as it is (no reload) while the worker saves the app.
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => localStorage.setItem('astra.v2.addons', JSON.stringify([{ url, enabled: true, name: 'Example' }])), `${other}/manifest.json`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  assert.equal(loads, 1, 'the first visit is never reloaded');

  // The second opening: isolated, and the add-on's row shows all four posters, with CORS headers or without.
  await page.goto(`${base}/astra/`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'isolated from the second opening');
  // (each poster is drawn twice: in the hero and in the row)
  await page.waitForFunction(() => { const all = [...document.querySelectorAll('img')].filter((i) => /\/p\d\.png/.test(i.src)); return all.length >= 4 && all.every((i) => i.complete && i.naturalWidth) && new Set(all.map((i) => i.src)).size === 4; }, null, { timeout: 10_000 });

  // A film the page may not read is handed to the browser and plays; a readable one plays through Astra.
  assert.deepEqual(await play(page, `${host.url('plain.mp4')}?nocors`), { mode: 'native', played: true, error: null });
  const readable = await play(page, host.url('multi.mkv'));
  assert.ok(readable.played && ['remux', 'native'].includes(readable.mode), JSON.stringify(readable));
  // The software decoder (when this browser does not decode HEVC itself) plays, its workers told one core fewer.
  const soft = await play(page, host.url('hevc.mkv'));
  if (soft.mode === 'software') {
    assert.ok(soft.played, JSON.stringify(soft));
    const cores = await page.evaluate(() => ({ cap: Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1)), url: globalThis.CHEAP_POLYFILL_URL, off: globalThis.CHEAP_DISABLE_THREAD }));
    assert.ok(cores.url?.startsWith('blob:') && !cores.off, 'libmedia runs threads');
    // A worker as libmedia starts one: its script first, then what it reads as the phone's cores.
    const seen = await page.evaluate((u) => new Promise((r) => { const w = new Worker(URL.createObjectURL(new Blob([`importScripts('${u}'); postMessage(navigator.hardwareConcurrency);`], { type: 'text/javascript' }))); w.onmessage = (e) => { r(e.data); w.terminate(); }; }), cores.url);
    assert.equal(seen, cores.cap, 'libmedia\'s workers are told one core fewer, at most 4');
  }
  await page.evaluate(() => window.p?.destroy());

  // From the shell at / (not isolated) to Astra and Back.
  await page.goto(`${base}/`);
  await page.evaluate(() => { location.href = '/astra/'; });
  await page.waitForURL(`${base}/astra/`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.goBack();
  await page.waitForURL(`${base}/`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), false, 'the shell as it was');
  assert.deepEqual(errors, []);
  await context.close();
});
