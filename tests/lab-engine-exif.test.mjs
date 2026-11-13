// The engine's Exif (frontend/lab/engine/exif.js): what an export carries of the camera's, and what the Library
// keeps of how a photo was shot. The Exif blocks here are written by this test, byte by byte, in both byte orders,
// so the reader is held against something it did not write itself. (Until 2026-11-11 a fraction, which is two
// numbers of four bytes, was read as one: every export carried a wrong shutter time, aperture and focal length.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { block, carry, find, shot } from '../frontend/lab/engine/exif.js';

/** A JPEG's first bytes with an invented Exif block: the camera, an Exif directory (shutter 1/250, f/5.6, ISO 400,
 * 23 mm, a lens, a date), and an orientation. @param {boolean} le little-endian, or big */
function made(le) {
  const b = new Uint8Array(600), v = new DataView(b.buffer), T = 12;   // the TIFF starts after FFD8, FFE1, the length and "Exif\0\0"
  b.set([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  b.set(le ? [0x49, 0x49] : [0x4d, 0x4d], T); v.setUint16(T + 2, 42, le); v.setUint32(T + 4, 8, le);
  let free = 300;
  const text = (s) => { const at = free; for (let i = 0; i < s.length; i++) b[T + at + i] = s.charCodeAt(i); free += s.length + 1 + ((s.length + 1) & 1); return [s.length + 1, at]; };
  const ratio = (n, d) => { const at = free; v.setUint32(T + at, n, le); v.setUint32(T + at + 4, d, le); free += 8; return at; };
  const put = (at, k, tag, type, count, value, short = false) => { const p = T + at + 2 + k * 12; v.setUint16(p, tag, le); v.setUint16(p + 2, type, le); v.setUint32(p + 4, count, le); if (short) v.setUint16(p + 8, value, le); else v.setUint32(p + 8, value, le); };
  v.setUint16(T + 8, 4, le);   // the first directory: four entries
  put(8, 0, 0x010f, 2, ...text('Made-up')); put(8, 1, 0x0110, 2, ...text('Known')); put(8, 2, 0x0112, 3, 1, 6, true); put(8, 3, 0x8769, 4, 1, 100);
  v.setUint16(T + 100, 6, le);   // the Exif directory: six
  put(100, 0, 0x829a, 5, 1, ratio(1, 250)); put(100, 1, 0x829d, 5, 1, ratio(56, 10)); put(100, 2, 0x8827, 3, 1, 400, true);
  put(100, 3, 0x9003, 2, ...text('2026:03:14 10:20:30')); put(100, 4, 0x920a, 5, 1, ratio(23, 1)); put(100, 5, 0xa434, 2, ...text('Known 23mm F2'));
  v.setUint16(4, 2 + 6 + free);
  return b.subarray(0, T + free);
}
/** The fractions in a TIFF, read plainly: tag (hex) → "n/d". @param {Uint8Array} t */
function fractions(t) {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength), le = v.getUint16(0) === 0x4949, out = {};
  const walk = (at) => { for (let k = 0, n = v.getUint16(at, le); k < n; k++) { const p = at + 2 + k * 12, tag = v.getUint16(p, le), type = v.getUint16(p + 2, le), o = v.getUint32(p + 8, le);
    if (tag === 0x8769) walk(o); else if (type === 5) out[tag.toString(16)] = `${v.getUint32(o, le)}/${v.getUint32(o + 4, le)}`; } };
  walk(v.getUint32(4, le));
  return out;
}

for (const le of [true, false]) {
  test(`how a photo was shot is read from its Exif (${le ? 'little' : 'big'}-endian)`, () => {
    const s = shot(made(le));
    assert.deepEqual({ ...s, at: undefined }, { at: undefined, camera: 'Made-up Known', lens: 'Known 23mm F2', iso: 400, time: 1 / 250, f: 5.6, mm: 23 });
    const d = new Date(s.at);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 2, 14, 10, 20, 30], "the camera's clock, as this machine's local time");
  });
  test(`an export carries the shutter time, the aperture and the focal length as the camera wrote them (${le ? 'little' : 'big'}-endian)`, () => {
    const jpeg = made(le), kept = carry(jpeg, 'All', true, 4000, 3000);
    assert.deepEqual(fractions(/** @type {Uint8Array} */ (find(jpeg))), { '829a': '1/250', '829d': '56/10', '920a': '23/1' }, 'the test wrote what it meant to');
    assert.deepEqual(fractions(block(/** @type {any} */ (kept))), { '829a': '1/250', '829d': '56/10', '920a': '23/1' });
    // read back through the engine itself: the export is upright now, and says how it was shot
    const out = block(/** @type {any} */ (kept)), len = 2 + 6 + out.length, again = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...out]);
    assert.deepEqual({ ...shot(again), at: 0 }, { ...shot(jpeg), at: 0 });
  });
}
test("a camera that names its clock's zone is taken at its word, wherever the phone is", async () => {
  const { withExif } = await import('./fixtures/make-raf.mjs');
  const jpeg = withExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { make: 'FUJIFILM', model: 'X-E5', taken: '2026:10:30 17:00:05', zone: '-03:00', width: 640, height: 427, film: 0x600 });
  assert.equal(shot(jpeg).at, Date.UTC(2026, 9, 30, 20, 0, 5));
  assert.equal(shot(jpeg).camera, 'FUJIFILM X-E5');
});

