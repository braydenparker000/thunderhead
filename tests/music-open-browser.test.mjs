// How fast Music opens, and that its files kept for their release are safe (PERFORMANCE.md §3.1, "Opening on a
// weak link"; th/music/release.js, music/sw.js). The real page and worker, the mock API, and the weak link of
// scripts/open-speed.mjs (1.5 Mbit/s, 150 ms, 4x CPU): the times are read inside the page, from its own clock.
// Safety, with what the owner sees: an open of the same release asks the network for its page and /release.json
// and for no file of the app or the site's shared scripts, and the app starts; a new release's next open is all
// new; a /release.json that never answers costs one wait and the app starts from its offline copies, asking the
// network for none of its files; with no signal the app starts; a release.js that fails to load leaves the
// worker as it was before; Repair clears the release's cache. Local only.
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
  const r = await measure(browser, env.link, PAGES.find((p) => p.name === 'music'));
  console.log(`# music cold ${r.cold.ready} ms (${r.cold.requests} requests), warm ${r.warm.ready} ms (${r.warm.requests} requests)`);
  assert.ok(r.cold.ready <= COLD_MS, `cold open ${r.cold.ready} ms, budget ${COLD_MS}`);
  assert.ok(r.warm.ready <= WARM_MS, `warm open ${r.warm.ready} ms, budget ${WARM_MS}`);
  assert.ok(r.warm.requests <= WARM_REQUESTS, `warm open made ${r.warm.requests} requests, budget ${WARM_REQUESTS}`);
});

test('the release\'s cache: what the owner sees on the same release, a new one, a silent link, no signal, a broken worker file, and Repair', opts, async () => {
  const site = env.site, base = `http://127.0.0.1:${site.address().port}`;
  const started = () => window.__cp && !document.getElementById('cp-boot');   // only the app's running scripts make this true
  const appFiles = () => site.asked.filter((p) => p.startsWith('music/') && !p.endsWith('index.html') && p !== 'music/sw.js');
  const shared = () => site.asked.filter((p) => /^(th|assets|ui)\/.*\.js$|^config\.js$/.test(p) && !/^th\/(music\/(bridge|release)|ported\/frames|data\/worker)\.js$/.test(p));
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

    // The same release: its page and /release.json from the network; no file of the app, no shared script.
    site.files.set('music/app.css', Buffer.from(`${await (await fetch(`${base}/music/app.css`)).text()}\n/* release 2 */\n`));
    site.asked.length = 0;
    page = await open();
    assert.ok(site.asked.includes('release.json') && site.asked.includes('music/index.html'), 'the page and the release are asked at each open');
    assert.deepEqual(appFiles(), [], 'no file of the app was asked');
    assert.deepEqual(shared(), [], 'no shared script was asked');
    await page.close();

    // A new release: the next open is all new, and the app starts.
    site.release(2);
    site.asked.length = 0;
    page = await open();
    for (const f of ['music/app.css', 'music/src/app.js', 'music/model/reference.json.gz']) assert.ok(site.asked.includes(f), `${f} comes from the network`);
    assert.ok(shared().length > 5, `the shared scripts come from the network: ${shared().join(' ')}`);
    assert.match(await page.evaluate(() => fetch('/music/app.css').then((r) => r.text())), /release 2/);
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
