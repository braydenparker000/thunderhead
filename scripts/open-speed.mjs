// How fast each app and main page opens on a weak link (PERFORMANCE.md §3.1, "Opening on a weak link"):
// the site as stage.mjs publishes it, behind a link of about 1.5 Mbit/s down with 150 ms latency that
// answers like the static website (an ETag, `Cache-Control: no-cache`, 304 for an unchanged file), the
// mock API (tests/fixtures/mock-api.mjs), and the CI Chromium at phone size with a 4x CPU slowdown.
// Each page is opened cold (a new phone: nothing cached, no service worker) and warm (the same phone
// opening it again, its service workers installed). All times are read inside the page, from its own
// clock: first paint (FCP), first useful paint (the page's own content on screen, `ready` below),
// interactive (the first 500 ms with no long task after the useful paint), and what the page asked:
// requests and bytes over the link, 304s, render-blocking files, and the longest chain of requests
// that each waited for the one before (an import, a fetch made by a script). Prints a table, or JSON
// with --json. `node scripts/open-speed.mjs [--json] [name ...]`.
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

import { TOKEN, mockApi } from '../tests/fixtures/mock-api.mjs';

let API = '';
export const LINK = { latencyMs: 150, bytesPerSecond: 1_500_000 / 8, cpu: 4 };

/** The pages measured: where each opens, and when its own content is on screen (a test in the page). */
export const PAGES = [
  { name: 'home', path: '/', ready: "document.documentElement.hasAttribute('data-signed-in') && !!document.querySelector('#q')" },
  { name: 'chat', path: '/', chat: true, ready: "!!document.querySelector('#talk .you')" },
  // Pages home opens over itself: asked for as soon as home is signed in, as a swipe or a tap would.
  { name: 'briefing', path: '/', go: ['th:go', 'brief'], ready: "!!document.querySelector('#brief .bmuse')" },
  { name: 'settings', path: '/', go: ['th:open', { name: 'settings' }], ready: "!!document.querySelector('.spage') && !document.querySelector('.spage.moving')" },
  { name: 'music', path: '/music/', sw: '/music/sw.js', scope: '/music/', ready: "!document.getElementById('cp-boot') && !!window.__cp" },
  { name: 'podcasts', path: '/podcasts/', ready: "document.body.innerText.trim().length > 40" },
  { name: 'guitar', path: '/guitar/', ready: "document.body.innerText.trim().length > 40" },
  { name: 'astra', path: '/astra/', ready: "document.body.innerText.trim().length > 40" },
  { name: 'study', path: '/study/', ready: "document.body.innerText.trim().length > 40" },
  { name: 'photos', path: '/photos/', ready: "document.body.innerText.trim().length > 40" },
];

/** A link in front of `target` (host:port): latency per request, one shared pace for every byte, and
 * the static website's revalidation (ETag, no-cache, 304). Counts what went over it. */
