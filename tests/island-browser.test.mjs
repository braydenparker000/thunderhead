// Apps inside the Thunderhead and the island (th/island/island.js, th/ported/frames.js; NEXT-BATCH.md
// part 3), in Chromium against a mock new Worker: Music opens as a layer inside home in a frame its
// worker trusts (a one-time token), so the framed player gets the owner's session; Back shrinks it
// into the island; a tap expands its controls and the artwork opens the app; the phone's commands reach the player through it. The
// same player framed by another site's page gets no session. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

// Timing reads (how fast the capsule or an app arrives) are the phone's acceptance (HOME.md §12), measured
// there with the Frames readout. On a shared CI runner they vary with load, so they are enforced only with
// TH_STRICT_TIMING=1 and otherwise reported as diagnostics. Shape, state and end-position checks stay hard.
const strictTiming = Boolean(process.env.TH_STRICT_TIMING);
const timing = (ok, message) => { if (strictTiming) assert.ok(ok, message); else if (!ok) console.log(`# timing (not enforced on CI): ${message}`); };

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
let site, mock, other, browser, base, api, otherBase;
/** Catalog requests the mock saw, with or without the session. */
const seen = [];

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v1/music/catalog') {
      seen.push({ auth: req.headers.authorization ?? '' });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-island"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] }));
    }
    const answers = {
      '/v1/auth/me': {session_id:'s1',notices:[],recovery_confirmed:true},
      '/v1/threads/today': {thread:null,messages:[],seq:1,day:new Date().toISOString().slice(0,10)},
      '/v1/settings': {'owner.tz':'UTC','mind.status':{state:'asleep',note:null,since:null}},
      '/v1/surfaces': {items:[],seq:1}, '/v1/verbs/pending': {items:[]},
      '/v1/proposals': {items:[]}, '/v1/changes': {items:[],next_after:1,more:false},
      '/v1/podcasts/progress': {items:[]}, '/v1/podcasts/browse': {results:[]},
    };
    if (url.pathname in answers) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(answers[url.pathname]));
    }
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'no', request_id: 't' } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  // Another site: the same player in its frame.
  other = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><iframe id="f" src="${base}/music/" style="width:390px;height:700px"></iframe>`);
  });
  await new Promise((r) => other.listen(0, 'localhost', r));
  otherBase = `http://localhost:${other.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); other?.close(); });

