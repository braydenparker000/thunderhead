// @ts-nocheck
// The engine test page's decoder thread (docs/engineering/ENGINE-RESEARCH.md): rawler in wasm opens the
// RAF and bins the X-Trans mosaic into the editing proxy, off the page's thread so the UI never stalls.
import init, { decode } from './pkg/th_raw.js';

/** From the camera JPEG's Exif: how to turn the photo upright (rawler reads no orientation from a RAF), and
 * Fujifilm's DR setting (100, 200 or 400) from its maker notes: DR200 and DR400 shoot 1 and 2 stops darker on
 * purpose, and the developer adds it back. @param {DataView} j */
function exifInfo(j) {
  const out = { dr: 100, orientation: 'Normal' };
  try {
    let a = 2; while (a < j.byteLength - 10 && !(j.getUint16(a) === 0xffe1 && j.getUint32(a + 4) === 0x45786966)) a += 2 + j.getUint16(a + 2);
    const t = a + 10, le = j.getUint16(t) === 0x4949, u16 = (o) => j.getUint16(t + o, le), u32 = (o) => j.getUint32(t + o, le);
    const find = (/** @type {number} */ ifd, /** @type {number} */ tag) => { for (let k = 0, n = u16(ifd); k < n; k++) if (u16(ifd + 2 + k * 12) === tag) return ifd + 2 + k * 12; return -1; };
    const o = find(u32(4), 0x0112);
    if (o >= 0) out.orientation = { 3: 'Rotate180', 6: 'Rotate90', 8: 'Rotate270' }[u16(o + 8)] || 'Normal';
    const exif = u32(find(u32(4), 0x8769) + 8), mn = t + u32(find(exif, 0x927c) + 8), io = mn + j.getUint32(mn + 8, true);
    for (let k = 0, n = j.getUint16(io, true); k < n; k++) if (j.getUint16(io + 2 + k * 12, true) === 0x1403) out.dr = j.getUint16(io + 10 + k * 12, true) || 100;
  } catch {}
  return out;
}

const ready = init({ module_or_path: new URL('./pkg/th_raw_bg.wasm', import.meta.url) });
self.onmessage = async (e) => {
  try {
    // the camera's own JPEG first (RAF header: its offset and length at bytes 84 and 88, big-endian), so the
    // photo shows while the RAW decodes
    const v = new DataView(e.data);
    let info = { dr: 100, orientation: 'Normal' };
    if (v.byteLength > 92 && new TextDecoder().decode(new Uint8Array(e.data, 0, 8)) === 'FUJIFILM') {
      const off = v.getUint32(84), len = v.getUint32(88);
      if (off + len <= v.byteLength) {
        info = exifInfo(new DataView(e.data, off, len));
        self.postMessage({ preview: new Blob([new Uint8Array(e.data, off, len)], { type: 'image/jpeg' }), dr: info.dr });
      }
    }
    await ready;
    const t0 = performance.now();
    const d = decode(new Uint8Array(e.data));
    const t1 = performance.now();
    const proxy = d.proxy();
    const meta = JSON.parse(d.meta());
    if (meta.orientation === 'Normal') meta.orientation = info.orientation;
    const msg = { meta, width: d.width(), height: d.height(), proxy, decodeMs: t1 - t0 };
    d.free();
    self.postMessage(msg, [proxy.buffer]);
  } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
