// Ink and Lamp on the Briefing, the menu and Settings (frontend/look/briefing.*, menu.*, settings.css,
// controls*.js) in Chromium at 390×844 against the mocked Worker: off, nothing of theirs is asked for
// or added; on, by day (Ink) and by night (Lamp), the right typeface on the right text, the kit's
// pictures on the controls, tap areas of 44 px, body text at 4.5:1; the fader, the dial and the slide
// switches set their setting by a drag as a tap does (stored and announced), the keyboard still moves
// them, a vertical drag is left to the page; and the look turned off in Settings takes all of it away.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { resting, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Home, signed in, with `theme` and the look as given. */
async function open({ theme = 'light', look = 'ink-lamp' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(([t, l]) => {
    try {
      if (localStorage.getItem('th.p.sent')) return;
      localStorage.setItem('th.p.sent', '1');
      localStorage.setItem('th-theme', t);
      if (l) localStorage.setItem('th.s.appearance.look', l);
    } catch {}
  }, [theme, look]);
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await mockApi(page, {});
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  if (look) await page.waitForSelector('html[data-look-ready]');
  return { context, page, errors, asked };
}

/** Opens a Settings page by name and waits for it to rest. */
async function show(page, name) {
  await page.evaluate((n) => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: n } })), name);
  await page.waitForSelector(name === 'settings' ? '.spage.in #set-text' : `.spage.in .scatalog[data-group="${name}"]:not([aria-busy])`);
  await page.waitForFunction(() => { const p = [...document.querySelectorAll('.spage')].at(-1); return p && !p.classList.contains('moving'); });
  await resting(page);
}
const go = (page, where) => page.evaluate((w) => document.dispatchEvent(new CustomEvent('th:go', { detail: w })), where);

/** What the page shows of each probe: its typeface, colour, the ground under it, size, and pictures. */
const look = (page, probes) => page.evaluate((ps) => {
  const ground = getComputedStyle(document.body).backgroundColor;
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  return Object.fromEntries(Object.entries(ps).map(([k, sel]) => {
    const n = document.querySelector(sel);
    if (!n) return [k, null];
    const s = getComputedStyle(n), r = n.getBoundingClientRect();
    const pic = [getComputedStyle(n, '::before'), getComputedStyle(n, '::after')].map((p) => `${p.borderImageSource} ${p.backgroundImage}`).join(' ');
    return [k, { font: s.fontFamily.split(',')[0].replace(/"/g, ''), contrast: Math.round(ratio(s.color, ground) * 100) / 100, w: r.width, h: r.height, pic }];
  }));
}, probes);

/** Each key's legend against its own face: the face read from the kit picture the key shows now
 * (its ::before), at the middle of the picture, as the phone draws it. */
const legends = (page, sel) => page.evaluate(async (q) => {
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const out = [];
  for (const n of document.querySelectorAll(q)) {
    const src = getComputedStyle(n, '::before').borderImageSource.match(/url\("?([^")]+)"?\)/)?.[1];
    if (!src) { out.push([n.textContent, 0, 'no picture']); continue; }
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight }).getContext('2d');
    c.drawImage(img, 0, 0);
    const d = c.getImageData(img.naturalWidth / 2 - 6, img.naturalHeight / 2 - 6, 13, 13).data;
    const face = [0, 1, 2].map((i) => { let t = 0; for (let j = i; j < d.length; j += 4) t += d[j]; return t / (d.length / 4); });
    const ink = getComputedStyle(n).color.match(/[\d.]+/g).map(Number);
    const [x, y] = [lum(face), lum(ink)].sort((a, b) => b - a);
    out.push([n.textContent.trim(), Math.round((x + 0.05) / (y + 0.05) * 100) / 100, src.split('/').pop()]);
  }
  return out;
}, sel);