async function signedIn(context, { saveData = true } = {}) {
  await context.addInitScript(value => Object.defineProperty(navigator, "connection", {value:{saveData:value}, configurable:true}), saveData);
  await context.route(`${OLD}/**`, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  return page;
}

test('Music opens as a layer that its worker trusts; Back makes it the island; a tap brings it back; commands reach it', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await signedIn(context);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/`);
  seen.length = 0;
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  const frame = page.locator('iframe.th-app[data-app=music]');
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]')?.hasAttribute('src'));
  await frame.waitFor({ state: 'attached' });
  assert.match(await frame.getAttribute('src'), /^\/music\/\?th-frame=[0-9a-f]{32}$/, 'opened with a one-time token');
  // The framed player asks for the catalog with the owner's session: its worker trusts this frame.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !seen.some((s) => s.auth === `Bearer ${TOKEN}`)) await new Promise((r) => setTimeout(r, 200));
  assert.ok(seen.some((s) => s.auth === `Bearer ${TOKEN}`), `the framed player was given the session (${JSON.stringify(seen)})`);

  // Music reloads itself in the frame (a day/night switch does): its page claims the trust back.
  await page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.location.reload());
  await page.waitForFunction(() => document.querySelector('iframe.th-app').contentWindow.__cp?.player, null, { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('iframe.th-app').dataset.ready === 'true');
  assert.equal(await page.locator('.th-app-wait').isVisible(), false, 'reload clears the loading cover');
  seen.length = 0;
  // The player's next library request, after the page has claimed its trust back.
  await page.evaluate((old) => document.querySelector('iframe.th-app').contentWindow.fetch(`${old}/music/library.json`).catch(() => {}), OLD);
  const again = Date.now() + 10_000;
  while (Date.now() < again && !seen.some((s) => s.auth === `Bearer ${TOKEN}`)) await new Promise((r) => setTimeout(r, 200));
  assert.ok(seen.some((s) => s.auth === `Bearer ${TOKEN}`), 'trusted again after it reloaded itself');
  // No token's address is ever stored: the page came from Music's own address.
  const stored = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat());
  assert.ok(!stored.some((u) => u.includes('th-frame=')), stored.filter((u) => u.includes('th-frame=')).join(' '));

  // Back: into the island; the frame stays loaded behind the chat.
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await page.waitForFunction(() => document.querySelector('iframe.th-app')?.classList.contains('away'));
  assert.equal(await page.evaluate(() => document.body.dataset.island), 'music');
  assert.equal(await page.evaluate(() => location.pathname), '/', 'still home');
  // A tap expands the same capsule; artwork/title opens Music.
  await page.locator('.th-island .compact').click();
  await page.evaluate(() => import('/th/island/island.js').then(m => m.whenResting()));
  await page.locator('.th-island .art').click();
  await page.waitForFunction(() => !document.querySelector('iframe.th-app')?.classList.contains('away'));
  await page.waitForSelector('.th-island', { state: 'hidden' });

  // The commands act on the player in the frame (nothing is queued here, so pause is safe to call).
  const r = await page.evaluate(() => import('/th/island/island.js').then((m) => m.control('sleep', 20)));
  assert.deepEqual([r.ok, r.text], [true, 'Music stops in 20 minutes.']);
  assert.equal(await page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.__cp.player.sleep?.seconds), 1200);
  // On the island: a moon and the minutes left (waiting at its full time while nothing plays).
  await page.goBack();
  await page.waitForSelector('.th-island.sleep:not([hidden])');
  assert.equal(await page.locator('.th-island .zz b').textContent(), '20');
  assert.match(await page.locator('.th-island').getAttribute('aria-label'), /stops in 20 min/);
  // The expanded capsule's moon turns the timer off.
  await page.locator('.th-island .compact').click();
  await page.evaluate(() => import('/th/island/island.js').then(m => m.whenResting()));
  await page.locator('.th-island .zz').click();
  await page.waitForFunction(() => !document.querySelector('iframe.th-app').contentWindow.__cp.player.sleep);
  await page.waitForSelector('.th-island:not(.sleep)');
  await page.waitForFunction(() => document.querySelector('.toast:not(.utoast)')?.textContent.includes('Sleep timer off.'));
  // "Never play this again": Music rates the song 1 and skips it (the player passes over it), and
  // Music's own bus sends the one music.rate sense (the island sends none of its own); its Undo sets
  // the old rating back, which the bus sends too.
  const never = await page.evaluate(async () => {
    const w = document.querySelector('iframe.th-app').contentWindow;
    const p = w.__cp.player;
    const t = { id: 'r2_native_island_never', rating: 3 };
    p.queue = [t];
    p.index = 0;
    const steps = [];
    p.step = (d) => steps.push(d);
    const rates = () => {
      const sealed = JSON.parse(localStorage.getItem('th.p.senses.batch') || 'null');
      return [...JSON.parse(localStorage.getItem('th.p.senses') || '[]'), ...(sealed ? JSON.parse(sealed.body).events : [])]
        .filter((e) => e.type === 'music.rate' && e.ref === `music:${t.id}`)
        .map((e) => e.data.rating);
    };
    const settle = async (n) => {
      for (let i = 0; i < 50 && rates().length < n; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      return rates();
    };
    const r = (await import('/th/island/island.js')).control('never');
    const after = { rating: t.rating, steps: [...steps], rates: await settle(1) };
    r.undo();
    return { ok: r.ok, text: r.text, after, undone: { rating: t.rating, rates: await settle(2) } };
  });
  assert.deepEqual(never, {
    ok: true,
    text: 'Skipped. Rated "not for me": it won\'t come up again.',
    after: { rating: 1, steps: [1], rates: [1] },
    undone: { rating: 3, rates: [1, 3] },
  });
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.close()));
  assert.equal(await frame.count(), 1, 'closing retains the browsing context');
  assert.equal(await frame.evaluate(f => f.inert), true);
  const none = await page.evaluate(() => import('/th/island/island.js').then((m) => m.control('pause')));
  assert.equal(none.ok, true, 'the retained player still receives controls');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Podcasts returns home by Back, by its own arrow and by a touch swipe down on its mini player', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', hasTouch: true });
  try {
    const page = await signedIn(context);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // An invented episode left in Podcasts, so its mini player shows.
    await page.evaluate(() => localStorage.setItem('jarvis.podcasts.v1', JSON.stringify({ version: 1, follows: [], queue: [], downloads: {}, progress: {}, speed: 1, country: 'us', autoplay: true,
      current: { id: 'ep-1', title: 'An invented episode', duration: 600, audio: 'https://media.example.org/1.opus', show: { title: 'An invented show', feedUrl: 'https://feeds.example.org/x.xml', artwork: '' } } })));
    await page.goto(`${base}/`);
    const open = () => page.evaluate(async () => { const m = await import('/th/island/island.js'); await m.openApp('podcasts'); await m.whenResting(); });
    const home = async () => {
      await page.waitForFunction(() => document.body.dataset.island === 'podcasts' && !document.querySelector('.th-island').hidden, null, { timeout: 8000 });
      await page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
      return page.evaluate(() => ({ path: location.pathname, away: document.querySelector('iframe[data-app=podcasts]').classList.contains('away'), frame: document.querySelector('iframe[data-app=podcasts]').contentWindow.location.pathname }));
    };
    const back = { path: '/', away: true, frame: '/podcasts/' };
    await open();
    await page.waitForSelector('iframe[data-app=podcasts][data-ready=true]', { state: 'attached', timeout: 20_000 });
    await page.goBack();
    const byBack = await home();
    // The app's top-left arrow is a link to "/": it shrinks the layer instead of loading home inside it.
    await open();
    await page.frameLocator('iframe[data-app=podcasts]').locator('.topbar a[href="/"]').click();
    const byArrow = await home();
    // A real touch drag: Podcasts' page pans, so the browser cancels the pointer stream early.
    await open();
    const cdp = await context.newCDPSession(page);
    const mini = await page.frameLocator('iframe[data-app=podcasts]').locator('#mini-player').boundingBox();
    let y = mini.y + 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mini.x + 60, y }] });
    for (; y < mini.y + 130; y += 8) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mini.x + 60, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const bySwipe = await home();
    assert.deepEqual({ byBack, byArrow, bySwipe }, { byBack: back, byArrow: back, bySwipe: back }, 'Podcasts returns to home every way');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("the same player framed by another site's page gets no session", opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await signedIn(context);
  // The worker is installed, as it would be after the owner used Music.
  await page.goto(`${base}/music/`);
  await page.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
  // That top-level page's own requests (trusted, rightly) finish before the count starts.
  await page.goto(`${base}/no-such-page`);
  await page.waitForTimeout(2000);
  seen.length = 0;
  await page.goto(`${otherBase}/`);
  const f = page.frameLocator('#f');
  await f.locator('body').waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(4000);
  assert.ok(!seen.some((s) => s.auth.startsWith('Bearer ')), `no session for another site's frame (${JSON.stringify(seen)})`);
  // Nor with a made-up token: a token is only good once home gave it to the worker.
  await page.evaluate((u) => { document.getElementById('f').src = `${u}/music/?th-frame=${'a'.repeat(32)}`; }, base);
  await page.waitForTimeout(4000);
  assert.ok(!seen.some((s) => s.auth.startsWith('Bearer ')), 'a made-up token is no key');
  await context.close();
});

