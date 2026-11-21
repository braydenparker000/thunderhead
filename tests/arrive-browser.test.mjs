// Moving between home and an app's own page (HOME.md §12; ui/launch.js, ui/arrive.js, ui/theme.js):
// the app's page uncovers from the launch colour that covered home, as one cross-document view
// transition (the colour held, only the page fading in over it), and none runs when the owner
// turned the launch off. Back to a home the browser kept whole uncovers home from that colour. A
// theme change cross-fades the screen (ui/theme.js), at once with reduced motion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { afterFirstPaint, until } from './fixtures/waits.mjs';

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function home(prefs = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await page.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) localStorage.setItem(`th.s.${k}`, v);
    if (!localStorage.getItem('th-theme')) localStorage.setItem('th-theme', 'light');
    // What the arriving page's transition does, kept where the test can read it after the move.
    addEventListener('pagereveal', (e) => {
      if (location.pathname !== '/guitar/') return;
      const vt = e.viewTransition;
      sessionStorage.setItem('arrive', JSON.stringify({ vt: !!vt }));
      vt?.ready.then(() => requestAnimationFrame(() => {
        const runs = document.getAnimations().filter((a) => /^::view-transition-(old|new)/.test(a.effect?.pseudoElement ?? ''))
          .map((a) => ({ on: a.effect.pseudoElement, ms: a.effect.getTiming().duration }));
        vt.finished.then(() => sessionStorage.setItem('arrive', JSON.stringify({ vt: true, runs, done: true })));
      }));
    });
  }, prefs);
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await afterFirstPaint(page);
  return page;
}
const open = (page) => page.evaluate(async () => {
  const { from, launch } = await import('/ui/launch.js');
  from(250, 400);
  await launch('#e08a1e');
  location.assign('/guitar/');
});
const arrived = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('arrive') || 'null'));

test('home starts the movement only toward the app pages that take it (those loading ui/arrive.css)', () => {
  const root = new URL('../frontend/', import.meta.url);
  const pages = readdirSync(root).filter((d) => existsSync(new URL(`${d}/index.html`, root)) && readFileSync(new URL(`${d}/index.html`, root), 'utf8').includes('/ui/arrive.css')).sort();
  const named = /\(\?:([a-z|]+)\)\\\/\$\/\.test\(to\) && document/.exec(readFileSync(new URL('ui/theme.js', root), 'utf8'))?.[1].split('|').sort();
  assert.deepEqual(named, pages);
});

test('an app opened from home uncovers from the launch colour: the colour holds, only the page fades in', async () => {
  const page = await home();
  await open(page);
  await page.waitForURL('**/guitar/');
  const got = await until(async () => (await arrived(page))?.done && arrived(page), { message: 'the move to the app never finished' });
  assert.equal(got.vt, true, 'a cross-document view transition from home');
  assert.deepEqual(got.runs, [{ on: '::view-transition-new(root)', ms: 300 }], 'only the page fades in (--d-base) over the held colour');
  await page.close();
});

test('with the launch turned off, the app comes at once', async () => {
  const page = await home({ 'appearance.launch': 'none' });
  await open(page);
  await page.waitForURL('**/guitar/');
  await until(async () => (await arrived(page)) !== null);
  assert.deepEqual(await arrived(page), { vt: false });
  await page.close();
});

test('back to a home the browser kept, the launch colour fades off it', async () => {
  const page = await home();
  await page.evaluate(async () => { const { launch } = await import('/ui/launch.js'); await launch('#e08a1e'); });
  assert.equal(await page.locator('.launch').count(), 1);
  // As the browser does when Back shows the page from its back/forward cache.
  // Dispatched and read in one evaluate, so the fade is read while it runs, however slow the runner.
  const fadesTo = await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return document.querySelector('.launch').getAnimations().at(-1).effect.getKeyframes().at(-1).opacity;
  });
  assert.equal(fadesTo, '0');
  await until(async () => (await page.locator('.launch').count()) === 0, { message: 'the colour stayed over home' });
  await page.close();
});

test('a theme change cross-fades the screen; with reduced motion it is at once', async () => {
  const page = await home();
  // The cross-fade the page asks for is kept here (document.activeViewTransition is newer than the browser CI runs).
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => { const fade = start(update); window.__fade = fade; fade.finished.finally(() => { window.__fade = null; }); return fade; };
  });
  const change = (to) => page.evaluate((to) => {
    document.dispatchEvent(new CustomEvent('th:theme', { detail: to }));
    return { now: document.documentElement.dataset.theme, fading: !!window.__fade };
  }, to);
  assert.deepEqual(await change('dark'), { now: 'light', fading: true }, 'the change waits for the cross-fade to take its picture');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !window.__fade);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await change('light'), { now: 'light', fading: false });
  await page.close();
});
