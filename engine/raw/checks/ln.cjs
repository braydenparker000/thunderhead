// Lens correction check: develops the editing copy with and without the RAF's lens data and saves both, with
// the camera's own JPEG, for tools/lnchk.py to register against each other.   node ln.cjs <raf> [tag]
const { chromium } = require('playwright');
const S = __dirname, file = process.argv[2], tag = process.argv[3] || 'a';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block', acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error|warn/i.test(m.type())) console.log('LOG', m.text().slice(0, 300)); });
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/${d.suggestedFilename()}`).then(() => d.suggestedFilename())));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ tag }) => {
    const buf = await document.querySelector('#mine').files[0].arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let pre = null;
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.preview) pre = m.data; else if (m.data.proxy || m.data.error) res(m.data); }; w.postMessage(buf, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), errs = [];
    const save = async (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); await new Promise((q) => setTimeout(q, 400)); };
    const shot = async (meta, name) => {
      const c = document.createElement('canvas'), eng = await engine(c, { ...r, meta }, true);
      eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 300)));
      await eng.render(0.25, 1, {}); const im = await eng.snapshot(), oc = new OffscreenCanvas(im.width, im.height); oc.getContext('2d').putImageData(im, 0, 0);
      await save(await oc.convertToBlob({ type: 'image/png' }), name); eng.dispose(); return [im.width, im.height];
    };
    const on = await shot(r.meta, `ln-${tag}-on.png`), off = await shot({ ...r.meta, lens: null }, `ln-${tag}-off.png`);
    await save(pre.preview, `ln-${tag}-cam.jpg`);
    return { size: on, lens: r.meta.lens && { dist: r.meta.lens.dist.map((x) => +x.toFixed(1)) }, errs };
  }, { tag });
  console.log(JSON.stringify(out)); await p.waitForTimeout(1500); console.log('saved', (await Promise.all(saves)).join(' '));
  await b.close();
})();
