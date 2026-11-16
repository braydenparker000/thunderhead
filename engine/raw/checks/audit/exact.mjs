// A picture with every grey level and strong colours, exported with nothing moved: how far each level comes out from itself.
import { start, opened } from './open.mjs';
const { browser, base, stop } = await start();
try {
  const draw = `
    const im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, v = Math.min(255, Math.floor(x / 3));
      let c = [v, v, v];
      if (y >= 96 && y < 192) c = [v, 0, 0]; else if (y >= 192 && y < 288) c = [0, v, 0]; else if (y >= 288 && y < 384) c = [0, 0, v];
      else if (y >= 384 && y < 480) c = [255, v, 0]; else if (y >= 480) c = [v, 255 - v, 255];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);`;
  const { page, errors } = await opened(browser, base, { W: 768, H: 576, draw });
  const out = await page.evaluate(async () => {
    const save = await import('/lab/editor/app/save.js');
    const [file] = await save.save([{ fmt: 'PNG', long: 99999, q: 0.9, meta: 'None', gps: false, file: 'x.png' }], () => {});
    const bm = await createImageBitmap(file.blob), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data, W = bm.width, H = bm.height;
    // per grey level (rows 0..95): mean output and spread
    const grey = [];
    for (let v = 0; v < 256; v++) { let s = 0, n = 0, lo = 255, hi = 0; for (let y = 8; y < 88; y++) { const x = v * 3 + 1, i = (y * W + x) * 4; for (let k = 0; k < 3; k++) { s += d[i + k]; n++; lo = Math.min(lo, d[i + k]); hi = Math.max(hi, d[i + k]); } } grey.push([v, +(s / n).toFixed(2), lo, hi]); }
    const worst = (y0, f) => { let w = 0, at = null; for (let v = 0; v < 256; v++) { const x = v * 3 + 1, want = f(v); for (let y = y0 + 8; y < y0 + 88; y++) { const i = (y * W + x) * 4; for (let k = 0; k < 3; k++) { const e = Math.abs(d[i + k] - want[k]); if (e > w) { w = e; at = [v, k, d[i], d[i + 1], d[i + 2]]; } } } } return [w, at]; };
    return { size: [W, H], grey: grey.filter((g) => g[0] < 6 || g[0] > 250 || g[1] !== g[0] || g[2] !== g[3]), n: grey.length,
      red: worst(96, (v) => [v, 0, 0]), green: worst(192, (v) => [0, v, 0]), blue: worst(288, (v) => [0, 0, v]), orange: worst(384, (v) => [255, v, 0]), mix: worst(480, (v) => [v, 255 - v, 255]) };
  });
  console.log(JSON.stringify(out));
  console.log('errors', errors.filter((e) => !/Service Worker/.test(e)));
} finally { await stop(); }
