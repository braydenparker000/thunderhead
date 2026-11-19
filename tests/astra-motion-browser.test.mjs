// Astra's motion (src/ui/motion.js, FEEL.md) in a real Chromium, on Astra's own page: a shared
// element, a pushed screen and its Back, and a sheet each end in the right place, can be cancelled
// midway leaving things sane, and do nothing at level 'off'; the shell pushes and pops its screens
// and changes tabs through them, and Settings › Motion and touch saves and applies the level.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra && document.documentElement.dataset.motion);
  return { context, page, errors };
}

// Builds two boxes and a stage in the page, with ui/motion.js as window.M.
const STAGE = async (page) => page.evaluate(async () => {
  window.M = await import('/astra/src/ui/motion.js');
  document.querySelector('#stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:4000;background:#000';
  // Styles through the CSSOM: the page's CSP refuses style attributes in markup.
  window.box = (id, css, parent = stage) => { const d = document.createElement('div'); d.id = id; d.style.cssText = css; parent.append(d); return d; };
  box('under', 'position:absolute;inset:0;background:#333');
  box('over', 'position:absolute;inset:0;background:#444');
  box('a', 'position:absolute;left:20px;top:600px;width:100px;height:150px;background:#c33;border-radius:12px');
  box('b', 'position:absolute;left:0;top:0;width:390px;height:300px;background:#3c3');
  document.body.append(stage);
});

test('travel, push, pop and rise end in place, cancel cleanly, and do nothing when motion is off', opts, async () => {
  const { context, page, errors } = await open();
  await STAGE(page);
  const r = await page.evaluate(async () => {
    const M = window.M, $ = (s) => document.querySelector(s), out = {};
    M.setMotionChoice('full');
    out.level = M.level();
    // A shared element: a copy flies from #a to #b while both are hidden, then #b shows. #b (not seen yet)
    // is hidden at once; #a only once the copy has painted over it, two frames later.
    let started = 0;
    const t = M.travel($('#a'), $('#b'), { name: 'test:travel', onStart: () => started++ });
    const copy = [...document.body.children].at(-1);
    out.during = { hiddenA: $('#a').style.visibility, hiddenB: $('#b').style.visibility, copy: copy.getAttribute('aria-hidden'), started };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    out.during.after = $('#a').style.visibility;
    await new Promise((r) => setTimeout(r, 120));
    const mid = copy.getBoundingClientRect();
    out.midway = mid.top > 0 && mid.top < 600;
    // Where it lands: the copy sits at #b's place and size, and its flight ends untransformed there.
    const last = copy.getAnimations()[0].effect.getKeyframes().at(-1);
    const landing = { left: copy.style.left, top: copy.style.top, width: copy.style.width, height: copy.style.height, transform: last.transform };
    out.travel = await t.finished;
    out.travelEnd = { copyGone: !copy.isConnected, a: $('#a').style.visibility, b: $('#b').style.visibility, started, ...landing };
    // Cancelled midway: the copy goes and both originals show.
    const t2 = M.travel($('#a'), $('#b'), { name: 'test:travel' });
    await new Promise((r) => setTimeout(r, 60));
    t2.cancel();
    out.travelCancel = { result: await t2.finished, copies: document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length, a: $('#a').style.visibility, b: $('#b').style.visibility };
    // A pushed screen: #over comes in, #under recedes and stays so; Back brings it forward.
    const p = M.push($('#over'), $('#under'), { name: 'test:push' });
    out.pushOpaque = getComputedStyle($('#over')).opacity; // from its first frame: it only moves
    await new Promise((r) => setTimeout(r, 80));
    out.pushMid = getComputedStyle($('#over')).transform !== 'none';
    out.push = await p.finished;
    out.pushEnd = { over: getComputedStyle($('#over')).transform, under: getComputedStyle($('#under')).transform, dim: getComputedStyle($('#under')).opacity };
    const b = M.pop($('#under'), $('#over'), { name: 'test:pop' });
    out.pop = await b.finished;
    out.popEnd = { over: getComputedStyle($('#over')).opacity, under: getComputedStyle($('#under')).transform, underOpacity: getComputedStyle($('#under')).opacity };
    // Back during a push: the pop takes over from where the push was (no queue, no jump).
    $('#over').getAnimations().forEach((a) => a.cancel());
    const p2 = M.push($('#over'), $('#under'), { name: 'test:push' });
    await new Promise((r) => setTimeout(r, 60));
    const x = new DOMMatrixReadOnly(getComputedStyle($('#over')).transform).m41;
    const b2 = M.pop($('#under'), $('#over'), { name: 'test:pop' });
    const x2 = new DOMMatrixReadOnly(getComputedStyle($('#over')).transform).m41;
    out.retarget = { pushCut: (await p2.finished).cancelled, from: Math.abs(x2 - x) < 6, pop: await b2.finished };
    $('#over').getAnimations().forEach((a) => a.cancel());
    // A push cancelled midway leaves both at rest.
    const p3 = M.push($('#over'), $('#under'), { name: 'test:push' });
    await new Promise((r) => setTimeout(r, 60));
    p3.cancel();
    out.pushCancel = { result: await p3.finished, anims: $('#over').getAnimations().length + $('#under').getAnimations().length, over: getComputedStyle($('#over')).transform };
    // Rise: groups 30 ms apart, all in place at the end.
    const items = [...Array(6)].map(() => { const d = document.createElement('i'); $('#stage').append(d); return d; });
    out.rise = await M.rise(items, { name: 'test:rise' }).finished;
    out.riseEnd = items.every((d) => getComputedStyle(d).opacity === '1' && getComputedStyle(d).transform === 'none');
    // Off: nothing animates and nothing is copied; the end state is there at once.
    M.setMotionChoice('off');
    out.offLevel = [M.level(), document.documentElement.dataset.motion];
    const t3 = M.travel($('#a'), $('#b'), { name: 'test:off' });
    const p4 = M.push($('#over'), $('#under'), { name: 'test:off' });
    out.off = { anims: $('#stage').getAnimations({ subtree: true }).length, copies: document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length, travel: await t3.finished, push: await p4.finished, a: $('#a').style.visibility };
    M.setMotionChoice('system');
    out.report = M.feelReport();
    return out;
  });
  assert.equal(r.level, 'full');
  assert.deepEqual(r.during, { hiddenA: '', hiddenB: 'hidden', copy: 'true', started: 0, after: 'hidden' });
  assert.ok(r.midway, 'the copy is on its way at 120 ms');
  assert.deepEqual(r.travel, { cancelled: false });
  assert.deepEqual(r.travelEnd, { copyGone: true, a: '', b: '', started: 1, left: '0px', top: '0px', width: '390px', height: '300px', transform: 'none' });
  assert.deepEqual(r.travelCancel, { result: { cancelled: true }, copies: 0, a: '', b: '' });
  assert.ok(r.pushMid, 'the pushed screen is still moving at 80 ms');
  assert.equal(r.pushOpaque, '1', 'a pushed screen never blends with the one under it');
  assert.deepEqual(r.push, { cancelled: false });
  assert.equal(r.pushEnd.over, 'none');
  assert.match(r.pushEnd.under, /^matrix\(0\.98, 0, 0, 0\.98/);
  assert.equal(r.pushEnd.dim, '0.92');
  assert.deepEqual(r.pop, { cancelled: false });
  assert.deepEqual(r.popEnd, { over: '0', under: 'none', underOpacity: '1' });
  assert.deepEqual(r.retarget, { pushCut: true, from: true, pop: { cancelled: false } });
  assert.deepEqual(r.pushCancel, { result: { cancelled: true }, anims: 0, over: 'none' });
  assert.deepEqual(r.rise, { cancelled: false });
  assert.ok(r.riseEnd);
  assert.deepEqual(r.offLevel, ['off', 'off']);
  assert.deepEqual(r.off, { anims: 0, copies: 0, travel: { cancelled: false }, push: { cancelled: false }, a: '' });
  assert.match(r.report, /^Astra feel report\nmotion /);
  for (const name of ['test:travel', 'test:push', 'test:pop', 'test:rise']) assert.match(r.report, new RegExp(`^${name} `, 'm'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('a sheet rises, follows the finger, resists upward, dismisses past 30% and settles back short of it', opts, async () => {
  const { context, page, errors } = await open();
  await STAGE(page);
  await page.evaluate(() => {
    const scrim = window.box('scrim', 'position:fixed;inset:0;background:rgba(0,0,0,.5)');
    const s = window.box('sheet', 'position:fixed;left:10px;right:10px;bottom:10px;height:400px;background:#555;touch-action:none');
    window.box('grab', 'height:60px;touch-action:none', s).className = 'sheet-grab';
    window.M.setMotionChoice('full');
    window.dismissed = 0;
    window.S = window.M.sheet(s, { scrim, onDismiss: () => window.dismissed++, name: 'test:sheet' });
  });
  assert.deepEqual(await page.evaluate(() => window.S.finished), { cancelled: false });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).transform), 'none');
  const y = () => page.evaluate(() => Math.round(document.querySelector('#sheet').getBoundingClientRect().top));
  const rest = await y();
  // Up: one fifth of the finger. Down a little: it follows, the scrim lightens; released, it comes back.
  await page.mouse.move(195, rest + 30);
  await page.mouse.down();
  await page.mouse.move(195, rest - 70, { steps: 4 });
  assert.equal(await y(), rest - 20);
  await page.mouse.move(195, rest + 129, { steps: 20 });
  await page.waitForTimeout(150); // held still before letting go: no fling
  await page.mouse.move(195, rest + 130);
  assert.equal(await y(), rest + 100);
  assert.ok(Number(await page.evaluate(() => document.querySelector('#scrim').style.opacity)) < 1);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#sheet').getAnimations().length);
  assert.equal(await y(), rest, 'short of 30%: it settles back');
  assert.equal(await page.evaluate(() => window.dismissed), 0);
  // Past 30% of its height: dismissed, and it ends off screen.
  await page.mouse.move(195, rest + 30);
  await page.mouse.down();
  await page.mouse.move(195, rest + 200, { steps: 25 });
  await page.mouse.up();
  await page.waitForFunction(() => window.dismissed === 1);
  assert.ok((await y()) >= 844, 'gone below the screen');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#scrim')).opacity), '0');
  // Off: it is simply there, and closing is at once.
  const off = await page.evaluate(async () => {
    window.M.setMotionChoice('off');
    const s = document.querySelector('#sheet');
    s.getAnimations().forEach((a) => a.cancel());
    const c = window.M.sheet(s, { name: 'test:sheet' });
    const anims = s.getAnimations().length;
    const closed = await c.close().finished;
    return { anims, opened: await c.finished, closed };
  });
  assert.deepEqual(off, { anims: 0, opened: { cancelled: false }, closed: { cancelled: false } });
  assert.deepEqual(errors, []);
  await context.close();
});

test('the shell: a pushed screen and Back, tabs that fade, and Settings › Motion and touch', opts, async () => {
  const { context, page, errors } = await open();
  await page.waitForFunction(() => window.astra.tab === 'home');
  // A pushed screen moves through ui/motion.js; Back takes it away and removes it.
  await page.evaluate(() => window.astra.openStreams({ id: 'tt0000001', type: 'movie', name: 'Invented' }));
  await page.waitForFunction(() => document.querySelector('.screen-layer.in') && !document.querySelector('.screen-layer').getAnimations().length);
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.tab-view[data-tab=home]')).transform), /^matrix\(0\.98/, 'the tab under it recedes');
  await page.evaluate(() => window.astra.back());
  await page.waitForFunction(() => !document.querySelector('.screen-layer'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tab-view[data-tab=home]')).transform), 'none');
  // Tabs: the old fades, then is hidden; the new one takes touches at once.
  await page.locator('.nav-item[data-tab=settings]').click();
  assert.equal(await page.evaluate(() => document.querySelector('.tab-view[data-tab=settings]').inert), false);
  await page.waitForFunction(() => document.querySelector('.tab-view[data-tab=home]').classList.contains('off'));
  // Quick changes: only the last tab is left showing.
  await page.evaluate(() => { window.astra.selectTab('search', true); window.astra.selectTab('library', true); });
  await page.waitForFunction(() => [...document.querySelectorAll('.tab-view:not(.off)')].map((v) => v.dataset.tab).join() === 'library');
  await page.evaluate(() => window.astra.selectTab('settings', true));
  // The registry's page: Off is saved on this phone and reaches the root at once.
  await page.getByRole('button', { name: /Motion and touch/ }).click();
  await page.locator('.settings-page .chip', { hasText: 'Off' }).first().click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'off');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.device')).motion), 'off');
  assert.equal(await page.evaluate(() => window.astra.setting('motion')), 'off');
  assert.equal(await page.locator('.settings-page .chip[aria-pressed="true"]', { hasText: 'Off' }).count(), 1);
  // With motion off, Back is at once.
  await page.evaluate(() => window.astra.back());
  await page.waitForFunction(() => !document.querySelector('.screen-layer'));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'off', null, { timeout: 10_000 });
  assert.deepEqual(errors, []);
  await context.close();
});
