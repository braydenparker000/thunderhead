// Ink and Lamp as the default look (the owner, 2026-11-20), in Chromium at 390×844 against the mocked
// Worker: a phone that has chosen nothing has it, Classic is a stored choice that holds over a reload,
// and choosing Ink and Lamp again stores nothing; every other page that loads ui/theme.js (sign-in,
// Photos, Study, the lab's) keeps its own look and asks for none of the look's files; and the island
// shows the artwork of what plays, the reels only where there is none or Island › Artwork is off.
// (The test server's phone has chosen Classic, scripts/serve.mjs; `th.t.look` set here makes it one that
// has chosen nothing.) Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { island, settle } from './fixtures/look-island.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const ROOT = fileURLToPath(new URL('../frontend/', import.meta.url));
const INK = 'rgb(214, 214, 210)';
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** A phone in the day theme that has chosen no look (or `look`), signed in unless `session` is false. */
async function phone({ look = '', session = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(([l]) => {
    try {
      if (!localStorage.getItem('th.p.sent')) { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('th-theme', 'light'); if (l) localStorage.setItem('th.s.appearance.look', l); }
      localStorage.setItem('th.t.look', '1');
    } catch {}
  }, [look]);
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await mockApi(page, {});
  await page.route(`${API}/v1/music/catalog`, (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] }) }));
  await page.goto(`${base}/no-such-file.txt`);
  if (session) await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  asked.length = 0;
  return { context, page, errors, asked };
}
const home = async (page) => { await page.goto(`${base}/`, { waitUntil: 'load' }); await page.waitForSelector('html[data-signed-in]'); };
const state = (page) => page.evaluate(() => [document.documentElement.dataset.look, localStorage.getItem('th.s.appearance.look'), Boolean(document.querySelector('link[data-look]'))]);
const choose = async (page, v) => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'appearance' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="appearance"]:not([aria-busy])');
  await page.click(`[data-key="appearance.look"] [data-v="${v}"]`);
};

test('a phone that has chosen nothing has Ink and Lamp; Classic is a choice that holds; Ink and Lamp again stores nothing', opts, async () => {
  const { context, page, errors, asked } = await phone();
  await home(page);
  await page.waitForSelector('html[data-look-ready]');
  assert.deepEqual(await state(page), ['ink-lamp', null, true]);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), INK);
  await choose(page, 'classic');
  assert.deepEqual((await state(page)).slice(0, 2), ['classic', 'classic']);
  asked.length = 0;
  await home(page);
  await outlast(page, 600); // a negative read: past the first paint, when the look's script would load
  assert.deepEqual(await state(page), ['classic', 'classic', false]);
  assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), [], 'Classic asks for nothing of the look');
  await choose(page, 'ink-lamp');
  await page.waitForSelector('html[data-look-ready]');
  assert.deepEqual(await state(page), ['ink-lamp', null, true]);
  await home(page);
  await page.waitForSelector('html[data-look-ready]');
  assert.deepEqual(await state(page), ['ink-lamp', null, true]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a look nobody knows is the default; every other page that loads ui/theme.js keeps its own look', opts, async () => {
  // Found on disk, so a page added later is held to it too: all but the shell (index.html, 404.html).
  const pages = readdirSync(ROOT, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name === 'index.html')
    .map((e) => relative(ROOT, join(e.parentPath, e.name)).replaceAll('\\', '/')).filter((p) => p !== 'index.html' && readFileSync(join(ROOT, p), 'utf8').includes('/ui/theme.js'));
  assert.ok(['photos/index.html', 'study/index.html', 'signin/index.html'].every((p) => pages.includes(p)), `found ${pages}`);
  for (const p of pages) {
    const own = /^(signin|setup|recover|import)\//.test(p);
    const seen = [];
    for (const look of ['classic', 'no-such-look']) {
      const { context, page, asked } = await phone({ look, session: !own });
      await page.goto(`${base}/${p.replace(/index\.html$/, '')}`, { waitUntil: 'load' });
      // (a page may send the phone on, to sign in or home: read where it comes to rest)
      for (let rested = false; !rested;) rested = await outlast(page, 600).then(() => true, () => page.waitForLoadState('load').then(() => false));
      seen.push(await page.evaluate(() => [location.pathname, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), Boolean(document.querySelector('link[data-look]'))]));
      assert.deepEqual(asked.filter((a) => a.startsWith('/look/')), [], `${p} asks for nothing of the look (${look})`);
      if (look !== 'classic') assert.equal(await page.evaluate(() => document.documentElement.dataset.look), 'ink-lamp', 'an unknown look is the default');
      await context.close();
    }
    assert.deepEqual(seen[1], seen[0], `${p} is drawn as it is with Classic`);
    assert.equal(seen[0][3], false);
  }
});

