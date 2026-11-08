// Measures the LightCraft test page's memory (engine/lightcraft-web/README.md, "Measured"): a phone-sized
// page imports a RAF with Import Photos…, opens it in Detail, drags Exposure, zooms to 1:1 and exports a
// 4,000 px and a full-size JPEG. Each step prints LightCraft's own wasm memory (the page's instance, read
// from its WebAssembly.Memory) and the renderer processes' RSS (the page and its workers, Linux only).
//   node scripts/lightcraft-memory.mjs <file.RAF> [workers]
// CHROMIUM_PATH names the browser (as in the tests). wasm memory never shrinks, so each row is the
// highest so far.
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const [file, workers = '4'] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/lightcraft-memory.mjs <file.RAF> [workers]'); process.exit(2); }
const rss = () => {
  let kb = 0;
  for (const l of execSync('ps -eo rss=,args=', { maxBuffer: 1 << 26 }).toString().split('\n')) if (/--type=renderer/.test(l)) kb += parseInt(l, 10) || 0;
  return Math.round(kb / 1024);
};
let peak = 0;
const sampler = setInterval(() => { try { peak = Math.max(peak, rss()); } catch { /* ps can race a closing process */ } }, 100);

const server = await serve(0);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('console', (m) => { if (/panicked|out of memory/i.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
await page.addInitScript(() => {
  globalThis.__mems = [];
  const keep = (r) => { const m = (r.instance ?? r)?.exports?.memory; if (m) globalThis.__mems.push(m); return r; };
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = (...a) => instantiate.apply(WebAssembly, a).then(keep);
});
await page.goto(`http://127.0.0.1:${server.address().port}/lab/lightcraft/?workers=${workers}`);
await page.waitForFunction(() => globalThis.lightcraft, null, { timeout: 120_000 });
const cmd = (id, params = {}) => page.evaluate(async ([i, p]) => JSON.parse(await globalThis.lightcraft.command(i, JSON.stringify(p)) || 'null'), [id, params]);
const settle = async () => {
  for (let i = 0, quiet = 0; i < 3000 && quiet < 5; i++) {
    const s = await cmd('web.stats');
    quiet = s.renderQueue || s.rendersInFlight ? 0 : quiet + 1;
    await page.waitForTimeout(100);
  }
};
const rows = [];
const step = async (name, run) => {
  peak = rss();
  const t0 = Date.now();
  let note = '';
  try { note = (await run()) ?? ''; } catch (e) { note = `failed: ${String(e.message).split('\n')[0]}`; }
  await settle();
  const wasm = await page.evaluate(() => globalThis.__mems.map((m) => Math.round(m.buffer.byteLength / 1048576))[0] ?? 0);
  rows.push({ step: name, 'wasm MiB': wasm, 'peak RSS MiB': peak, seconds: ((Date.now() - t0) / 1000).toFixed(1), note });
  console.log(JSON.stringify(rows.at(-1)));
};

await step('open', () => settle());
let id;
await step('import', async () => {
  const before = (await cmd('library.state')).visibleCount;
  const chooser = page.waitForEvent('filechooser');
  await cmd('file.addPhotos');
  await (await chooser).setFiles(file);
  for (let i = 0; i < 1200; i++) { const s = await cmd('library.state'); if (s.visibleCount > before) { id = s.selection.active; return; } await page.waitForTimeout(100); }
  throw new Error('not imported');
});
await step('detail', async () => { await cmd('library.select', { ids: [id] }); await cmd('view.detail'); });
await step('exposure drag', async () => {
  await cmd('develop.beginInteraction', { label: 'Exposure' });
  for (let i = 1; i <= 6; i++) { await cmd('develop.set', { control: 'light.exposure', value: i * 0.2 }); await settle(); }
  await cmd('develop.endInteraction');
});
await step('zoom 1:1', () => cmd('view.zoomToggle'));
await step('zoom fit', () => cmd('view.zoomToggle'));
const exported = async (width) => {
  const download = page.waitForEvent('download', { timeout: 600_000 });
  const r = await cmd('app.export', { format: 'jpeg', quality: 90, dir: 'Exports', ...(width ? { width } : {}) });
  await download;
  return `${r.files[0].width}×${r.files[0].height}`;
};
await step('export 4,000 px', () => exported(4000));
await step('export full size', () => exported(0));
clearInterval(sampler);
console.table(rows);
await browser.close();
server.close();
