// Export check: node ex.cjs <raf>   CASES='JPEG:7728:95,PNG:7728,TIFF:2048' TAG=a META=All
// Develops the whole photo for each case on the engine page and saves the files to out/, with one 8-bit view
// crop across the first band seam (rows 192..320) to compare against.
const { chromium } = require('playwright'); const path = require('path');
const S = __dirname, file = process.argv[2], E = process.env, tag = E.TAG || 'a';
const cases = (E.CASES || 'JPEG:7728:95').split(',').map((c) => { const [fmt, long, q] = c.split(':'); return { fmt, long: +long, q: +(q || 90) }; });
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block', acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error|warn/i.test(m.type())) console.log('LOG', m.text().slice(0, 400)); });
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/${d.suggestedFilename()}`).then(() => d.suggestedFilename())));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ cases, tag, meta, more }) => {
    const file = document.querySelector('#mine').files[0], buf = await file.arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let pre = null, mosaic = null, first = null;
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.preview) pre = m.data; else if (m.data.mosaic) { mosaic = m.data.mosaic; res(first); } else if (m.data.error) res(m.data); else if (m.data.proxy) first = m.data; }; w.postMessage({ buf, full: true, tag: 1 }, [buf]); });
    if (r.error) return { error: r.error };
    let n = 0;
    const band = (rgb, bw, bh, q, fine) => new Promise((res, rej) => { const t = 'j' + ++n, hear = (m) => { if (m.data.tag !== t) return; w.removeEventListener('message', hear); m.data.jpeg ? res(m.data.jpeg) : rej(new Error(m.data.error)); }; w.addEventListener('message', hear); w.postMessage({ jpeg: [rgb, bw, bh, q, fine], tag: t }, [rgb.buffer]); });
    const { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), { develop } = await import('/lab/engine/export.js'), files = await import('/lab/engine/files.js'), { carry, block, taken } = await import('/lab/engine/exif.js');
    const errs = [], c = document.createElement('canvas'), eng = await engine(c, r, true);
    eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 400)));
    await eng.render(0.25, 1, more);
    const f = await full(eng, r, mosaic); if (!f) return { error: 'no full' };
    const head = new Uint8Array(await pre.preview.slice(0, 1 << 17).arrayBuffer());
    const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); };
    const log = { size: [f.width, f.height], rot: r.meta.orientation, taken: taken(head), done: [] };
    for (const k of cases) {
      const t0 = performance.now(); let wh = null;
      const res = await develop(f, k.long, (ow, oh) => { wh = [ow, oh]; const kept = carry(head, meta, false, ow, oh); return k.fmt === 'JPEG' ? files.jpeg(ow, oh, k.q, band, kept && block(kept)) : k.fmt === 'PNG' ? files.png(ow, oh, kept && block(kept)) : files.tiff(ow, oh, kept); });
      const name = `ex-${tag}-${k.fmt}-${k.long}${k.fmt === 'JPEG' ? '-q' + k.q : ''}.${{ JPEG: 'jpg', PNG: 'png', TIFF: 'tif' }[k.fmt]}`;
      save(res.blob, name); log.done.push({ name, wh, bytes: res.blob.size, s: +((performance.now() - t0) / 1000).toFixed(1) });
    }
    const vc = document.createElement('canvas'), view = await f.view(1024, 128, vc, true), at = await view.region(f.width / 2 - 512, 192, 1024, 128), img = await view.read();
    const oc = new OffscreenCanvas(at.cw, at.ch); oc.getContext('2d').putImageData(img, 0, 0); save(await oc.convertToBlob({ type: 'image/png' }), `ex-${tag}-seam-${at.X}-${at.Y}.png`);
    log.errs = errs; await new Promise((r2) => setTimeout(r2, 1500));
    return log;
  }, { cases, tag, meta: E.META || 'All', more: JSON.parse(E.MORE || '{}') });
  console.log(JSON.stringify(out)); await p.waitForTimeout(2000); console.log('saved', (await Promise.all(saves)).join(' '));
  await b.close();
})();