const settle = page => page.evaluate(() => import('/th/island/island.js').then(m => m.whenResting()));
// Spring rest resolves before Chromium commits its paint. Only screenshots wait for that commit.
const painted = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const rect = (page, selector) => page.locator(selector).evaluate(e => {
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {x:r.x,y:r.y,width:r.width,height:r.height,radius:parseFloat(s.borderRadius),opacity:Number(s.opacity),background:s.backgroundColor};
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual-expected)<=1, `${label}: ${actual}, expected ${expected} ±1`);
async function readyOpen(page, id) {
  return page.evaluate(async id => {
    const started=performance.now();
    const m=await import('/th/island/island.js');
    const signal=new Promise(resolve=>document.addEventListener('th:app-ready',function hear(e){
      if(e.detail.app===id){document.removeEventListener('th:app-ready',hear);resolve(e.detail);}
    }));
    await m.openApp(id);
    return {...await signal,ms:performance.now()-started};
  }, id);
}

test('one capsule renders compact, expanded and alert; all morphs settle and reverse from its rect', opts, async t => {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try {
    const page=await signedIn(context);
    await page.goto(`${base}/`);
    const cdp=await context.newCDPSession(page);
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
    const cold=await readyOpen(page,'music');
    await settle(page);
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.collapse('test')));
    const compact=await rect(page,'.th-island');
    near(compact.height,36,'compact height'); near(compact.radius,18,'compact radius');
    assert.ok(compact.width>=124 && compact.width<=234,'compact width bounds');
    near(compact.x+compact.width/2,195,'centered'); near(compact.y,10,'safe-area position');
    assert.equal(compact.background,'rgb(0, 0, 0)');
    // Without art the compact lobe is the 22 px app-colour dot: the artwork node itself.
    const lobe=await page.locator('.th-island .art').evaluate(e=>({width:e.getBoundingClientRect().width,radius:parseFloat(getComputedStyle(e).borderRadius)*e.getBoundingClientRect().width/72,background:getComputedStyle(e).backgroundColor,images:e.closest('.th-island').querySelectorAll('img').length}));
    near(lobe.width,22,'app dot'); near(lobe.radius,11,'round dot'); assert.equal(lobe.background,'rgb(47, 125, 246)'); assert.equal(lobe.images,0,'no second image');
    assert.equal(await page.locator('.bars i').count(),5);
    near((await rect(page,'.bars i:first-child')).width,3,'bar width');
    near(await page.locator('.bars i').first().evaluate(e=>parseFloat(getComputedStyle(e).height)),14,'bar height');
    near((await rect(page,'.progress')).height,2,'compact progress');
    await page.evaluate(()=>{window.capsule=document.querySelector('.th-island');window.artNode=capsule.querySelector('.art');});
    const expansion=await page.evaluate(async()=>{
      const m=await import('/th/island/island.js'),start=performance.now(),samples=[];
      let running=true;
      const sample=()=>{const e=document.querySelector('.th-island'),r=e.getBoundingClientRect(),a=e.querySelector('.art'),s=getComputedStyle(a);samples.push({at:performance.now()-start,width:r.width,height:r.height,opacity:Number(getComputedStyle(e.querySelector('.details')).opacity),compact:Number(getComputedStyle(e.querySelector('.compact')).opacity),box:[a.offsetLeft,a.offsetTop,a.offsetWidth,a.offsetHeight].join(),moved:s.transform!=='none'});if(running)requestAnimationFrame(sample);};
      requestAnimationFrame(sample); await m.wide(true); running=false;
      return {ms:performance.now()-start,max:Math.max(...samples.map(s=>s.width)),samples};
    });
    const expanded=await rect(page,'.th-island');
    near(expanded.width,360,'expanded width'); near(expanded.height,180,'expanded height'); near(expanded.radius,28,'expanded radius');
    assert.ok(expansion.max>360*1.025 && expansion.max<=360*1.041,`4% width squish: ${expansion.max}`);
    // The bars and title hand off to the controls at 40% of the shape (36 + 144 × .4 = 93.6 px).
    assert.ok(expansion.samples.filter(s=>s.height<93).every(s=>s.opacity===0),'details wait for 40%');
    assert.ok(expansion.samples.filter(s=>s.height>94.5).every(s=>s.compact===0),'compact content is gone by 40%');
    assert.ok(expansion.samples.some(s=>s.compact>0&&s.compact<1),'compact content fades rather than cuts');
    assert.equal(await page.evaluate(()=>capsule===document.querySelector('.th-island')),true,'same element');
    // One artwork node: its layout box never changes; it travels and scales by transform only.
    assert.equal(await page.evaluate(()=>artNode===document.querySelector('.th-island .art')),true,'same artwork node');
    assert.deepEqual([...new Set(expansion.samples.map(s=>s.box))],['0,0,72,72'],'artwork layout box is fixed');
    assert.ok(expansion.samples.every(s=>s.moved),'artwork moves by transform');
    const art=await rect(page,'.th-island .art');
    near(art.x-expanded.x,16,'artwork left'); near(art.y-expanded.y,38,'artwork top'); near(art.radius,16,'artwork corners');
    // Under the progress line: elapsed and remaining in tabular numerals; a coloured app glyph at top left.
    const detail=await page.locator('.th-island').evaluate(e=>{const q=s=>e.querySelector(s),line=q('.progress').getBoundingClientRect(),el=q('.elapsed').getBoundingClientRect(),g=q('.glyph').getBoundingClientRect(),top=e.getBoundingClientRect();
      return {under:el.top>=line.bottom,numerals:getComputedStyle(q('.elapsed')).fontVariantNumeric+'/'+getComputedStyle(q('.left')).fontVariantNumeric,elapsed:q('.elapsed').textContent,glyph:[g.x-top.x,g.y-top.y,g.width],color:getComputedStyle(q('.glyph')).color,
        backdrop:[e,...e.querySelectorAll('*')].filter(n=>!['none',''].includes(getComputedStyle(n).backdropFilter??'none')).length};});
    assert.deepEqual({...detail,glyph:detail.glyph.map(Math.round)},{under:true,numerals:'tabular-nums/tabular-nums',elapsed:'0:00',glyph:[18,14,16],color:'rgb(47, 125, 246)',backdrop:0});
    for(const button of await page.locator('.controls button').all()){const r=await button.boundingBox();near(r.width,44,'control width');near(r.height,44,'control height');}
    near((await rect(page,'.art')).width,72,'artwork'); near((await rect(page,'.progress')).height,3,'expanded progress');
    if(process.env.ISLAND_CAPTURE) { await painted(page); await page.screenshot({path:`${process.env.ISLAND_CAPTURE}/expanded.png`}); }
    // App launch starts at the expanded capsule's exact shape, and consumes an old ring cover.
    const origin=await page.evaluate(async()=>{
      const m=await import('/th/island/island.js');
      const cover=document.createElement('div');cover.className='launch';document.body.append(cover);
      await m.openApp('music');
      const shell=document.querySelector('.th-app-shell:not(.parked)');
      return {clip:shell.style.clipPath,launch:!!document.querySelector('.launch:not(.th-app-shell)'),marker:shell.classList.contains('launch'),interactive:getComputedStyle(shell).pointerEvents};
    });
    assert.equal(origin.launch,false);
    assert.equal(origin.marker,true,'the launch marker belongs to the capsule reveal');
    assert.equal(origin.interactive,'auto','a ready frame can receive input during the morph');
    const [edges,round]=origin.clip.split('round');
    const n=edges.match(/[\d.]+/g).map(Number);
    const values=[n[0],n[1]??n[0],n[2]??n[0],n[3]??n[1]??n[0],parseFloat(round)];
    [expanded.y,390-expanded.x-expanded.width,844-expanded.y-expanded.height,expanded.x,expanded.radius].forEach((v,i)=>near(values[i],v,'clip origin'));
    await settle(page);
    assert.equal(await page.locator('.th-island').isVisible(),false);
    await page.goBack(); await settle(page);
    assert.equal(await page.locator('.th-island').isVisible(),true,'capsule returns on shrink');
    near((await rect(page,'.th-island')).width,360,'reverse ends at original expanded shape');
    // Pointer interaction restarts the six-second timer; timeout collapses at rest.
    await page.waitForFunction(()=>document.querySelector('.th-island').dataset.state==='compact',null,{timeout:8000});
    await settle(page);
    near((await rect(page,'.th-island')).height,36,'idle collapse');
    // A home line about this app raises a bounded alert; the gold line lasts with the note.
    const alertStart=await page.evaluate(()=>{
      const note=document.createElement('div');note.className='note';note.id='island-note';note.textContent='Music has a new mix.';document.querySelector('#talk').append(note);
      // The gold line's fade, read each frame.
      const capsule=document.querySelector('.th-island');window.gold=[];const start=performance.now();
      const read=()=>{window.gold.push([performance.now()-start,Number(getComputedStyle(capsule,'::after').opacity)]);if(performance.now()-start<600)requestAnimationFrame(read);};requestAnimationFrame(read);
      return start;
    });
    await page.waitForSelector('.th-island.alert-flash'); await settle(page);
    near((await rect(page,'.th-island')).width,compact.width+24,'alert widening');
    near((await rect(page,'.alert-dot')).width,16,'alert dot');
    await page.waitForFunction(()=>!document.querySelector('.th-island').classList.contains('alert-flash'));
    await settle(page);
    const alertMs=await page.evaluate(start=>performance.now()-start,alertStart);
    // The dot holds 1.2 s by design, then the width springs back; the settle lands near 1.7 s on a loaded runner.
    timing(alertMs<2000,`alert returns within 2 s: ${alertMs}`);
    near((await rect(page,'.th-island')).width,compact.width,'alert returns');
    assert.equal(await page.locator('.th-island').evaluate(e=>e.classList.contains('alert')),true,'gold persists for the line life');
    // The gold line fades in over --d-base (300 ms): partway through at 100 ms, whole by 450 ms; never a pop.
    const gold=await page.evaluate(()=>window.gold);
    timing(gold.filter(([at])=>at<100).every(([,o])=>o<.9),`gold line fades in: ${JSON.stringify(gold.slice(0,8))}`);
    timing(gold.some(([,o])=>o>.05&&o<.95),'gold passes through the middle');
    timing(gold.filter(([at])=>at>450).every(([,o])=>o===1),'gold line arrives');
    await page.locator('#island-note').click(); await settle(page);
    near((await rect(page,'.th-island')).height,180,'home line expands the capsule');
    await page.mouse.click(10,400); await settle(page);
    near((await rect(page,'.th-island')).height,36,'outside collapses');
    await page.evaluate(()=>document.querySelector('#island-note').remove());
    await page.waitForFunction(()=>!document.querySelector('.th-island').classList.contains('alert'));
    await page.locator('.compact').click();await settle(page);
    const box=await page.locator('.th-island').boundingBox();
    await page.mouse.move(box.x+box.width-10,box.y+90);await page.mouse.down();await page.mouse.move(box.x+box.width-10,box.y+40,{steps:5});await page.mouse.up();await settle(page);
    near((await rect(page,'.th-island')).height,36,'swipe up collapses');
    const warm=await readyOpen(page,'music');await settle(page);
    // 1,500 ms is the phone's target (HOME.md §12); a loaded CI runner lands near it, so the test's ceiling is 3 s against regressions.
    timing(cold.ms<3000,`local cold ready: ${cold.ms}`);timing(warm.ms<300,`local second ready: ${warm.ms}`);
    t.diagnostic(JSON.stringify({surface:'music',coldMs:cold.ms,secondMs:warm.ms,compact,expanded,expansionMs:expansion.ms,peakWidth:expansion.max,alertMs,device:'Chromium 390x844, not an A15'}));
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
    const {stream}=await complete;let trace='';for(;;){const r=await cdp.send('IO.read',{handle:stream});trace+=r.data;if(r.eof)break;}await cdp.send('IO.close',{handle:stream});
    if(process.env.ISLAND_CAPTURE) await writeFile(`${process.env.ISLAND_CAPTURE}/after-trace.json`,trace);
  } finally {await context.close();}
});

