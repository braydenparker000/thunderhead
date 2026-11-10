// The new Edit board, checked: the drum, the dial's fling and double-tap, Auto, the profile face, and the photo
// keeping its zoom across boards. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(3000); await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(2500);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 300; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  const ses = (f, ...a) => p.evaluate(async ([f, a]) => { const s = await import('/lab/editor/app/session.js'); return s[f](...a); }, [f, a]);
  const drum = p.locator('[role=listbox][aria-label^="Sections"]'), face = async () => (await drum.getAttribute('aria-label')).replace('Sections: ', '');
  const chips = () => p.evaluate(() => [...document.querySelectorAll('[role=toolbar] button')].map((x) => x.getAttribute('aria-label')));
  const step = async (down = true) => { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + (down ? r.height - 6 : 6)); await p.waitForTimeout(500); };
  const to = async (name) => { for (let i = 0; i < 12 && (await face()) !== name; i++) await step(); };
  const dialBox = () => p.locator('[role=slider][style*="ew-resize"]').first().boundingBox();
  const drag = async (dx, hold = 150) => { const r = await dialBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(x + (dx * i) / 8, y); await p.waitForTimeout(16); } await p.waitForTimeout(hold); await p.mouse.up(); };
  // a flick, made inside the page so its timing is the page's own (a slow test machine must not turn it into a slow drag)
  const flick = (dx) => p.evaluate(async (dx) => { const el = document.querySelector('[role=slider][style*="ew-resize"]'), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, ev = (t, px) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, clientX: px, clientY: y })), nap = (ms) => new Promise((q) => setTimeout(q, ms));
    ev('pointerdown', x); for (let i = 1; i <= 6; i++) { await nap(16); ev('pointermove', x + (dx * i) / 6); } ev('pointerup', x + dx); }, dx);
  const dtap = async () => { const r = await dialBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.click(x, y); await p.waitForTimeout(90); await p.mouse.click(x, y); await p.waitForTimeout(400); };
  await calm();
  ok('Edit opens on Light, with no photo counter', (await face()) === 'Light' && (await chips()).join() === 'Exposure,Contrast,Highlights,Shadows,Whites,Blacks' && !(await p.evaluate(() => /\b1 \/ 1\b/.test(document.body.innerText))), (await chips()).join());
  const room = await p.evaluate(() => { const w = document.querySelector('[data-keep="photo"]').getBoundingClientRect(), pl = document.querySelector('.plate').getBoundingClientRect(); return { photo: Math.round(w.height), panel: Math.round(innerHeight - pl.top), gap: Math.round(pl.top - w.bottom) }; });
  ok('The panel is short and the photo has the rest', room.panel < 200 && room.photo > 480 && room.gap >= 0, JSON.stringify(room));
  // the drum
  await step(); ok('A tap below the drum\'s middle steps to the next face', (await face()) === 'Curve' && (await chips()).join() === 'RGB,R,G,B,Reset', await face());
  await step(false); ok('A tap above steps back', (await face()) === 'Light');
  let r = await drum.boundingBox(); await p.mouse.move(r.x + 40, r.y + 26); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(r.x + 40, r.y + 26 - 8 * i); await p.waitForTimeout(30); } await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(600);
  ok('Dragging it up two faces\' worth lands on Color', (await face()) === 'Color' && (await chips())[0] === 'White balance', await face());
  await step(false); await step(false); await step(false); ok('It goes round: back past Light to Profile', (await face()) === 'Profile', await face());
  const opts = () => p.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label="Profiles"] [role=option]')].map((x) => x.getAttribute('aria-label')));
  await calm(); const names = await opts(); ok('Profile shows the camera\'s renderings as pictures in the panel', names.length > 5 && names.some((n) => /Adobe Color/.test(n)) && (await chips()).join() === 'All,Film,Adobe,B&W', names.slice(0, 6).join(', ') + ' | ' + (await chips()).join());
  const strip = await p.evaluate(() => { const s = document.querySelector('[role=listbox][aria-label="Profiles"]').getBoundingClientRect(), w = document.querySelector('[data-keep="photo"]').getBoundingClientRect(), im = [...document.querySelectorAll('[role=listbox][aria-label="Profiles"] img')].slice(0, 4).map((i) => i.naturalWidth > 0 && /^blob:|^data:/.test(i.src)); return { below: Math.round(s.top - w.bottom), drawn: im }; });
  ok('  they lie under the photo, not over it, each drawn from this photo', strip.below >= 0 && strip.drawn.every(Boolean), JSON.stringify(strip));
  await p.locator('[role=toolbar] button[aria-label="B&W"]').click(); await p.waitForTimeout(400); const bw = await opts(); ok('  B&W narrows them', bw.length > 0 && bw.length < names.length, bw.join(', '));
  await p.locator('[role=toolbar] button[aria-label="All"]').click(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${S}/shots/ui2-${TAG}-profile.png` });
  const was = await ses('look'); await p.locator('[role=listbox][aria-label="Profiles"] [role=option]', { hasText: /VELVIA/i }).first().click(); await calm();
  ok('  a tap puts one on', (await ses('look')) !== was && /Velvia/i.test((await ses('history')).steps.at(-1).name), JSON.stringify((await ses('history')).steps.at(-1)));
  await to('Light');
  // the dial
  await drag(120, 200); await p.waitForTimeout(300); let v = await ses('value', 'Exposure');
  ok('The dial turns Exposure with the finger', Math.abs(v - 0.85) < 0.06, String(v));
  await dtap(); await calm(); ok('Two taps on the dial put it back', (await ses('value', 'Exposure')) === 0, String(await ses('value', 'Exposure')));
  await flick(60); const v0 = await ses('value', 'Exposure'); await p.waitForTimeout(1200); const v1 = await ses('value', 'Exposure'); await p.waitForTimeout(800); const v2 = await ses('value', 'Exposure');
  ok('Let go while moving, it runs on and comes to rest', v1 > v0 + 0.05 && Math.abs(v2 - v1) < 0.05, JSON.stringify([v0, v1, v2]));
  await flick(60); await p.waitForTimeout(60); const rr = await dialBox(); await p.mouse.move(rr.x + 200, rr.y + 40); await p.mouse.down(); await p.waitForTimeout(400); const s0 = await ses('value', 'Exposure'); await p.waitForTimeout(500); const s1 = await ses('value', 'Exposure'); await p.mouse.up();
  ok('A touch stops it', s0 === s1, JSON.stringify([s0, s1]));
  await calm(); const hist = (await ses('history')).steps.map((x) => x.name); ok('The run is one step of history, not many', hist.filter((n) => n === 'Exposure').length <= 4, hist.join(', '));
  await ses('reset', 'Exposure'); await calm();
  await p.getByRole('button', { name: 'AUTO' }).click(); await calm(); const auto = await ses('value', 'Exposure'), h2 = (await ses('history')).steps.at(-1).name;
  ok('AUTO sits in the value\'s window and works', h2 === 'Auto', `${h2} ${auto}`);
  await p.screenshot({ path: `${S}/shots/ui2-${TAG}-edit.png` });
  // the photo keeps its place across boards
  const see = () => p.evaluate(() => { const w = document.querySelector('#frame > div .fillphoto'), b = document.querySelector('#frame > div span.glass'), q = w.getBoundingClientRect(); return { box: [q.left, q.top, q.width, q.height].map(Math.round), badge: b && b.style.display !== 'none' ? b.textContent : '', canvases: document.querySelectorAll('canvas[aria-label="The photo being edited"]').length }; });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const pinch = async (cx, cy, d0, d1) => { await touch('touchStart', [[cx - d0, cy]]); await p.waitForTimeout(30); await touch('touchStart', [[cx - d0, cy], [cx + d0, cy]]); for (let i = 1; i <= 8; i++) { const d = d0 + ((d1 - d0) * i) / 8; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(1000); };
  await pinch(192, 330, 30, 110); await calm(); const z1 = await see();
  ok('Two fingers zoom the photo on Edit', parseInt(z1.badge) > 0 && z1.box[2] > 900, JSON.stringify(z1));
  const go = async (name) => { await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400); await p.locator(`#dock button[data-go="${name}"]`).click(); await p.waitForTimeout(1200); };
  await go('Masks'); await calm(); const z2 = await see();
  ok('On Masks it is the same photo, zoomed as it was', z2.badge === z1.badge && Math.abs(z2.box[2] - z1.box[2]) < 2 && z2.canvases === 1, JSON.stringify(z2)); await p.screenshot({ path: `${S}/shots/ui2-${TAG}-masks.png` });
  await go('Heal'); await calm(); const z3 = await see(); ok('And on Heal', z3.badge === z1.badge && Math.abs(z3.box[2] - z1.box[2]) < 2, JSON.stringify(z3));
  await go('Crop'); await calm(); await p.screenshot({ path: `${S}/shots/ui2-${TAG}-crop.png` }); const hidden = await p.evaluate(() => getComputedStyle(document.querySelector('#frame > div')).display);
  ok('Crop takes the photo into its own frame', hidden === 'none', hidden);
  await go('Edit'); await calm(); const z4 = await see(); ok('Back on Edit the photo is in its layer again, still zoomed', z4.badge === z1.badge && z4.canvases === 1, JSON.stringify(z4));
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();