export function slowLink(target, link = LINK) {
  let free = 0;
  const seen = { requests: 0, bytes: 0, notModified: 0, inflight: 0, last: 0, paths: /** @type {string[]} */ ([]) };
  const server = createServer((req, res) => {
    seen.requests++;
    seen.inflight++;
    seen.last = Date.now();
    res.on('close', () => { seen.inflight--; seen.last = Date.now(); });
    seen.paths.push(req.url);
    const up = request({ host: target.host, port: target.port, path: req.url, method: req.method, headers: req.headers }, async (r) => {
      const chunks = [];
      for await (const c of r) chunks.push(c);
      const body = Buffer.concat(chunks);
      const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"`;
      await new Promise((ok) => setTimeout(ok, link.latencyMs));
      if (res.destroyed) return;
      const headers = { ...r.headers, etag, 'cache-control': 'no-cache' };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      if (r.statusCode === 200 && req.headers['if-none-match'] === etag) {
        seen.notModified++;
        return res.writeHead(304, { etag, 'cache-control': 'no-cache' }).end();
      }
      res.writeHead(r.statusCode ?? 500, { ...headers, 'content-length': String(body.length) });
      for (let at = 0; at < body.length; at += 8192) {
        const piece = body.subarray(at, at + 8192), now = Date.now();
        free = Math.max(now, free) + (piece.length / link.bytesPerSecond) * 1000;
        await new Promise((ok) => setTimeout(ok, Math.max(0, free - now)));
        if (res.destroyed) return;
        res.write(piece);
        seen.bytes += piece.length;
      }
      res.end();
    });
    up.on('error', () => req.socket.destroy());
    req.pipe(up);
  });
  server.seen = seen;
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Runs in the page before anything else: the clock readings and what was asked, kept on `window.__speed`. */
function probe(ready) {
  const s = (window.__speed = { fcp: 0, lcp: 0, ready: 0, interactive: 0, longTasks: [], blocking: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') s.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.longTasks.push([e.startTime, e.startTime + e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const test = new Function(`try { return (${ready}); } catch { return false; }`);
  const look = () => {
    if (!s.ready && document.readyState !== 'loading' && test()) {
      // the frame that shows it: the next paint after the content is there
      requestAnimationFrame(() => setTimeout(() => { s.ready = performance.now(); }));
      return;
    }
    if (!s.ready) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
  const to = /** @type {any} */ (window).__go;
  if (to) {
    const go = () => (document.documentElement.hasAttribute('data-signed-in') ? setTimeout(() => document.dispatchEvent(new CustomEvent(to[0], { detail: to[1] }))) : requestAnimationFrame(go));
    requestAnimationFrame(go);
  }
}

/** The page's numbers once its content is on screen and 500 ms passed with no long task. */
async function read(page, timeout = 60_000) {
  await page.waitForFunction(() => window.__speed?.ready > 0, null, { timeout, polling: 100 });
  await page.waitForFunction(() => {
    const s = window.__speed, now = performance.now(), last = s.longTasks.reduce((m, t) => Math.max(m, t[1]), 0);
    return now - Math.max(s.ready, last) > 500;
  }, null, { timeout, polling: 100 });
  return page.evaluate(() => {
    const s = window.__speed;
    const after = s.longTasks.filter((t) => t[1] > s.ready).reduce((m, t) => Math.max(m, t[1]), 0);
    const blocking = performance.getEntriesByType('resource').filter((e) => e.renderBlockingStatus === 'blocking').map((e) => new URL(e.name).pathname);
    return { fcp: Math.round(s.fcp), ready: Math.round(s.ready), interactive: Math.round(Math.max(s.ready, after)), blocking };
  });
}

/** The longest chain of requests where each began only after the one before it ended (CDP initiators). */
function chains(events) {
  const byUrl = new Map(), depth = new Map();
  for (const e of events) byUrl.set(e.url, e);
  const of = (url, seen = new Set()) => {
    if (depth.has(url)) return depth.get(url);
    if (seen.has(url)) return 1;
    seen.add(url);
    const parent = byUrl.get(url)?.parent;
    const d = parent && byUrl.has(parent) ? of(parent, seen) + 1 : 1;
    depth.set(url, d);
    return d;
  };
  return events.reduce((m, e) => Math.max(m, of(e.url)), 0);
}

/** Opens `p` once in `context` and reads it. */
async function open(context, p, link) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: LINK.cpu });
  await cdp.send('Network.enable');
  const events = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    const st = e.initiator?.stack;
    const parent = e.initiator?.url || st?.callFrames?.[0]?.url || st?.parent?.callFrames?.[0]?.url || '';
    if (!e.request.url.startsWith('data:')) events.push({ url: e.request.url, parent });
  });
  await page.addInitScript(`window.__go = ${JSON.stringify(p.go ?? null)};(${probe})(${JSON.stringify(p.ready)})`);
  const before = { ...link.seen };
  await page.goto(`${link.base}${p.path}`, { waitUntil: 'commit' });
  const got = await read(page);
  await page.close();
  return { ...got, requests: link.seen.requests - before.requests, bytes: link.seen.bytes - before.bytes, notModified: link.seen.notModified - before.notModified, chain: chains(events) };
}

/** The mock API (tests/fixtures/mock-api.mjs) as a real host on this machine, answering after twice the
 * link's latency: Playwright's own routes would turn the browser's HTTP cache off, and a warm open is
 * mostly that cache. mockApi() is handed a stand-in for a page whose one route is this server. */
async function apiHost(overrides) {
  let handler = null;
  await mockApi({ route: async (_pattern, h) => { handler = h; }, routeWebSocket: async () => {} }, overrides);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, TH-Client, If-None-Match', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-expose-headers': 'ETag' };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    await new Promise((ok) => setTimeout(ok, LINK.latencyMs * 2));
    const url = `${API}${req.url}`;
    if (req.method === 'GET' && req.url.startsWith('/v1/music/catalog')) return res.writeHead(200, { ...cors, 'content-type': 'application/json', etag: '"c1"' }).end(JSON.stringify(catalog()));
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    const route = {
      request: () => ({ method: () => req.method, url: () => url, headers: () => headers, postDataJSON: () => JSON.parse(body.toString('utf8')), postDataBuffer: () => body }),
      fulfill: async ({ status = 200, headers: h = {}, body: b = '' }) => { res.writeHead(status, { ...h, ...cors }).end(b); },
      fallback: async () => { res.writeHead(404, cors).end(); },
      abort: async () => { req.socket.destroy(); },
    };
    try { await handler(route); } catch { if (!res.headersSent) res.writeHead(500, cors).end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return server;
}

const CHAT = { chat: { messages: [{ seq: 1, id: 'm1', thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'owner', origin: 'owner_device', kind: 'text', body: 'An example question', meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: Date.now() - 200_000 }] } };

