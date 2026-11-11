// Back to home, measured: open home, go to an app's page, go back, and say whether home came back
// whole from the browser's back/forward cache (instant, as it was left) or was loaded again, and
// if it was loaded again, why the browser would not keep it (HOME.md §12). The browser is driven
// directly: the usual test driver switches the back/forward cache off.
//
//   npm run serve                      (in another shell)
//   node scripts/open/back.cjs [base] [app path, default /guitar/]
//   CHROME=/path/to/chrome   the browser to drive (else CHROMIUM_PATH, else the test driver's own)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const base = process.argv[2] || 'http://localhost:8080';
const app = process.argv[3] || '/guitar/';
const BIN = [process.env.CHROME, process.env.CHROMIUM_PATH, (() => { try { return require('playwright').chromium.executablePath(); } catch { return null; } })()]
  .find(p => p && fs.existsSync(p) && fs.statSync(p).isFile());
if (!BIN) { console.error('no browser found: set CHROME (or CHROMIUM_PATH) to a Chromium binary'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'back-'));
  const proc = spawn(BIN, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=412,915', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const url = await new Promise((res, rej) => { let buf = ''; proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); setTimeout(() => rej(new Error('no devtools')), 15000); });
    const ws = new WebSocket(url);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const waits = new Map(), notes = [];
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [res, rej] = waits.get(m.id); waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method === 'Page.backForwardCacheNotUsed') notes.push(m.params); });
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => { waits.set(++id, [res, rej]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    const ev = async (expression) => (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
    await s('Page.enable');
    await s('Page.navigate', { url: base + '/' });
    await sleep(3500);
    await ev("window.__mark = 'kept'; addEventListener('pageshow', e => { window.__shown = e.persisted; })");
    const t0 = Date.now();
    await s('Page.navigate', { url: base + app });
    await sleep(2500);
    const history = await s('Page.getNavigationHistory');
    await s('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id });
    await sleep(2500);
    const back = await ev("({ kept: window.__mark === 'kept', persisted: window.__shown ?? null, type: performance.getEntriesByType('navigation')[0].type, path: location.pathname })");
    const reasons = (notes[0]?.notRestoredExplanations ?? []).map(r => `${r.type}: ${r.reason}${r.context ? ` (${r.context})` : ''}`);
    console.log(JSON.stringify({ app, back, from_cache: back.kept, reasons, ms: Date.now() - t0 }, null, 1));
  } finally { proc.kill('SIGKILL'); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
})();