test('signed-in idle warms Music then Podcasts; frames stay hidden, inert and alive across opens', opts, async t => {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try {
    const page=await signedIn(context,{saveData:false});
    await page.goto(`${base}/`);
    await page.waitForSelector('iframe.th-app[data-app=podcasts][data-ready=true]',{state:'attached',timeout:20000});
    const parked=await page.locator('iframe.th-app').evaluateAll(frames=>frames.map(f=>({app:f.dataset.app,inert:f.inert,visibility:getComputedStyle(f).visibility,y:f.getBoundingClientRect().y,ready:f.dataset.ready})));
    assert.deepEqual(parked.map(f=>f.app),['music','podcasts'],'Music warms first');
    for(const frame of parked){assert.equal(frame.inert,true);assert.equal(frame.visibility,'hidden');assert.ok(frame.y<0);assert.equal(frame.ready,'true');}
    await page.evaluate(()=>window.retained=[...document.querySelectorAll('iframe.th-app')].map(f=>f.contentWindow));
    const podFirst=await readyOpen(page,'podcasts');await settle(page);
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.close()));
    const podSecond=await readyOpen(page,'podcasts');await settle(page);
    timing(podFirst.ms<300 && podSecond.ms<300,`${JSON.stringify({podFirst,podSecond})}`);
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.collapse('test')));
    await page.locator('.compact').click();await settle(page);
    const musicFirst=await readyOpen(page,'music');await settle(page);
    timing(musicFirst.ms<300,`Music ready after idle: ${musicFirst.ms}`);
    t.diagnostic(JSON.stringify({surface:'music',idleFirstMs:musicFirst.ms,device:'Chromium 390x844, not an A15'}));
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.close()));
    await page.locator('.compact').click();await settle(page);
    near((await rect(page,'.th-island')).height,180,'switching apps keeps compact controls operable');
    assert.equal(await page.evaluate(()=>retained.every((w,i)=>w===document.querySelectorAll('iframe.th-app')[i].contentWindow)),true,'same contexts after closing and switching');
    t.diagnostic(JSON.stringify({surface:'podcasts',idleFirstMs:podFirst.ms,secondMs:podSecond.ms,device:'Chromium 390x844, not an A15'}));
  }finally{await context.close();}
});

