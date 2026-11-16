// Every kind of file an export writes, made from a crop of the real RAF, kept for checking with other tools.
import { withRaf, out } from './rafkit.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(`${out}files`, { recursive: true });
await withRaf(async ({ page }) => {
  const idle = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); for (let i = 0; i < 6000 && p.busy(); i++) await new Promise((r) => setTimeout(r, 25)); });
  await page.evaluate(async () => { localStorage.setItem('th.s.photos.neural', 'false'); const p = await import('/lab/editor/app/session.js'); p.setGeo({ quarter: 0, flipH: false, flipV: false, angle: 0, vertical: 0, horizontal: 0, scale: 0, rect: { x: 0.62, y: 0.30, w: 0.2, h: 0.24 }, aspect: 'Free', portrait: false }, 'audit'); });
  await idle(); await page.waitForTimeout(500); await idle();
  const run = async (name, presets) => {
    const got = await page.evaluate(async (presets) => {
      const save = await import('/lab/editor/app/save.js'), t = performance.now();
      const files = await save.save(presets, () => {});
      const out = [];
      for (const f of files) { const b = new Uint8Array(await f.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); out.push({ file: f.file, width: f.width, height: f.height, bytes: f.bytes, b64: btoa(s) }); }
      return { ms: Math.round(performance.now() - t), out };
    }, presets);
    for (const f of got.out) { writeFileSync(`${out}files/${name}-${f.file}`, Buffer.from(f.b64, 'base64')); console.log(name, f.file, f.width, 'x', f.height, f.bytes, 'bytes'); }
    console.log(name, 'took', got.ms, 'ms');
  };
  const P = (fmt, file, more = {}) => ({ fmt, long: 99999, q: 95, meta: 'All', gps: false, file, sharpen: 'Off', amt: 'Standard', space: 'sRGB', ...more });
  await run('srgb', [P('JPEG', 'a.jpg'), P('PNG', 'a.png')]);
  await run('srgb2', [P('TIFF', 'a.tif'), P('JPEG', 'small.jpg', { long: 800, q: 85, sharpen: 'Screen' })]);
  await run('p3', [P('JPEG', 'a.jpg', { space: 'Display P3' }), P('PNG', 'a.png', { space: 'Display P3' })]);
  await run('p3b', [P('TIFF', 'a.tif', { space: 'Display P3' }), P('JPEG', 'q100.jpg', { q: 100, meta: 'None' })]);
  await run('low', [P('JPEG', 'q60.jpg', { q: 60, meta: 'Copyright only' })]);
});