/** A phone signed in. */
export async function phone(browser, link, p) {
  const context = await browser.newContext({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, hasTouch: true, isMobile: true, serviceWorkers: 'allow', timezoneId: 'UTC' });
  // (Astra starts its worker only on https unless told it is a test: the phone's is on.)
  await context.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('astra.dev.sw', '1'); } catch {} });
  const page = await context.newPage();
  await page.goto(`${link.base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; };
  }), TOKEN);
  await page.close();
  return { context };
}

/** Twelve invented songs. */
function catalog() {
  const hex = (i) => (i + 10).toString(16).repeat(64).slice(0, 64);
  const tracks = Array.from({ length: 12 }, (_, i) => ({ id: `r2_native_${hex(i)}`, sha256: hex(i), size: 100_000, audioKey: `native/audio/${hex(i)}.opus`, mimeType: 'audio/ogg', path: `Tone ${i}.opus`, folder: 'Cloudflare R2/Test', r2Identity: { size: 100_000, etag: `e${i}`, lastModified: '2026-10-01T00:00:00.000Z' }, metadata: { title: `Tone ${i}`, artist: `Artist ${i}`, album: `Album ${i}`, dur: 120, codec: 'opus', sr: 48000 } }));
  return { version: 1, kind: 'r2-library', complete: true, count: tracks.length, generatedAt: '2026-10-29T00:00:00.000Z', tracks };
}

/** Cold, then warm once the service workers are in place. */
export async function measure(browser, link, p) {
  const { context } = await phone(browser, link, p);
  try {
    const cold = await open(context, p, link);
    // The phone's workers: the shell's and, where the app has one that it starts only on https, the app's.
    const page = await context.newPage();
    await page.goto(`${link.base}${p.path}`, { waitUntil: 'load' });
    await page.evaluate(async ([sw, scope]) => {
      // The shell's worker is on every phone that has opened home once (th/update.js registers it there).
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (sw) await navigator.serviceWorker.register(sw, { scope });
      const regs = await navigator.serviceWorker.getRegistrations();
      const done = (r) => !r.installing && !r.waiting && r.active;
      for (let i = 0; i < 600 && !regs.every(done); i++) await new Promise((ok) => setTimeout(ok, 100));
    }, [p.sw ?? '', p.scope ?? '/']);
    // and one open under them, as every open after the first one is
    await page.reload({ waitUntil: 'networkidle', timeout: 120_000 });
    // until the link has been quiet for 3 s: the workers have kept what they keep (Astra saves its release whole)
    for (let i = 0; i < 1200 && (link.seen.inflight > 0 || Date.now() - link.seen.last < 3000); i++) await new Promise((ok) => setTimeout(ok, 100));
    await page.close();
    const warm = await open(context, p, link);
    return { name: p.name, cold, warm };
  } finally {
    await context.close();
  }
}

/** Starts the site behind the slow link. */
export async function start() {
  const api = await apiHost({});
  const chat = await apiHost(CHAT);
  API = `http://127.0.0.1:${api.address().port}`;
  const site = await serve(0, { api: API });
  // the chat's page: the same site with an API that holds a conversation
  const chatSite = await serve(0, { api: `http://127.0.0.1:${chat.address().port}` });
  const link = await slowLink({ host: '127.0.0.1', port: site.address().port });
  link.base = `http://127.0.0.1:${link.address().port}`;
  const chatLink = await slowLink({ host: '127.0.0.1', port: chatSite.address().port });
  chatLink.base = `http://127.0.0.1:${chatLink.address().port}`;
  return { site, link, chatLink, close: () => { for (const s of [link, chatLink, site, chatSite, api, chat]) s.close(); } };
}

/** Chromium; nothing leaves the machine: every host but this one fails to resolve (no routes, which would
 * turn the HTTP cache off). */
export const launch = () => chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json'), names = args.filter((a) => !a.startsWith('--'));
  const { link, chatLink, close } = await start();
  const browser = await launch();
  const rows = [];
  try {
    for (const p of PAGES.filter((x) => !names.length || names.includes(x.name))) {
      try { rows.push(await measure(browser, p.chat ? chatLink : link, p)); } catch (e) { rows.push({ name: p.name, error: String(e.message).split('\n')[0] }); }
    }
  } finally {
    await browser.close();
    close();
  }
  if (json) console.log(JSON.stringify(rows, null, 1));
  else {
    const s = (ms) => (ms / 1000).toFixed(2);
    const kb = (b) => `${Math.round(b / 1024)}K`;
    console.log('page      | cold paint useful inter req  bytes  chain block | warm paint useful inter req 304 bytes chain');
    for (const r of rows) {
      if (r.error) { console.log(`${r.name.padEnd(9)} | ${r.error}`); continue; }
      const c = r.cold, w = r.warm;
      console.log(`${r.name.padEnd(9)} | ${s(c.fcp)} ${s(c.ready)} ${s(c.interactive)} ${c.requests} ${kb(c.bytes)} ${c.chain} ${c.blocking.length} | ${s(w.fcp)} ${s(w.ready)} ${s(w.interactive)} ${w.requests} ${w.notModified} ${kb(w.bytes)} ${w.chain}`);
    }
  }
}
