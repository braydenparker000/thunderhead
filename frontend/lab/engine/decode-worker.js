// @ts-nocheck
// The engine test page's decoder thread (docs/engineering/ENGINE-RESEARCH.md): rawler in wasm opens the
// RAF and bins the X-Trans mosaic into the editing proxy, off the page's thread so the UI never stalls.
// On a cross-origin isolated page (our service worker's COOP and COEP) it loads the threads build (pkg-threads/:
// shared memory, a rayon pool on Web Workers) so rawler decodes the RAF's strips on every core; otherwise, or
// if the pool does not start, the one-thread build.

/** From the camera JPEG's Exif: how to turn the photo upright (rawler reads no orientation from a RAF), and
 * Fujifilm's DR setting (100, 200 or 400) from its maker notes: DR200 and DR400 shoot 1 and 2 stops darker on
 * purpose, and the developer adds it back. @param {DataView} j */
function exifInfo(j) {
  const out = { dr: 100, orientation: 'Normal', settings: '' };
  try {
    let a = 2; while (a < j.byteLength - 10 && !(j.getUint16(a) === 0xffe1 && j.getUint32(a + 4) === 0x45786966)) a += 2 + j.getUint16(a + 2);
    const t = a + 10, le = j.getUint16(t) === 0x4949, u16 = (o) => j.getUint16(t + o, le), u32 = (o) => j.getUint32(t + o, le);
    const find = (/** @type {number} */ ifd, /** @type {number} */ tag) => { for (let k = 0, n = u16(ifd); k < n; k++) if (u16(ifd + 2 + k * 12) === tag) return ifd + 2 + k * 12; return -1; };
    const o = find(u32(4), 0x0112);
    if (o >= 0) out.orientation = { 3: 'Rotate180', 6: 'Rotate90', 8: 'Rotate270' }[u16(o + 8)] || 'Normal';
    const exif = u32(find(u32(4), 0x8769) + 8), mn = t + u32(find(exif, 0x927c) + 8), io = mn + j.getUint32(mn + 8, true);
    const mk = /** @type {Record<number, number>} */ ({});
    for (let k = 0, n = j.getUint16(io, true); k < n; k++) {
      const e = io + 2 + k * 12, type = j.getUint16(e + 2, true);
      mk[j.getUint16(e, true)] = type === 3 ? j.getUint16(e + 8, true) : type === 8 ? j.getInt16(e + 8, true) : type === 9 ? j.getInt32(e + 8, true) : type === 4 ? j.getUint32(e + 8, true) : NaN;
    }
    out.dr = mk[0x1403] || 100;
    out.settings = recipe(mk);
  } catch {}
  return out;
}

/** The shot's in-camera settings that change the camera's JPEG (Fujifilm maker notes, as exiftool names them):
 * film simulation, highlight and shadow tone, colour. @param {Record<number, number>} mk */
function recipe(mk) {
  const FILM = /** @type {Record<number, string>} */ ({ 0: 'PROVIA', 0x120: 'ASTIA', 0x200: 'Velvia', 0x400: 'Velvia', 0x500: 'Pro Neg Std', 0x501: 'Pro Neg Hi', 0x600: 'CLASSIC CHROME', 0x700: 'ETERNA', 0x800: 'CLASSIC Neg', 0x900: 'ETERNA BB', 0xa00: 'NOSTALGIC Neg', 0xb00: 'REALA ACE' });
  const SAT = /** @type {Record<number, string>} */ ({ 0: '0', 0x80: '+1', 0x100: '+2', 0xc0: '+3', 0xe0: '+4', 0x180: '-1', 0x400: '-2', 0x4c0: '-3', 0x4e0: '-4', 0x300: 'B&W', 0x500: 'ACROS', 0x8000: 'film' });
  const tone = (/** @type {number} */ v) => (Number.isFinite(v) ? v === 0 ? '0' : `${v < 0 ? '+' : ''}${-v / 16}` : '?');
  const film = 0x1401 in mk ? FILM[mk[0x1401]] ?? `0x${mk[0x1401].toString(16)}` : 'B&W';
  return `${film} · highlights ${tone(mk[0x1041])} · shadows ${tone(mk[0x1040])} · colour ${SAT[mk[0x1003]] ?? `0x${(mk[0x1003] ?? 0).toString(16)}`}`;
}

const THREADS = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
async function threaded() {
  const glue = await import('./pkg-threads/th_raw.js');
  await glue.default({ module_or_path: new URL('./pkg-threads/th_raw_bg.wasm', import.meta.url) });
  await Promise.race([glue.initThreadPool(THREADS), new Promise((_, no) => setTimeout(() => no(new Error('the decode threads did not start')), 10_000))]);
  return { decode: glue.decode, jpeg: glue.jpeg, threads: THREADS };
}
async function plain() {
  const glue = await import('./pkg/th_raw.js');
  await glue.default({ module_or_path: new URL('./pkg/th_raw_bg.wasm', import.meta.url) });
  return { decode: glue.decode, jpeg: glue.jpeg, threads: 1 };
}
let threadsError = '';
const ready = self.crossOriginIsolated && THREADS > 1 ? threaded().catch((err) => { threadsError = String(err?.message || err); console.warn(`decoder: one thread (${err})`); return plain(); }) : plain();
// A message is a RAF's bytes, or { buf, full: true, tag } to also get the sensor's own pixels, for 100 % and
// export. Every answer carries the request's tag, so a page that has moved on to another photo can tell.
// { jpeg: [rgb, width, rows, quality, fine], tag } is one band of an export's JPEG to encode (files.js).
self.onmessage = async (e) => {
  const tag = e.data.tag;
  try {
    if (e.data.jpeg) {
      const out = (await ready).jpeg(...e.data.jpeg);
      self.postMessage({ jpeg: out, tag }, [out.buffer]);
      return;
    }
    const buf = e.data.buf ?? e.data;
    // the camera's own JPEG first (RAF header: its offset and length at bytes 84 and 88, big-endian), so the
    // photo shows while the RAW decodes
    const v = new DataView(buf);
    let info = { dr: 100, orientation: 'Normal', settings: '' };
    if (v.byteLength > 92 && new TextDecoder().decode(new Uint8Array(buf, 0, 8)) === 'FUJIFILM') {
      const off = v.getUint32(84), len = v.getUint32(88);
      if (off + len <= v.byteLength) {
        info = exifInfo(new DataView(buf, off, len));
        self.postMessage({ preview: new Blob([new Uint8Array(buf, off, len)], { type: 'image/jpeg' }), dr: info.dr, settings: info.settings, tag });
      }
    }
    const { decode, threads } = await ready;
    const t0 = performance.now();
    const d = decode(new Uint8Array(buf));
    const t1 = performance.now();
    const proxy = d.proxy();
    const meta = JSON.parse(d.meta());
    if (meta.orientation === 'Normal') meta.orientation = info.orientation;
    const msg = { meta, width: d.width(), height: d.height(), proxy, decodeMs: t1 - t0, threads, threadsError, tag };
    self.postMessage(msg, [proxy.buffer]);
    // the sensor's pixels follow the editing copy, so the photo is on screen first
    const mosaic = e.data.full && meta.cfaWidth === 6 ? d.mosaic() : null;
    d.free();
    if (mosaic?.length) self.postMessage({ mosaic, tag }, [mosaic.buffer]);
  } catch (err) { self.postMessage({ error: String(err?.message || err), tag }); }
};
