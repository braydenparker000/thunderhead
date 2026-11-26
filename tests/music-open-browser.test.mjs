// How fast Music opens, and that its files kept for their release are safe (PERFORMANCE.md §3.1, "Opening on a
// weak link"; th/music/release.js, music/sw.js). The real page and worker, the mock API, and the weak link of
// scripts/open-speed.mjs (1.5 Mbit/s, 150 ms, 4x CPU): the times are read inside the page, from its own clock.
// Safety, with what the owner sees: once a page has started from the kept release, an open of the same release
// asks the network for /release.json only, in the background, and for neither its page nor any file of the app
// or the site's shared scripts, and the app starts; a new release is saved whole in the background while the app
// starts from the old one, and the next open is all new; a /release.json that never answers costs no wait and
// the app starts, asking the network for none of its files; with no signal the app starts; a release.js that
// fails to load leaves the worker as it was before; Repair clears the release's cache. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, launch, measure, phone, start } from '../scripts/open-speed.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 240_000 };
// Measured 2026-11-22 on the agents' shared 4-core VM (scripts/open-speed.mjs, PERFORMANCE.md §3.1): cold 14.5 s
// (2.4 MB over the link: the link's own pace), warm 4.42 s before the release's cache and 1.2–1.5 s after it
// (three runs), 151 requests before and 6 after. The budgets are those numbers with a margin for a loaded runner.
const COLD_MS = 19_000, WARM_MS = 2_500, WARM_REQUESTS = 10;
let env, browser;

before(async () => {
  if (live) return;
  env = await start();
  browser = await launch();
});
after(async () => { await browser?.close(); env?.close(); });

test('Music opens warm in a fraction of its cold time, measured in the page, and asks for its page and the release only', opts, async () => {
  // Three warm opens, the fastest judged against the time budget (a loaded runner made one open 3,451 ms
  // with the same 7 requests, 2026-11-23); every one of them is held to the request budget.
  const r = await measure(browser, env.link, PAGES.find((p) => p.name === 'music'), { warmRuns: 3 });
  console.log(`# music cold ${r.cold.ready} ms (${r.cold.requests} requests), warm ${r.warms.map((w) => `${w.ready} ms (${w.requests} requests)`).join(', ')}`);
  assert.ok(r.cold.ready <= COLD_MS, `cold open ${r.cold.ready} ms, budget ${COLD_MS}`);
  assert.ok(r.warm.ready <= WARM_MS, `warm open ${r.warm.ready} ms, budget ${WARM_MS}`);
  for (const w of r.warms) assert.ok(w.requests <= WARM_REQUESTS, `warm open made ${w.requests} requests, budget ${WARM_REQUESTS}: ${w.paths.join(' ')}`);
});

