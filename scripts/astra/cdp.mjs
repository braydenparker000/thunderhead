// A bare DevTools-protocol client for measuring memory (memory.mjs): Chromium started by hand, driven over its
// own WebSocket. Not Playwright: Playwright turns on the Network domain for every page, and with it on the page keeps
// a copy of every response body for DevTools (up to 200 MB, Chromium's default), so a film read at 25 Mbit/s showed
// about 190 MB more in the renderer than it holds (measured 2026-11-19: partition_alloc's buffer partition at 218 MB
// after 90 s with Playwright, 8 MB without).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Starts a headless Chromium; resolves {send, on, page(url), close, pid}. */
export async function launch({ executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cdp-'));
  const proc = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', ...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const address = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) resolve(m[1]); });
    proc.on('exit', (code) => reject(Error(`chromium exited (${code}): ${err.slice(-400)}`)));
  });
  const sock = new WebSocket(address);
  await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = reject; });
  let id = 0;
  const calls = new Map(), handlers = new Set();
  sock.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const call = msg.id != null && calls.get(msg.id);
    if (call) { calls.delete(msg.id); if (msg.error) call.reject(Error(`${call.method}: ${msg.error.message}`)); else call.resolve(msg.result); }
    else for (const h of handlers) h(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    calls.set(i, { resolve, reject, method });
    sock.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const on = (fn) => { handlers.add(fn); return () => handlers.delete(fn); };

  /** A new tab at `url` (load event awaited); `init` runs in it before any of the page's own scripts. */
  async function page(url, init = '') {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    if (init) await s('Page.addScriptToEvaluateOnNewDocument', { source: init });
    const loaded = new Promise((resolve) => { const off = on((m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { off(); resolve(); } }); });
    await s('Page.navigate', { url });
    await loaded;
    /** Runs `fn(arg)` (or a string of script) in the page; its value, awaited, as JSON. */
    const evaluate = async (fn, arg) => {
      const expression = typeof fn === 'string' ? fn : `(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`;
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error('in the page: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
      return r.result.value;
    };
    return { send: s, evaluate };
  }

  /** The renderer's memory by allocator (a memory-infra dump, no garbage collection forced): {name: bytes}. */
  async function dump(pid) {
    const events = [];
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const off = on((m) => { if (m.method === 'Tracing.dataCollected') events.push(...m.params.value); else if (m.method === 'Tracing.tracingComplete') finish(); });
    await send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
    await send('Tracing.requestMemoryDump', { deterministic: false, levelOfDetail: 'detailed' });
    await send('Tracing.end');
    await done;
    off();
    const out = {};
    for (const e of events) {
      if (e.ph !== 'v' || e.pid !== pid) continue;
      for (const [name, v] of Object.entries(e.args?.dumps?.allocators || {})) if (v.attrs?.size) out[name] = parseInt(v.attrs.size.value, 16);
    }
    return out;
  }

  const close = async () => {
    // The browser may go before it answers: wait a second at most, then end it.
    await Promise.race([send('Browser.close').catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
    sock.close();
    proc.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(dir, { recursive: true, force: true });
  };
  return { send, on, page, dump, close, pid: proc.pid };
}
