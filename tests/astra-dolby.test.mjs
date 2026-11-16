// Dolby Vision profile 5 films in Astra: the configuration record that says a film is one (Matroska's
// BlockAdditionMapping and MP4's dvcC box, both read by Astra's own readers), and the colour maths
// that turns IPTPQc2 planes into BT.2020 light (frontend/astra/src/enhance/dolby.js), checked against
// facts from outside the module and against the browser's step as it was measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dolbyVision, readLayout } from '../frontend/astra/src/engine/mkv.js';
import { mp4DolbyVision } from '../frontend/astra/src/engine/mp4.js';
import * as dv from '../frontend/astra/src/enhance/dolby.js';
import { pq } from '../frontend/astra/src/enhance/tonemap.js';

const near = (a, b, e, what = '') => assert.ok(Math.abs(a - b) < e, `${what} ${a} is not ${b}`);
const nearM = (a, b, e) => a.forEach((r, i) => r.forEach((x, j) => near(x, b[i][j], e, `[${i}][${j}]`)));

// A configuration record: version 1.0, then profile (7 bits), level (6), rpu, el, bl flags, compatibility (4).
const record = (profile, level, compat) => Uint8Array.of(1, 0, profile << 1 | level >> 5, (level & 31) << 3 | 0b101, compat << 4, 0, 0, 0);

test('the Dolby Vision configuration record gives profile, level and compatibility', () => {
  assert.deepEqual(dolbyVision(record(5, 6, 0)), { profile: 5, level: 6, compatibility: 0 });
  assert.deepEqual(dolbyVision(record(8, 33, 1)), { profile: 8, level: 33, compatibility: 1 });
  assert.equal(dolbyVision(Uint8Array.of(1, 0, 10)), null);
});

// EBML: an element is its id's bytes, a one-byte size (0x80 | n), then the body.
const el = (id, ...body) => { const b = body.flatMap(x => [...x]); return Uint8Array.from([...id, 0x80 | b.length, ...b]); };
const str = s => [...s].map(c => c.charCodeAt(0));

test('a Matroska video track\'s BlockAdditionMapping with a dvcC record reaches the track', async () => {
  const track = el([0xae], el([0xd7], [1]), el([0x83], [1]), el([0x86], str('V_MPEGH/ISO/HEVC')),
    el([0x41, 0xe4], el([0x41, 0xe7], str('dvcC')), el([0x41, 0xed], record(5, 6, 0))));
  const file = Uint8Array.from([...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('matroska'))), ...el([0x18, 0x53, 0x80, 0x67], el([0x16, 0x54, 0xae, 0x6b], track))]);
  const layout = await readLayout(async (s, e) => file.subarray(s, e), file.length);
  assert.deepEqual(layout.tracks[0].dolbyVision, { profile: 5, level: 6, compatibility: 0 });
});

// MP4: a box is a 32-bit size, a four-letter type, then the body.
const box = (type, ...body) => { const b = body.flatMap(x => [...x]), n = b.length + 8; return Uint8Array.from([n >>> 24, n >> 16 & 255, n >> 8 & 255, n & 255, ...str(type), ...b]); };

test('an MP4 video track\'s sample entry with a dvcC box says what it is; a sound track does not count', () => {
  const hdlr = t => box('hdlr', new Uint8Array(8), str(t), new Uint8Array(12));
  const trak = (t, entry) => box('trak', box('mdia', hdlr(t), box('minf', box('stbl', box('stsd', new Uint8Array(8), entry)))));
  const dvh1 = box('dvh1', new Uint8Array(78), box('hvcC', new Uint8Array(4)), box('dvcC', record(5, 9, 0)));
  const moov = box('moov', trak('soun', box('mp4a', new Uint8Array(28))), trak('vide', dvh1));
  assert.deepEqual(mp4DolbyVision(moov), { profile: 5, level: 9, compatibility: 0 });
  assert.equal(mp4DolbyVision(box('moov', trak('vide', box('hvc1', new Uint8Array(78), box('hvcC', new Uint8Array(4)))))), null);
});