test('the release\'s cache: what the owner sees on the same release, a new one, a silent link, no signal, a broken worker file, and Repair', opts, async () => {
  const site = env.site, base = `http://127.0.0.1:${site.address().port}`;
  const started = () => window.__cp && !document.getElementById('cp-boot');   // only the app's running scripts make this true
  const appFiles = () => site.asked.filter((p) => p.startsWith('music/') && !p.endsWith('index.html') && p !== 'music/sw.js');
  // (Not the worker's own scripts, music/sw.js's importScripts and theirs: the browser's update check revalidates
  // those on an open, each after the one before, so how many it has asked by now is a matter of timing.)
  const shared = () => site.asked.filter((p) => /^(th|assets|ui)\/.*\.js$|^config\.js$/.test(p) && !/^th\/(music\/(bridge|release|downloads|zip-stream|ogg-cover)|ported\/frames|data\/worker)\.js$/.test(p));
  /** A phone with Music's worker, opened twice under it (the first fills the release's cache). */
  const prepared = async () => {
    const { context } = await phone(browser, { base });
    const open = async (wait = 'load') => {
      const page = await context.newPage();
      await page.goto(`${base}/music/`, { waitUntil: wait });
      await page.waitForFunction(started, null, { timeout: 60_000 });
      return page;
    };
    const page = await open();
    await page.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
    await page.close();
    await (await open()).close();
    return { context, open };
  };
  try {
    const { context, open } = await prepared();
    let page = await open();
    assert.ok(await page.evaluate(() => caches.has('claude-player-release')));
    await page.close();

    // The same release: the page and every file from the kept set; only /release.json is asked, in the background.
    site.files.set('music/app.css', Buffer.from(`${await (await fetch(`${base}/music/app.css`)).text()}\n/* release 2 */\n`));
    site.asked.length = 0;
    page = await open();
    await until(() => site.asked.includes('release.json'), { message: 'the release was never asked' });
    assert.ok(!site.asked.includes('music/index.html'), 'the page came from the kept set');
    assert.deepEqual(appFiles(), [], 'no file of the app was asked');
    assert.deepEqual(shared(), [], 'no shared script was asked');
    assert.doesNotMatch(await page.evaluate(() => fetch('/music/app.css').then((r) => r.text())), /release 2/, 'the kept file, not the network\'s');
    await page.close();

    // A new release: this open starts from the kept set while the new files are saved whole in the background;
    // the next open is all new, and the app starts.
    site.release(2);
    site.asked.length = 0;
    page = await open();
    const saved = () => page.evaluate(async () => {
      const mark = await (await caches.open('claude-player-release')).match('/music/th-release-id');
      return mark ? JSON.parse(await mark.text()).next !== null : false;
    });
    await until(saved, { timeout: 60_000, message: 'the new release was never saved' });
    for (const f of ['music/index.html', 'music/app.css', 'music/src/app.js', 'music/model/reference.json.gz']) assert.ok(site.asked.includes(f), `${f} came from the network, in the background`);
    assert.ok(shared().length > 5, `the shared scripts came from the network: ${shared().join(' ')}`);
    assert.doesNotMatch(await page.evaluate(() => fetch('/music/app.css').then((r) => r.text())), /release 2/, 'the open page keeps its own release');
    await page.close();
    site.asked.length = 0;
    page = await open();
    assert.match(await page.evaluate(() => fetch('/music/app.css').then((r) => r.text())), /release 2/, 'the next open: the new release');
    assert.deepEqual(appFiles(), [], `the new release's files came from its kept set: ${appFiles().join(' ')}`);
    await page.close();

    // /release.json never answers: one wait, then the offline copies answer at once (badUntil); the app starts.
    site.hang.add('release.json');
    site.asked.length = 0;
    page = await open('commit');
    assert.deepEqual(appFiles(), [], `the app's files came from its offline copies: ${appFiles().join(' ')}`);
    site.hang.delete('release.json');
    await page.close();

    // No signal: the app starts.
    site.signal(false);
    page = await open('commit');
    await page.close();
    site.signal(true);

    // Repair (no dependency on what Music keeps) clears the release's cache and Music's worker.
    page = await context.newPage();
    await page.goto(`${base}/repair/`);
    await until(() => page.evaluate(async () => !(await caches.has('claude-player-release')) && !(await navigator.serviceWorker.getRegistrations()).some((r) => r.scope.endsWith('/music/'))).catch(() => false), { timeout: 30_000, message: 'Repair never cleared Music\'s release cache' });
    await page.close();
    await context.close();

    // release.js fails to load: the worker works as it did before it (every file from the network), and the app starts.
    site.files.set('th/music/release.js', Buffer.from('this is not a script {'));
    const broken = await prepared();
    site.asked.length = 0;
    page = await broken.open();
    assert.ok(site.asked.includes('music/src/app.js'), 'the files come from the network, as before');
    assert.equal(await page.evaluate(() => caches.has('claude-player-release')), false);
    await page.close();
    await broken.context.close();
  } finally {
    site.files.clear();
    site.hang.clear();
    site.release(1);
    site.signal(true);
  }
});