test('the island shows the artwork of what plays; the reels stand in where there is none or Artwork is off', opts, async () => {
  const { context, page, errors } = await phone();
  await home(page);
  await page.waitForSelector('html[data-look-ready]');
  const read = () => page.evaluate(() => {
    const is = document.querySelector('.th-island'), q = (s) => is.querySelector(s), box = (s) => { const b = q(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const text = document.createRange(); text.selectNodeContents(q('.title'));
    return { pictured: is.classList.contains('lk-i-art'), art: getComputedStyle(q('.art')).opacity, reels: getComputedStyle(q('.lk-i-reels')).display, deck: getComputedStyle(q('.lk-i-deck')).display,
      turning: [...is.querySelectorAll('.lk-i-reels i, .lk-i-deck i')].some((i) => i.getAnimations().length > 0), title: text.getBoundingClientRect().right,
      boxes: Object.fromEntries(['.art', '.title', '.lk-i-meter', '.compact', '.heading', '.elapsed', '.left', '.progress', '.tt'].map((s) => [s, box(s)])) };
  });
  // No artwork: the reels, turning, and the island's own dot unseen.
  await island(page);
  let c = await read();
  assert.deepEqual([c.pictured, c.art, c.reels, c.turning], [false, '0', 'block', true]);
  // With artwork: the picture, 24 px at the capsule's left, the title after it, the meter after the title.
  await island(page, { art: true });
  await page.waitForSelector('.th-island.lk-i-art');
  await settle(page);
  c = await read();
  assert.deepEqual([c.pictured, c.art, c.reels, c.turning], [true, '1', 'none', false]);
  const k = c.boxes;
  assert.ok(Math.abs(k['.art'].w - 24) < 0.5 && k['.art'].l >= k['.compact'].l + 4 && k['.art'].t >= k['.compact'].t + 4 && k['.art'].b <= k['.compact'].b - 4, `the picture sits inside the capsule: ${JSON.stringify([k['.art'], k['.compact']])}`);
  assert.ok(k['.title'].l >= k['.art'].r + 6, 'the title starts after the picture');
  assert.ok(c.title <= k['.lk-i-meter'].l - 6 && k['.lk-i-meter'].r <= k['.compact'].r - 10, `the meter follows the title inside the capsule: ${JSON.stringify([c.title, k['.lk-i-meter'], k['.compact']])}`);
  // The card: the picture at 72 px, the title beside it, the times at its foot over the progress dots.
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.wide(true)));
  await settle(page);
  c = await read();
  const d = c.boxes;
  assert.deepEqual([c.art, c.deck], ['1', 'none']);
  assert.ok(Math.abs(d['.art'].w - 72) < 0.5, `the picture is 72 px (${d['.art'].w})`);
  for (const s of ['.tt', '.elapsed']) assert.ok(d[s].l >= d['.art'].r + 10, `${s} stands beside the picture`);
  assert.ok(d['.heading'].b <= d['.elapsed'].t && d['.elapsed'].b <= d['.art'].b + 1 && d['.elapsed'].b <= d['.progress'].t - 6 && d['.left'].b <= d['.progress'].t - 6, `title, times, then the progress: ${JSON.stringify(d)}`);
  // Island › Artwork off: the deck and the reels again; on again, the picture.
  const artwork = (on) => page.evaluate((v) => import('/apps/settings/catalog.js').then((m) => m.setPhone(m.spec('island.art'), v)), on);
  await artwork(false);
  await page.waitForFunction(() => !document.querySelector('.th-island').classList.contains('lk-i-art'));
  c = await read();
  assert.deepEqual([c.art, c.deck, c.turning], ['0', 'block', true]);
  await artwork(true);
  await page.waitForSelector('.th-island.lk-i-art');
  // Classic chosen: the island's own picture, and nothing of the look's on it.
  await page.evaluate(() => import('/apps/settings/catalog.js').then((m) => m.setPhone(m.spec('appearance.look'), 'classic')));
  await page.waitForFunction(() => !document.querySelector('.th-island [class^="lk-i-"]'));
  assert.deepEqual(await page.evaluate(() => [document.querySelector('.th-island').classList.contains('lk-i-art'), getComputedStyle(document.querySelector('.th-island .art')).opacity]), [false, '1']);
  assert.deepEqual(errors, []);
  await context.close();
});