test('the matrices agree with what they are made from', () => {
  // The nonlinear matrix is the inverse of Ebner and Fairchild's L'M'S' -> IPT (1998).
  nearM(dv.invert(dv.NONLINEAR), [[0.4, 0.4, 0.2], [4.455, -4.851, 0.396], [0.8056, 0.3572, -1.1628]], 2e-3);
  // The linear matrix takes a 2 % crosstalk out.
  nearM(dv.invert(dv.LINEAR), [[0.96, 0.02, 0.02], [0.02, 0.96, 0.02], [0.02, 0.02, 0.96]], 1e-4);
  // LMS -> BT.2020 is the inverse of Hunt-Pointer-Estevez XYZ -> LMS (D65) times BT.2020's RGB -> XYZ.
  const hpe = [[0.40024, 0.70760, -0.08081], [-0.22630, 1.16532, 0.04570], [0, 0, 0.91822]];
  nearM(dv.invert(dv.LMS_TO_2020), dv.mul(hpe, dv.rgbToXyz('bt2020')), 1e-3);
  // BT.709 -> BT.2020 as BT.2087 gives it.
  nearM(dv.convert('srgb', 'bt2020'), [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]], 1e-4);
});

test('grey is I alone, at the PQ code of its light, and the planes come back to the same light', () => {
  for (const nits of [0.5, 5, 100, 203, 1000, 4000]) {
    const planes = dv.lightToPlanes([nits, nits, nits]);
    near(planes[0], pq(nits), 1e-4, 'I'); near(planes[1], 0.5, 1e-4, 'P'); near(planes[2], 0.5, 1e-4, 'T');
    dv.planesToLight(planes).forEach(v => near(v / nits, 1, 1e-6, 'grey'));
  }
  const skin = dv.apply(dv.convert('srgb', 'bt2020'), [80, 55, 42]);
  dv.planesToLight(dv.lightToPlanes(skin)).forEach((v, i) => near(v, skin[i], 1e-6, 'skin'));
});

// The browser's step as measured: R'G'B' by the frame's matrix and range, clipped to 0..1, then (for PQ)
// the EOTF, the canvas's primaries and the sRGB curve with 1.0 at 203 nits.
const enc = l => Math.sign(l) * (Math.abs(l) <= 0.0031308 ? Math.abs(l) * 12.92 : 1.055 * Math.abs(l) ** (1 / 2.4) - 0.055);
function upload(light2020, cs, space = 'srgb') {
  const codes = dv.lightToPlanes(light2020).map(v => Math.round(v * 1024));
  const rgbP = dv.browserRGB(codes, cs).map(v => Math.min(1, Math.max(0, v)));
  if (cs.transfer !== 'pq') return { codes, texel: rgbP };
  return { codes, texel: dv.apply(dv.convert('bt2020', space), rgbP.map(dv.pqNits)).map(n => enc(n / 203)) };
}

test('the correction gives back the film\'s light from what the browser uploaded, for PQ and for untagged films', () => {
  const into709 = dv.convert('srgb', 'bt2020');
  const colours = { grey: [100, 100, 100], skin: dv.apply(into709, [80, 55, 42]), sky: dv.apply(into709, [35, 55, 85]), red2020: [100, 0, 0], bright: [900, 900, 900] };
  for (const [cs, space] of [[{ matrix: 'bt2020-ncl', fullRange: false, transfer: 'pq' }, 'srgb'], [{ matrix: 'bt2020-ncl', fullRange: false, transfer: 'pq' }, 'display-p3'], [{ matrix: null, fullRange: false, transfer: null }, 'srgb']]) {
    const c = dv.correction(cs, space), back = dv.convert(space, 'bt2020');
    for (const [name, light] of Object.entries(colours)) {
      if (name === 'red2020' && !cs.matrix) continue; // BT.601's G' for it is below 0: clipped, like the blue below
      const got = dv.apply(back, dv.correct(upload(light, cs, space).texel, c));
      // Codes are whole numbers: a 10-bit step of I is about 1 % of the light.
      got.forEach((v, i) => near(v, light[i], Math.max(0.5, light[i] * 0.03), `${name} ${space} ${cs.transfer} channel ${i}`));
    }
  }
});

test('what the browser clipped stays wrong: a saturated blue\'s R\' went below 0, and the correction cannot know by how much', () => {
  const cs = { matrix: 'bt2020-ncl', fullRange: false, transfer: 'pq' }, blue = dv.apply(dv.convert('srgb', 'bt2020'), [0, 0, 100]);
  const { codes } = upload(blue, cs);
  assert.ok(dv.browserRGB(codes, cs)[0] < 0);
  const got = dv.correct(upload(blue, cs).texel, dv.correction(cs));
  assert.ok(Math.abs(got[2] - 100) > 5, `blue came back as ${got.map(Math.round)}`);
});
