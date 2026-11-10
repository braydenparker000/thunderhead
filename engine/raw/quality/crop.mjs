// Decodes a RAF with the repo's own decoder and writes a crop of its mosaic: node crop.mjs <raf> <out.bin> <x> <y> <w> <h>
// (x, y are moved down to a multiple of 6, so the crop's pattern is the sensor's own). Writes <out.bin>.json beside it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ENG = fileURLToPath(new URL('../../../frontend/lab/engine', import.meta.url));
const [raf, out, x0, y0, w, h] = process.argv.slice(2);
const glue = await import(`${ENG}/pkg/th_raw.js`);
await glue.default({ module_or_path: fs.readFileSync(`${ENG}/pkg/th_raw_bg.wasm`) });
const d = glue.decode(new Uint8Array(fs.readFileSync(raf)));
const meta = JSON.parse(d.meta()), mosaic = d.mosaic(), W = meta.rawWidth || meta.width || 0;
const FW = meta.fullWidth || W || Math.round(Math.sqrt(mosaic.length * 1.5)), FH = mosaic.length / FW;
const x = Math.floor(+x0 / 6) * 6, y = Math.floor(+y0 / 6) * 6, cw = +w, ch = +h, crop = new Uint16Array(cw * ch);
for (let r = 0; r < ch; r++) crop.set(mosaic.subarray((y + r) * FW + x, (y + r) * FW + x + cw), r * cw);
fs.writeFileSync(out, Buffer.from(crop.buffer));
fs.writeFileSync(out + '.json', JSON.stringify({ w: cw, h: ch, x, y, FW, FH, meta }));
console.log('wrote', out, cw, ch, 'of', FW, FH);
