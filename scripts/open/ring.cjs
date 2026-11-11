// Ring to app, measured: from the finger lifting off an app in the ring to that app's page shown,
// painted and loaded (HOME.md §12, apps/home/prewarm.js). The browser is driven directly over its
// debugging socket, attached through the tab: the usual test driver switches prerendering off in
// every page it controls, and a client attached straight to the page makes the browser refuse it.
//
//   npm run serve                      (in another shell)
//   node scripts/open/ring.cjs [base] [runs] [cpu slowdown]
//   PREWARM=off node scripts/open/ring.cjs       the same with "Open apps ahead" off (the before)
//   ONLY=1,6   ring places to open (clockwise from the top; Music and Podcasts open inside home)
//   REST=250   how long the finger rests on the app before lifting, in ms
//   CHROME=/path/to/chrome   the browser to drive (else CHROMIUM_PATH, else the test driver's own)
// Each line: the place, the app, when its page was shown, first painted, parsed and loaded (ms after
// the lift, the median of the runs), and whether each run was a prerendered page (1) or not (0).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const base = process.argv[2] || 'http://localhost:8080';
const runs = Number(process.argv[3] || 3);
const throttle = Number(process.argv[4] || 4);
const REST = Number(process.env.REST || 250);
const N = 7, R = 70, X = 206, Y = 520;
const BIN = [process.env.CHROME, process.env.CHROMIUM_PATH, (() => { try { return require('playwright').chromium.executablePath(); } catch { return null; } })()]
  .find(p => p && fs.existsSync(p) && fs.statSync(p).isFile());
if (!BIN) { console.error('no browser found: set CHROME (or CHROMIUM_PATH) to a Chromium binary'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function chrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-'));
  const proc = spawn(BIN, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=412,915', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((res, rej) => { let buf = ''; proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); setTimeout(() => rej(new Error('no devtools: ' + buf.slice(0, 300))), 15000); });
  const ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waits = new Map(), subs = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [res, rej] = waits.get(m.id); waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else for (const s of subs) s(m); });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { waits.set(++id, [res, rej]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  return { send, on: f => subs.push(f), close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

async function one(i) {
  const c = await chrome();
  try {
    // Attach through the tab, as a client that understands a prerendered page taking the tab over
    // (a client attached straight to the page makes the browser refuse to prerender).
    const tabs = (await c.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    const tab = (await c.send('Target.attachToTarget', { targetId: tabs[0].targetId, flatten: true })).sessionId;
    const pages = [];
    c.on(m => { if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'page') pages.push(m.params.sessionId); });
    await c.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, tab);
    for (let k = 0; k < 50 && !pages.length; k++) await sleep(50);
    const sessionId = pages[0];
    const s = (m, p) => c.send(m, p, sessionId);
    const pre = []; c.on(m => { if (m.method === 'Preload.prerenderStatusUpdated') pre.push(m.params.status + (m.params.prerenderStatus ? ':' + m.params.prerenderStatus : '')); });
    await s('Page.enable'); await s('Runtime.enable'); await s('Preload.enable');
    if (!process.env.NOEMU) await s('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
    const ev = async (expr) => { const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };
    await s('Page.navigate', { url: base + '/' });
    await sleep(3500);
    if (throttle > 1) await s('Emulation.setCPUThrottlingRate', { rate: throttle });
    const fire = (type, x, y) => ev(`(${type === 'pointerdown' ? "document.querySelector('#convo')" : 'window'}).dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,isPrimary:true,pointerId:7,clientX:${x},clientY:${y}}))`);
    if (process.env.PREWARM === 'off') await ev("localStorage.setItem('th.s.gestures.prewarm','false')");
    await fire('pointerdown', X, Y);
    await sleep(650);
    const a = (Math.PI * 2 / N) * i, x = X + Math.sin(a) * R, y = Y - Math.cos(a) * R;
    await fire('pointermove', X + Math.sin(a) * R / 2, Y - Math.cos(a) * R / 2);
    await fire('pointermove', x, y);
    await sleep(REST);
    const name = await ev("document.querySelector('#lbl').textContent");
    const t0 = await ev(`(()=>{const t=Date.now();window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,pointerId:7,clientX:${x},clientY:${y}}));return t})()`);
    await sleep(3000);
    // After a prerender is shown, the tab's page is the prerendered one: ask every page session.
    let r = null;
    for (const sid of [...pages].reverse()) {
      try {
        const got = await c.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const f=performance.getEntriesByName('first-contentful-paint')[0],n=performance.getEntriesByType('navigation')[0];return {url:location.pathname,pre:document.prerendering,origin:performance.timeOrigin,fcp:f?f.startTime:null,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,act:n.activationStart||0}})()` }, sid);
        if (got.result?.value && got.result.value.url !== '/' && !got.result.value.pre) { r = got; break; }
      } catch {}
    }
    if (!r) throw new Error('the app page was not found');
    const m = r.result.value;
    const at = v => Math.round(m.origin + Math.max(v ?? 0, m.act) - t0);
    return { name, to: m.url, shown: Math.round(m.origin + m.act - t0), fcp: at(m.fcp), dcl: at(m.dcl), load: at(m.load), prerendered: m.act > 0, pre: pre.join(',') };
  } finally { c.close(); }
}

(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : [...Array(N).keys()];
  for (const i of only) {
    const rs = [];
    for (let r = 0; r < runs; r++) { try { rs.push(await one(i)); } catch (e) { rs.push({ err: String(e).slice(0, 120) }); } }
    const med = k => { const v = rs.map(r => r[k]).filter(v => typeof v === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const first = rs.find(r => r.name) || rs[0];
    console.log(JSON.stringify({ i, name: first.name, to: first.to, shown: med('shown'), fcp: med('fcp'), dcl: med('dcl'), load: med('load'), prerendered: rs.map(r => r.prerendered ? 1 : 0).join(''), pre: first.pre, err: rs.find(r => r.err)?.err }));
  }
})();
