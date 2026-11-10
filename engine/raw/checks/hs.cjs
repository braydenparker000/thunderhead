// Highlights and Shadows by the tone mask: renders with the mask on and off, one contact sheet, a few numbers.
const { chromium } = require('playwright'); const fs = require('fs');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [], file = process.env.FILE || 'raf/Fuji-X-H2-Uncompressed-Raw.RAF', tag = process.env.TAG || 'hs';
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => /error|warning/.test(m.type()) && errs.push(m.text().slice(0, 300)));
  if (process.env.TUNE) { const fsx = require('fs'); await p.route('**/lab/engine/mask.js', (r) => { let t = fsx.readFileSync('/home/user/thunderhead/frontend/lab/engine/mask.js', 'utf8'); for (const [a, b] of JSON.parse(process.env.TUNE)) { if (!t.includes(a)) console.log('TUNE miss', a); t = t.replace(a, b); } r.fulfill({ body: t, contentType: 'text/javascript' }); }); }
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(1500);
  await p.setInputFiles('#file', S + '/' + file);
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
  console.log('picked', await p.evaluate(() => document.querySelector('#profile').selectedOptions[0].textContent));
  const crop = (process.env.CROP || '').split(',').map(Number);   // x, y of a 1:1 crop (output pixels)
  const sets = JSON.parse(process.env.SETS || '[["base",{}],["H-100 area",{"highlights":-1}],["H-100 pixel",{"highlights":-1,"mask":false}],["S+100 area",{"shadows":1}],["S+100 pixel",{"shadows":1,"mask":false}],["area brightness",{"showMask":true}]]');
  const out = await p.evaluate(async ({ sets, crop, ev, tw0, cols0 }) => {
    const e = window.__engine, shots = [], nums = {};
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let base = null;
    for (const [name, o] of sets) {
      const ms = await e.render(ev, o.ct ?? 1, { dither: false, ...o }), ms2 = await e.render(ev, o.ct ?? 1, { dither: false, ...o });
      const im = await e.snapshot(); shots.push([name, im]);
      const d = im.data, W = im.width, H = im.height; if (!base) base = d;
      // local contrast (mean |Δ| of neighbours, in levels) where the base photo is dark (< 50) and where it is bright (> 180)
      let sd = 0, nd = 0, sb = 0, nb = 0, sum = 0, clip = 0, chr = 0;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W - 1; x += 2) { const i = (y * W + x) * 4, l0 = lum(base, i), g = Math.abs(lum(d, i) - lum(d, i + 4)); sum += lum(d, i); { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); chr += mx - mn; if (mn <= 1 && mx >= 48) clip++; } if (l0 < 50) { sd += g; nd++; } else if (l0 > 180) { sb += g; nb++; } }
      nums[name] = { clip: +(100 * clip / (W * H / 4)).toFixed(2), chroma: +(chr / (W * H / 4)).toFixed(1), mean: +(sum / (W * H / 4)).toFixed(1), darkDetail: +(sd / nd).toFixed(2), brightDetail: +(sb / nb).toFixed(2), };
    }
    const W = shots[0][1].width, H = shots[0][1].height, tw = Number(tw0), th = Math.round(tw * H / W), cw = 520, chh = crop.length === 2 ? 400 : 0, cols = Number(cols0), rows = Math.ceil(shots.length / cols);
    const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * (th + chh + 22); const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.font = '16px sans-serif';
    for (let k = 0; k < shots.length; k++) {
      const bm = await createImageBitmap(shots[k][1]), ox = (k % cols) * tw, oy = Math.floor(k / cols) * (th + chh + 22);
      x.drawImage(bm, ox, oy + 22, tw, th); if (chh) x.drawImage(bm, crop[0], crop[1], cw, chh, ox, oy + 22 + th, cw, chh);
      x.fillStyle = '#fff'; x.fillText(shots[k][0], ox + 6, oy + 16);
    }
    return { nums, size: [W, H], jpg: c.toDataURL('image/jpeg', 0.88).split(',')[1] };
  }, { sets, crop, ev: Number(process.env.EV || 0.25), tw0: process.env.TW || 520, cols0: process.env.COLS || 3 });
  fs.writeFileSync(`${S}/shots/${tag}.jpg`, Buffer.from(out.jpg, 'base64'));
  console.log('size', out.size.join('x')); for (const [k, v] of Object.entries(out.nums)) console.log(k.padEnd(16), JSON.stringify(v));
  console.log('errors', JSON.stringify(errs.slice(0, 6)));
  await b.close();
})();
