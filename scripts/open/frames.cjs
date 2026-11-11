// Ring to app, frame by frame: what the screen shows from the finger lifting until the app is
// there (HOME.md §12). Every frame the browser presents is kept with its time and reduced to its
// mean colour and how much of it is near white, near black or the app's own colour, so a blank or
// wrongly coloured frame between the launch circle and the app shows up as a line, not a feeling.
//
//   npm run serve                      (in another shell)
//   node scripts/open/frames.cjs [base] [ring place, default 1] [cpu slowdown, default 4]
//   PREWARM=off   the same with "Open apps ahead" off
// Each line: ms after the lift, the mean colour, and the share near white / near black / the cover's colour.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const base = process.argv[2] || 'http://localhost:8080';
const place = Number(process.argv[3] || 1);
const throttle = Number(process.argv[4] || 4);
const frames = [];
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
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.sessionId && m.method) m.params = m.params || {}; if (m.id && waits.has(m.id)) { const [res, rej] = waits.get(m.id); waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else for (const s of subs) s(m); });
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
    const cast = sid => { c.send('Page.enable', {}, sid).catch(() => {}); c.send('Page.startScreencast', { format: 'jpeg', quality: 50, maxWidth: 206, maxHeight: 458, everyNthFrame: 1 }, sid).catch(() => {}); };
    c.on(m => {
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'page') { pages.push(m.params.sessionId); cast(m.params.sessionId); }
      if (m.method === 'Page.screencastFrame') { frames.push({ at: m.params.metadata.timestamp * 1000, data: m.params.data }); c.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId).catch(() => {}); }
    });
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
    // A page loaded ahead only draws once it is shown: ask each page for its frames again as that happens.
    for (const at of [250, 310, 350, 380, 420, 480]) setTimeout(() => pages.forEach(cast), at);
    await sleep(3000);
    // After a prerender is shown, the tab's page is the prerendered one: ask every page session.
    let r = null;
    for (const sid of [...pages].reverse()) {
      try {
        const got = await c.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const f=performance.getEntriesByName('first-contentful-paint')[0],n=performance.getEntriesByType('navigation')[0];return {url:location.pathname,pre:document.prerendering,origin:performance.timeOrigin,fcp:f?f.startTime:null,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,act:n.activationStart||0}})()` }, sid);
        if (got.result?.value && got.result.value.url !== '/' && !got.result.value.pre) { r = got; r.sid = sid; break; }
      } catch {}
    }
    if (!r) throw new Error('the app page was not found');
    const m = r.result.value;
    const kept = frames.filter(f => f.at >= t0 - 50 && f.at <= t0 + 1400);
    const analysed = [];
    for (const f of kept) {
      const got = await c.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{const bin=atob('${f.data}');const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const im=await createImageBitmap(new Blob([u],{type:'image/jpeg'}));const cv=new OffscreenCanvas(24,54);const g=cv.getContext('2d');g.drawImage(im,0,0,24,54);const d=g.getImageData(0,0,24,54).data;let r=0,gg=0,bl=0,w=0,k=0;const n=d.length/4;for(let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];bl+=d[i+2];if(d[i]>235&&d[i+1]>235&&d[i+2]>235)w++;if(d[i]<20&&d[i+1]<20&&d[i+2]<20)k++;}return [Math.round(r/n),Math.round(gg/n),Math.round(bl/n),Math.round(100*w/n),Math.round(100*k/n)]})()` }, r.sid).catch(e => ({ err: String(e) }));
      analysed.push({ ms: Math.round(f.at - t0), v: Array.isArray(got.result?.value) ? got.result.value : null });
    }
    for (const a of analysed) console.log(String(a.ms).padStart(5), 'ms  rgb', JSON.stringify(a.v?.slice(0, 3)), ' white', (a.v?.[3] ?? '?') + '%', ' black', (a.v?.[4] ?? '?') + '%');
    const at = v => Math.round(m.origin + Math.max(v ?? 0, m.act) - t0);
    return { name, to: m.url, shown: Math.round(m.origin + m.act - t0), fcp: at(m.fcp), dcl: at(m.dcl), load: at(m.load), prerendered: m.act > 0, pre: pre.join(',') };
  } finally { c.close(); }
}

(async () => {
  const r = await one(place).catch(e => ({ err: String(e) }));
  console.log(JSON.stringify(r));
})();