test('with the look off, Settings, the menu and the Briefing load and add nothing of it', opts, async () => {
  const { context, page, errors, asked } = await open({ look: '' });
  await show(page, 'settings');
  await show(page, 'appearance');
  await go(page, 'side');
  await page.waitForSelector('#convos .thr');
  await go(page, 'brief');
  await page.waitForFunction(() => !document.querySelector('#brief').inert);
  assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), []);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[class*="lk-"], [data-lk], .lk-stack')].map((n) => n.className)), []);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const theme of ['light', 'dark'])
  test(`on (${theme === 'light' ? 'Ink' : 'Lamp'}): typefaces, kit pictures, 44 px taps and 4.5:1 text on the three pages`, opts, async () => {
    const { context, page, errors } = await open({ theme });
    await show(page, 'settings');
    const home = await look(page, {
      title: '.spage.in .page-title', heading: '.spage.in .group-title', row: '.spage.in .slink .row-title', theme: '#set-theme .seg-option',
      back: '.spage.in .sheader .sback', cap: '#set-text .lk-fader', fader: '#set-text .seg-option', still: '#set-still .switch-track',
    });
    assert.equal(home.title.font, 'EB Garamond');
    assert.equal(home.row.font, 'EB Garamond');
    assert.equal(home.heading.font, 'Geist Mono');
    assert.equal(home.theme.font, 'Geist Mono');
    assert.match(home.theme.pic, /kit\/key-(light|dark)-(up|pressed)\.webp/, 'Theme is a row of kit keys');
    assert.match(home.back.pic, /kit\/round-(light|nearblack)-up\.webp/, 'the back key is the kit\'s round key');
    assert.match(home.cap.pic, /kit\/fader-cap-(light|dark)\.webp/, 'Text size is a fader');
    assert.match(home.still.pic, /kit\/thumb-small-(light|grey)\.webp/, 'a switch is the small slide switch');
    for (const k of ['theme', 'back', 'fader']) assert.ok(home[k].h >= 44 && home[k].w >= 44, `${k}: ${home[k].w}×${home[k].h}`);
    for (const k of ['title', 'row']) assert.ok(home[k].contrast >= 4.5, `${k} contrast ${home[k].contrast}`);
    const keys = [...await legends(page, '#set-theme .seg-option')];
    await show(page, 'appearance');
    const more = await look(page, {
      dial: '[data-key="appearance.motion"] .lk-dial', motion: '[data-key="appearance.motion"] .seg-option', thumb: '[data-key="appearance.haptics"] .lk-thumb',
      haptics: '[data-key="appearance.haptics"] .seg-option', detail: '.spage.in .row-detail', lookKey: '[data-key="appearance.look"] .seg-option', reset: '.spage.in [data-action="reset"]',
    });
    assert.match(more.dial.pic, /kit\/dial-(grey|dark)-small\.webp/, 'Motion is a dial');
    assert.match(more.thumb.pic, /kit\/thumb-(light|grey)\.webp/, 'Haptics is a slide switch');
    assert.match(more.lookKey.pic, /kit\/key-/, 'the Look setting is a row of keys');
    assert.match(more.reset.pic, /kit\/key-(black|dark)-up\.webp/, 'reset this page is a kit key');
    for (const k of ['motion', 'haptics', 'lookKey', 'reset']) assert.ok(more[k].h >= 44, `${k}: ${more[k].h}`);
    assert.ok(more.detail.contrast >= 4.5, `detail contrast ${more.detail.contrast}`);
    assert.equal(await page.isVisible('[data-key="appearance.accent"]'), false, 'Accent intensity is not shown under the look');
    keys.push(...await legends(page, '[data-key="appearance.look"] .seg-option, [data-key="appearance.glass"] .seg-option, .spage.in [data-action="reset"]'));
    await page.locator('.spage.in [data-action="reset"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(async () => !(await import('/th/ui.js')).tooSoon());
    await page.click('.spage.in [data-action="reset"]');
    await page.waitForSelector('.csheet.on .btn:not(.soft)');
    await resting(page);
    keys.push(...await legends(page, '.csheet.on .btn'));
    console.log(`key legends against their faces (${theme === 'light' ? 'Ink' : 'Lamp'}): ${keys.map(([t, r, f]) => `${t} ${r} on ${f}`).join('; ')}`);
    for (const [t, r, f] of keys) assert.ok(r >= 4.5, `"${t}" on ${f}: ${r}:1`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.csheet'));
    await page.click('.spage.in .sheader .sback');
    await page.waitForFunction(() => !document.querySelector('.spage'));
    await go(page, 'side');
    await page.waitForSelector('#convos .thr .when');
    await page.waitForSelector('#side .lk-lamb');
    const menu = await look(page, { title: '.sidetitle', row: '#convos .thr .row-title', when: '#convos .thr .when', group: '#convos .ghead .gl', detail: '#convos .thr .row-detail', settings: '#settings', dial: '#settings .lk-dial' });
    assert.equal(menu.title.font, 'EB Garamond');
    assert.equal(menu.row.font, 'EB Garamond');
    assert.equal(menu.when.font, 'Doto');
    assert.equal(menu.detail.font, 'Geist Mono');
    assert.match(menu.dial.pic, /kit\/dial-(grey|dark)-small\.webp/, 'Settings is the small dial');
    assert.ok(menu.settings.h >= 44 && menu.settings.w >= 44);
    for (const k of ['title', 'row', 'detail']) assert.ok(menu[k].contrast >= 4.5, `${k} contrast ${menu[k].contrast}`);
    // Now's date never runs under its detail or its caret: at every menu width and the largest text, it
    // ends in an ellipsis inside its own box.
    for (const width of ['narrow', 'regular', 'full']) {
      const now = await page.evaluate((w) => {
        const root = document.documentElement;
        root.setAttribute('data-menu-width', w);
        root.dataset.text = 'l';
        const box = (q) => document.querySelector(q).getBoundingClientRect();
        const sub = document.querySelector('#now .sub'), s = getComputedStyle(sub);
        const [t, v, c] = [box('#now .sub'), box('#now .row-value'), box('#now .row-caret')];
        const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { clipped: s.overflow === 'hidden' && s.textOverflow === 'ellipsis' && s.whiteSpace === 'nowrap', value: meets(t, v), caret: t.right > c.left };
      }, width);
      assert.deepEqual(now, { clipped: true, value: false, caret: false }, `Now at the ${width} width`);
    }
    await go(page, 'brief');
    await page.waitForFunction(() => !document.querySelector('#brief').inert);
    await page.waitForSelector('#brief .lk-verse:not([hidden]) .lk-ini');
    const brief = await look(page, { day: '#brief .lk-wd', verse: '#brief .lk-vt', ini: '#brief .lk-ini', line: '#brief .btitle', value: '#brief .tile .v', rubric: '#brief .tile .k', back: '#brief .lk-back' });
    assert.equal(brief.day.font, 'Jacquard 24');
    assert.equal(brief.ini.font, 'Jacquard 24');
    assert.equal(brief.verse.font, 'Lamp Fell');
    assert.equal(brief.line.font, 'EB Garamond');
    assert.equal(brief.value.font, 'EB Garamond');
    assert.ok(brief.back.h >= 44 && brief.back.w >= 44);
    for (const k of ['line', 'value', 'verse']) assert.ok(brief[k].contrast >= 4.5, `${k} contrast ${brief[k].contrast}`);
    await page.click('#brief .lk-back');
    await page.waitForFunction(() => document.querySelector('#brief').inert);
    assert.deepEqual(errors, []);
    await context.close();
  });

/** Drags with the mouse from the centre of `sel` by dx, dy, in steps. */
async function drag(page, sel, dx, dy = 0, from = 0.5) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width * from, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + dx * i / 8, y + dy * i / 8);
  await page.mouse.up();
  await resting(page);
}