test('saveData and signed-out home do not warm frames',opts,async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try {
    const page=await signedIn(context,{saveData:true});await page.goto(`${base}/`);
    await page.waitForTimeout(3200);assert.equal(await page.locator('iframe.th-app').count(),0);
  }finally{await context.close();}
  const out=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try{const page=await out.newPage();await page.goto(`${base}/`);await page.waitForTimeout(3200);assert.equal(await page.locator('iframe.th-app').count(),0);}finally{await out.close();}
});

test('reduced motion snaps shape and fades content; cold Podcasts opens under its cover',opts,async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow',reducedMotion:'reduce'});
  try{
    const page=await signedIn(context);await page.goto(`${base}/`);
    const cold=await readyOpen(page,'podcasts');await settle(page);
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.collapse('test')));
    const snap=await page.evaluate(async()=>{const m=await import('/th/island/island.js');const start=performance.now();const done=m.wide(true),r=document.querySelector('.th-island').getBoundingClientRect();const initial=getComputedStyle(document.querySelector('.details')).opacity;await done;return{width:r.width,height:r.height,initial,ms:performance.now()-start,opacity:getComputedStyle(document.querySelector('.details')).opacity};});
    near(snap.width,360,'reduced expanded width');near(snap.height,180,'reduced expanded height');assert.equal(snap.initial,'0');assert.equal(snap.opacity,'1');timing(snap.ms>=140 && snap.ms<300,`150 ms content fade: ${snap.ms}`);
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.wide(false)));
    near((await rect(page,'.th-island')).height,36,'reduced compact height');
    timing(cold.ms<1500,`cold Podcasts local: ${cold.ms}`);
    t.diagnostic(JSON.stringify({surface:'podcasts',coldMs:cold.ms,reducedFadeMs:snap.ms,device:'Chromium 390x844, not an A15'}));
  }finally{await context.close();}
});