test('a file with no Exif says nothing, and nothing is carried', () => {
  const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xda]);
  assert.deepEqual(shot(bare), { at: 0, camera: '', lens: '', iso: 0, time: 0, f: 0, mm: 0 });
  assert.equal(carry(bare, 'All', true, 10, 10), null);
});

test('how far the camera pushes a RAF for its JPEG is read from the RAF: the usual, a stop more, an extended low ISO a stop less', async () => {
  const { pushOf } = await import('../frontend/lab/engine/exif.js');
  /** A RAF's first bytes with a raw header holding the tags given (each: its number and its bytes). */
  const raf = (/** @type {[number, number[]][]} */ tags) => {
    const dir = [0, 0, 0, tags.length, ...tags.flatMap(([t, d]) => [t >> 8, t & 255, d.length >> 8, d.length & 255, ...d])], b = new Uint8Array(160 + dir.length), v = new DataView(b.buffer);
    b.set(new TextEncoder().encode('FUJIFILMCCD-RAW ')); v.setUint32(92, 160); v.setUint32(96, dir.length); b.set(dir, 160);
    return v;
  };
  const bias = (/** @type {number} */ hundredths) => { const n = new DataView(new ArrayBuffer(4)); n.setInt16(0, hundredths); n.setInt16(2, 100); return [...new Uint8Array(n.buffer)]; };
  const size = /** @type {[number, number[]]} */ ([0x100, [0, 0, 20, 0, 0, 0, 30, 0]]);
  assert.equal(pushOf(raf([size, [0x9650, bias(-72)]])), 100, 'the usual shot: as DR100');
  assert.equal(pushOf(raf([size, [0x9650, bias(-172)]])), 200, 'DR200, DR Auto or D-Range Priority at a stop: a stop more');
  assert.equal(pushOf(raf([[0x9650, bias(-272)], size])), 400);
  assert.equal(pushOf(raf([size, [0x9650, bias(28)]])), 50, 'an extended low ISO: its data is a stop over, and pulled back');
  assert.equal(pushOf(raf([size])), undefined, 'a RAF that does not say');
  assert.equal(pushOf(raf([[0x9650, [0, 1, 0, 0]]])), undefined, 'a bias with nothing under it');
  assert.equal(pushOf(new DataView(new ArrayBuffer(40))), undefined, 'not a RAF');
});