test('the fader, the dial and the slide switches set their setting when dragged, as a tap does; keys and scrolls are as before', opts, async () => {
  const { context, page, errors } = await open();
  await show(page, 'settings');
  // Text size: from default to larger by the cap, then a vertical drag that changes nothing.
  await drag(page, '#set-text .lk-fader', 160);
  assert.equal(await page.evaluate(() => [localStorage.getItem('th-text'), document.documentElement.dataset.text]).then((v) => v.join()), 'l,l');
  assert.equal(await page.getAttribute('#set-text .seg-option[data-v="l"]', 'aria-checked'), 'true');
  await drag(page, '#set-text .lk-fader', -40, 120);
  assert.equal(await page.evaluate(() => localStorage.getItem('th-text')), 'l', 'a vertical drag is the page\'s');
  // The keyboard still moves it, and the cap follows.
  const at = () => page.$eval('#set-text .lk-fader', (n) => new DOMMatrix(getComputedStyle(n).transform).m41);
  const right = await at();
  await page.focus('#set-text .seg-option[data-v="l"]');
  await page.keyboard.press('ArrowLeft');
  await resting(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('th-text')), null, 'ArrowLeft goes back to default');
  assert.ok(await at() < right - 40, 'the cap followed the keyboard');
  // A switch: its thumb dragged across turns it on.
  await drag(page, '#set-still .switch-track', 20, 0, 0.2);
  assert.equal(await page.getAttribute('#set-still', 'aria-checked'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('th-still')), '1');
  await show(page, 'appearance');
  const heard = [];
  await page.exposeFunction('heard', (k, v) => heard.push(`${k}=${v}`));
  await page.evaluate(() => document.addEventListener('th:setting', (e) => window.heard(e.detail.key, e.detail.value)));
  // Motion: the dial turned across to its last position.
  await page.locator('[data-key="appearance.motion"]').scrollIntoViewIfNeeded();
  await drag(page, '[data-key="appearance.motion"] .lk-rot', 90);
  assert.equal(await page.evaluate(() => localStorage.getItem('th.s.appearance.motion')), 'off');
  assert.ok(heard.includes('appearance.motion=off'), 'announced as a tap is');
  // Haptics: the thumb slid to full.
  await page.locator('[data-key="appearance.haptics"]').scrollIntoViewIfNeeded();
  await drag(page, '[data-key="appearance.haptics"] .lk-thumb', 90);
  assert.equal(await page.evaluate(() => localStorage.getItem('th.s.appearance.haptics')), 'full');
  // A tap on an option still chooses it.
  await page.click('[data-key="appearance.haptics"] .seg-option[data-v="off"]');
  assert.equal(await page.evaluate(() => localStorage.getItem('th.s.appearance.haptics')), 'off');
  assert.equal(await page.$eval('[data-key="appearance.motion"] .seg', (s) => s.getAttribute('role')), 'radiogroup');
  // The look turned off from its own setting: every piece of it goes, the controls as they were.
  await page.locator('[data-key="appearance.look"]').scrollIntoViewIfNeeded();
  await page.click('[data-key="appearance.look"] [data-v="classic"]');
  await until(() => page.evaluate(() => !document.querySelector('[class*="lk-"], [data-lk], .lk-stack')), { message: 'the look\'s pieces stayed' });
  assert.equal(await page.evaluate(() => document.querySelector('#set-still .switch-track')?.style.getPropertyValue('--lk-x') ?? ''), '');
  assert.deepEqual(errors, []);
  await context.close();
});