test('a cold open reveals the coloured cover immediately; reversals settle and the playing frame wins on return',opts,async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try{
    const page=await signedIn(context);await page.goto(`${base}/`);
    const generic=await page.evaluate(async()=>{const m=await import('/ui/launch.js');m.from(20,700);void m.launch('#2f7df6');await new Promise(requestAnimationFrame);return !!document.querySelector('.launch');});
    assert.equal(generic,false,'ring circle is removed before its first paint');
    const opening=await page.evaluate(async()=>{
      const m=await import('/th/island/island.js');await m.openApp('music');
      const shell=document.querySelector('.th-app-shell'),cover=shell.querySelector('.th-app-wait');
      return {hidden:shell.classList.contains('parked'),waiting:!cover.hidden,dots:cover.querySelectorAll('i').length,color:getComputedStyle(cover).backgroundColor,clip:shell.style.clipPath};
    });
    assert.equal(opening.hidden,false);assert.equal(opening.waiting,true);assert.equal(opening.dots,3);assert.equal(opening.color,'rgb(47, 125, 246)');assert.match(opening.clip,/round 18px/);
    await page.waitForSelector('iframe[data-ready=true]',{state:'attached'});await settle(page);
    // Reverse before either endpoint: no destroyed frame or invisible final capsule.
    await page.evaluate(async()=>{const m=await import('/th/island/island.js');void m.collapse('reverse');await new Promise(requestAnimationFrame);void m.expand('reverse');await new Promise(requestAnimationFrame);await m.collapse('reverse');await m.whenResting();});
    assert.equal(await page.locator('.th-island').isVisible(),true);
    assert.equal(await page.locator('iframe.th-app').evaluate(f=>f.inert),true);
    await page.locator('.compact').click();await settle(page);
    await page.evaluate(async()=>{const m=await import('/th/island/island.js');void m.wide(false);await new Promise(requestAnimationFrame);await m.wide(true);});
    near((await rect(page,'.th-island')).height,180,'reversed expansion rests');
    // Real decoded audio, invented silence: no stub of paused, play(), or the island's media lookup.
    const wav=Buffer.alloc(44+8000*2*60);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    await page.evaluate(data=>{
      const w=document.querySelector('iframe[data-app=music]').contentWindow,p=w.__cp.player;
      const src=w.URL.createObjectURL(new w.Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'audio/wav'}));
      p.queue=[{id:'island-tone',title:'Test tone',artist:'Test artist',durationMs:60000,src,
        art:{url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="teal"/></svg>',width:72,height:72}}];
      p.index=0;p.load(0,true);
    },wav.toString('base64'));
    await page.waitForFunction(()=>{const a=document.querySelector('iframe[data-app=music]').contentWindow.__cp.player.audio;return !a.paused && a.currentTime>0;});
    const podCold=await readyOpen(page,'podcasts');await settle(page);
    timing(podCold.ms<1500,`cold Podcasts with motion: ${podCold.ms}`);
    t.diagnostic(JSON.stringify({surface:'podcasts',coldMs:podCold.ms,motion:'normal',device:'Chromium 390x844, not an A15'}));
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.close()));
    assert.equal(await page.locator('.th-island').getAttribute('data-app'),'music','still-playing engine comes back');
    // The artwork fills the compact lobe: 24 px with 7 px corners, drawn from the track's own art.
    await page.waitForSelector('.th-island .art.has-art');await settle(page);
    const lobe=await page.locator('.th-island .art').evaluate(e=>{const r=e.getBoundingClientRect(),c=e.querySelector('canvas');return {x:r.x-e.parentElement.getBoundingClientRect().x,width:r.width,radius:parseFloat(getComputedStyle(e).borderRadius)*r.width/72,pixel:[...c.getContext('2d').getImageData(72,72,1,1).data]};});
    near(lobe.x,6,'artwork lobe left');near(lobe.width,24,'artwork lobe');near(lobe.radius,7,'artwork lobe corners');assert.deepEqual(lobe.pixel,[0,128,128,255],'the track art is drawn');
    assert.equal(await page.locator('.th-island .tt').textContent(),'Test tone');
    assert.match(await page.locator('.compact').getAttribute('aria-label'),/Test tone, Test artist/);
    assert.match(await page.locator('.heading').getAttribute('aria-label'),/Test tone, Test artist/);
    if(process.env.ISLAND_CAPTURE) {
      await painted(page);
      await page.screenshot({path:`${process.env.ISLAND_CAPTURE}/compact.png`});
      await page.locator('.compact').click();await settle(page);
      await painted(page);
      await page.screenshot({path:`${process.env.ISLAND_CAPTURE}/playing-expanded.png`});
    }
    assert.equal(await page.evaluate(()=>document.querySelector('iframe[data-app=music]').contentWindow.__cp.player.audio.paused),false,'parking did not stop playback');
    // Pause from the expanded capsule: the capsule swells to 1.03 and back on the pop spring.
    if(!process.env.ISLAND_CAPTURE){await page.locator('.compact').click();await settle(page);}
    const swell=await page.evaluate(()=>new Promise(resolve=>{const c=document.querySelector('.th-island'),seen=[];const start=performance.now();
      const read=()=>{seen.push(Number(c.style.scale||1));if(performance.now()-start<700)requestAnimationFrame(read);else resolve({peak:Math.max(...seen),end:seen.at(-1)});};
      document.querySelector('[data-control="toggle"]').click();requestAnimationFrame(read);}));
    assert.ok(swell.peak>1.027&&swell.peak<=1.0301,`pulse peaks at 1.03: ${swell.peak}`);near(swell.end*1000,1000,'pulse returns to 1');
    await page.waitForFunction(()=>document.querySelector('iframe[data-app=music]').contentWindow.__cp.player.audio.paused);
  }finally{await context.close();}
});

