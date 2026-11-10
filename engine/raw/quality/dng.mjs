// A harness mosaic as a raw file other developers can open (a plain DNG: one strip, 16 bits, the X-Trans pattern):
//   node dng.mjs <crop.bin> <in.f32 mosaic, 0..1 of the sensor's range> <out.dng> [iso]
// So RawTherapee and darktable can be scored on the same known picture as the engine (README.md).
import fs from 'node:fs';
const [bin, inp, outp, iso = '125'] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K, { black, white, cfa, wb, xyzToCamD65 } = j.meta;
const m = new Float32Array(fs.readFileSync(inp).buffer.slice(0)), px = new Uint16Array(w * h);
for (let i = 0; i < w * h; i++) px[i] = Math.max(0, Math.min(65535, Math.round(m[i] * (white - black) + black)));
// SHIFT=<rows>,<columns>: the pattern is declared that far off where it is (RawTherapee 5.10 reads a DNG's X-Trans pattern from another corner than darktable does; README.md says which shift each wants)
const [sy, sx] = (process.env.SHIFT || '0,0').split(',').map(Number), said = Array.from({ length: 36 }, (_, i) => +cfa[((Math.floor(i / 6) + sy) % 6) * 6 + ((i % 6) + sx) % 6]);
const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SRATIONAL: 10 }, size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
const rat = (v, d = 10000) => [Math.round(v * d), d];
function ifd(tags, at) {   // tags: [id, type, values]; returns the directory's bytes laid out at file offset `at`
  tags.sort((a, b) => a[0] - b[0]);
  const head = 2 + tags.length * 12 + 4, extra = []; let off = at + head;
  const dir = Buffer.alloc(head); dir.writeUInt16LE(tags.length, 0);
  tags.forEach(([id, type, vals], k) => {
    const v = type === T.ASCII ? [...Buffer.from(vals + '\0')] : vals.flat(), n = type === T.RATIONAL || type === T.SRATIONAL ? v.length / 2 : v.length, bytes = Buffer.alloc(Math.max(4, v.length * (type === T.RATIONAL || type === T.SRATIONAL ? 4 : size[type])));
    v.forEach((x, i) => { if (type === T.BYTE || type === T.ASCII) bytes.writeUInt8(x, i); else if (type === T.SHORT) bytes.writeUInt16LE(x, i * 2); else if (type === T.SRATIONAL) bytes.writeInt32LE(x, i * 4); else bytes.writeUInt32LE(x, i * 4); });
    const e = 2 + k * 12; dir.writeUInt16LE(id, e); dir.writeUInt16LE(type, e + 2); dir.writeUInt32LE(n, e + 4);
    if (bytes.length <= 4) bytes.copy(dir, e + 8); else { dir.writeUInt32LE(off, e + 8); extra.push(bytes); off += bytes.length + (bytes.length & 1); if (bytes.length & 1) extra.push(Buffer.alloc(1)); }
  });
  return Buffer.concat([dir, ...extra]);
}
const data = Buffer.from(px.buffer), exifAt = 8 + data.length, exif = ifd([[0x8827, T.SHORT, [+iso]], [0x829a, T.RATIONAL, [[1, 250]]], [0x829d, T.RATIONAL, [[56, 10]]], [0x920a, T.RATIONAL, [[23, 1]]]], exifAt), mainAt = exifAt + exif.length + (exif.length & 1);
const main = ifd([[254, T.LONG, [0]], [256, T.LONG, [w]], [257, T.LONG, [h]], [258, T.SHORT, [16]], [259, T.SHORT, [1]], [262, T.SHORT, [32803]], [271, T.ASCII, 'FUJIFILM'], [272, T.ASCII, 'X-T5'],
  [273, T.LONG, [8]], [274, T.SHORT, [1]], [277, T.SHORT, [1]], [278, T.LONG, [h]], [279, T.LONG, [data.length]], [284, T.SHORT, [1]], [0x828d, T.SHORT, [6, 6]], [0x828e, T.BYTE, said], [0x8769, T.LONG, [exifAt]],
  [0xc612, T.BYTE, [1, 4, 0, 0]], [0xc613, T.BYTE, [1, 1, 0, 0]], [0xc614, T.ASCII, 'Fujifilm X-T5'], [0xc616, T.BYTE, [0, 1, 2]], [0xc617, T.SHORT, [1]], [0xc61a, T.LONG, [black]], [0xc61d, T.LONG, [white]],
  [0xc621, T.SRATIONAL, xyzToCamD65.map((v) => rat(v))], [0xc628, T.RATIONAL, [rat(wb[1] / wb[0], 1000000), rat(1, 1000000), rat(wb[1] / wb[2], 1000000)]], [0xc65a, T.SHORT, [21]]], mainAt);
const head = Buffer.alloc(8); head.write('II'); head.writeUInt16LE(42, 2); head.writeUInt32LE(mainAt, 4);
fs.writeFileSync(outp, Buffer.concat([head, data, exif, Buffer.alloc(exif.length & 1), main])); console.log('wrote', outp, w, h);