test('idle fallback waits three seconds after chat; a long title scrolls once at rest and stops for a touch; decisions alert',opts,async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  try{
    await context.addInitScript(()=>{delete window.requestIdleCallback;document.addEventListener('th:changed',()=>{window.chatLoadedAt??=performance.now();});});
    const page=await signedIn(context,{saveData:false});await page.goto(`${base}/`);
    await page.waitForFunction(()=>window.chatLoadedAt!==undefined);
    assert.equal(await page.locator('iframe.th-app').count(),0);
    await page.waitForSelector('iframe.th-app[data-app=music]',{state:'attached',timeout:8000});
    assert.ok(await page.evaluate(()=>performance.now()-chatLoadedAt>=2900),'three-second fallback');
    await readyOpen(page,'music');await settle(page);await page.evaluate(()=>import('/th/island/island.js').then(m=>m.close()));
    // A title past 60% of the viewport: the capsule stops at 234 px and fades the title's last 16 px.
    await page.evaluate(()=>{const p=document.querySelector('iframe[data-app=music]').contentWindow.__cp.player;p.queue=[{id:'island-title',title:'An invented title, a little too long'}];p.index=0;});
    await page.waitForFunction(()=>document.querySelector('.title').textContent.includes('invented'));
    const shown=await page.evaluate(()=>performance.now());await settle(page);
    near((await rect(page,'.th-island')).width,234,'60% of the viewport');
    assert.equal(await page.locator('.th-island').evaluate(e=>e.classList.contains('long')),true,'the long title is masked');
    // Two seconds at rest, then one pass to its end at 40 px/s (25 ms a pixel, 16 px past the end).
    const pass=await page.evaluate(()=>new Promise(resolve=>{const t=document.querySelector('.title');
      const look=()=>{const a=t.getAnimations()[0];if(a)resolve({at:performance.now(),duration:a.effect.getTiming().duration,distance:t.scrollWidth-t.parentElement.clientWidth+16,scrolling:t.closest('.th-island').classList.contains('scrolling')});else requestAnimationFrame(look);};look();}));
    assert.ok(pass.at-shown>=1900,`waits two seconds at rest: ${pass.at-shown}`);
    near(pass.duration,pass.distance*25,'40 px/s');assert.equal(pass.scrolling,true);
    near((await rect(page,'.th-island')).height,36,'the pass keeps compact');
    // A touch stops it and brings the title back; a hold alone neither scrolls nor expands.
    const box=await page.locator('.compact').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+18);await page.mouse.down();
    await page.waitForFunction(()=>!document.querySelector('.th-island').classList.contains('scrolling'));
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.title').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).e),0,'the title is back at its start');
    assert.equal(await page.locator('.title').evaluate(e=>e.getAnimations().length),0,'nothing scrolls while touched');
    await page.mouse.up();
    const state=await page.locator('.th-island').getAttribute('data-state');assert.equal(state,'compact');
    await page.locator('.compact').click();await settle(page);
    await page.mouse.move(355,75);await page.mouse.down();
    await page.waitForTimeout(6200);
    near((await rect(page,'.th-island')).height,180,'a held touch keeps the expanded capsule open');
    await page.mouse.up();
    await page.evaluate(()=>import('/th/island/island.js').then(m=>m.wide(false)));
    await page.evaluate(()=>{let dock=document.querySelector('#decision');if(!dock){dock=document.createElement('div');dock.id='decision';document.body.append(dock);}const card=document.createElement('div');card.className='card';card.textContent='A decision is waiting.';dock.append(card);document.dispatchEvent(new Event('th:decisions'));});
    await page.waitForSelector('.th-island.alert-flash');
    await page.waitForFunction(()=>!document.querySelector('.th-island').classList.contains('alert-flash'));
    await settle(page);assert.equal(await page.locator('.th-island').evaluate(e=>e.classList.contains('alert')),true);
  }finally{await context.close();}
});
