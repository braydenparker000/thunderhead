// Frank Markesteijn's X-Trans demosaic, after dcraw 9.20 as darktable carries it (src/iop/demosaicing/xtrans.c,
// GPL 3), ported plainly as a reference to measure against: the whole image is one tile. Not the editor's code.
// markesteijn(inp Float32Array w*h, w, h, cfa (36 digits, 0 red 1 green 2 blue, row-major 6x6), passes 1|3) -> Float32Array w*h*3
export function markesteijn(inp, width, height, cfa, passes = 3, greenOnly = false) {   // greenOnly: no red or blue is made; the smoothest green is chosen by the greens alone (out's red and blue are 0)
  const pad = passes === 1 ? 12 : 17, TS = width + 2 * pad, TH = height + 2 * pad, ndir = passes > 1 ? 8 : 4, N = TS * TH;
  const fc = (row, col) => +cfa[((row + 600) % 6) * 6 + ((col + 600) % 6)];
  const orth = [1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 0, 1], patt = [[0, 1, 0, -1, 2, 0, -1, 0, 1, 1, 1, -1, 0, 0, 0, 0], [0, 1, 0, -2, 1, 0, -2, 0, 1, 1, -2, -2, 1, -1, -1, 1]];
  const allhex = [0, 1, 2].map(() => [0, 1, 2].map(() => new Int32Array(8)));
  let sgrow = 0, sgcol = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) for (let ng = 0, d = 0; d < 10; d += 2) {
    const g = fc(row, col) === 1 ? 1 : 0;
    if (fc(row + orth[d], col + orth[d + 2]) === 1) ng = 0; else ng++;
    if (ng === 4) { sgrow = row; sgcol = col; }
    if (ng === g + 1) for (let c = 0; c < 8; c++) {
      const v = orth[d] * patt[g][c * 2] + orth[d + 1] * patt[g][c * 2 + 1], h = orth[d + 2] * patt[g][c * 2] + orth[d + 3] * patt[g][c * 2 + 1];
      allhex[row][col][c ^ ((g * 2) & d)] = h + v * TS;
    }
  }
  const hexmap = (row, col) => allhex[(row + 600) % 3][(col + 600) % 3], m3 = (x) => ((x % 3) + 3) % 3;
  const rgb = Array.from({ length: ndir }, () => new Float32Array(N * 3));
  const top = -pad, left = -pad, mrow = height + pad, mcol = width + pad, at = (row, col) => (row - top) * TS + (col - left);
  const tr = (n, size) => (n >= size ? 2 * size - n - 2 : Math.abs(n));
  // the image, with a mirrored border
  for (let row = top; row < mrow; row++) for (let col = left; col < mcol; col++) {
    const c = fc(row, col), o = at(row, col) * 3;
    if (col >= 0 && row >= 0 && col < width && row < height) { rgb[0][o + c] = Math.max(0, inp[width * row + col]); continue; }
    const cy = tr(row, height), cx = tr(col, width);
    if (c === fc(cy, cx)) rgb[0][o + c] = Math.max(0, inp[width * cy + cx]);
    else { let sum = 0, n = 0; for (let y = row - 1; y <= row + 1; y++) for (let x = col - 1; x <= col + 1; x++) { const yy = tr(y, height), xx = tr(x, width); if (fc(yy, xx) === c) { sum += Math.max(0, inp[width * yy + xx]); n++; } } rgb[0][o + c] = n ? sum / n : 0; }
  }
  for (let d = 1; d < 4; d++) rgb[d].set(rgb[0]);
  // the least and most green a red or blue site may be given: the six greens round its pair
  const gmin = new Float32Array(N), gmax = new Float32Array(N);
  for (let row = top + 3; row < mrow - 3; row++) for (let col = left + 3; col < mcol - 3; col++) {
    if (fc(row, col) === 1) continue;
    const p = at(row, col), hex = hexmap(row, col); let lo = Infinity, hi = 0;
    for (let c = 0; c < 6; c++) { const v = rgb[0][(p + hex[c]) * 3 + 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
    gmin[p] = lo; gmax[p] = hi;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // green along the row, the column and both diagonals
  for (let row = top + 3; row < mrow - 3; row++) for (let col = left + 3; col < mcol - 3; col++) {
    const f = fc(row, col); if (f === 1) continue;
    const p = at(row, col), hex = hexmap(row, col), R = rgb[0], G = (o) => R[(p + o) * 3 + 1], F = (o) => R[(p + o) * 3 + f], color = [0, 0, 0, 0];
    color[0] = 0.6796875 * (G(hex[1]) + G(hex[0])) - 0.1796875 * (G(2 * hex[1]) + G(2 * hex[0]));
    color[1] = 0.87109375 * G(hex[3]) + G(hex[2]) * 0.13 + 0.359375 * (F(0) - F(-hex[2]));
    for (let c = 0; c < 2; c++) color[2 + c] = 0.640625 * G(hex[4 + c]) + 0.359375 * G(-2 * hex[4 + c]) + 0.12890625 * (2 * F(0) - F(3 * hex[4 + c]) - F(-3 * hex[4 + c]));
    const flip = m3(row - sgrow) === 0 ? 1 : 0;
    for (let c = 0; c < 4; c++) rgb[c ^ flip][p * 3 + 1] = clamp(color[c], gmin[p], gmax[p]);
  }
  let base = 0;
  for (let pass = 0; pass < (greenOnly ? 0 : passes); pass++) {
    if (pass === 1) { for (let d = 0; d < 4; d++) rgb[4 + d].set(rgb[d]); base = 4; }
    if (pass) {   // green again, from the interpolated values of nearer pixels
      for (let row = top + 6; row < mrow - 6; row++) for (let col = left + 6; col < mcol - 6; col++) {
        const f = fc(row, col); if (f === 1) continue;
        const p = at(row, col), hex = hexmap(row, col), flip = m3(row - sgrow) === 0 ? 1 : 0;
        for (let d = 3; d < 6; d++) {
          const R = rgb[base + ((d - 2) ^ flip)], a = (p - 2 * hex[d]) * 3, b = (p + hex[d]) * 3;
          const val = R[a + 1] + 2 * R[b + 1] - R[a + f] - 2 * R[b + f] + 3 * R[p * 3 + f];
          R[p * 3 + 1] = clamp(val / 3, gmin[p], gmax[p]);
        }
      }
    }
    // red and blue at the lone greens
    const pg = passes === 1 ? 6 : 5;
    for (let row = top + pg; row < mrow - pg; row++) { if (m3(row - sgrow)) continue; for (let col = left + pg; col < mcol - pg; col++) {
      if (m3(col - sgcol)) continue;
      const p = at(row, col) * 3; let h = fc(row, col + 1), i = 1, k = 0; const diff = [0, 0, 0, 0, 0, 0], color = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
      for (let d = 0; d < 6; d++, i ^= TS ^ 1, h ^= 2) {
        const R = rgb[base + k];
        for (let c = 0; c < 2; c++, h ^= 2) {
          const o = (i << c) * 3, g = 2 * R[p + 1] - R[p + o + 1] - R[p - o + 1];
          color[h !== 0 ? 1 : 0][d] = g + R[p + o + h] + R[p - o + h];
          if (d > 1) diff[d] += (R[p + o + 1] - R[p - o + 1] - R[p + o + h] + R[p - o + h]) ** 2 + g * g;
        }
        if (d < 2 || (d & 1)) { const dout = d - (d > 1 && diff[d - 1] < diff[d] ? 1 : 0); R[p] = color[0][dout] / 2; R[p + 2] = color[1][dout] / 2; k++; }
      }
    } }
    // red at blue sites and blue at red
    for (let row = top + pg; row < mrow - pg; row++) for (let col = left + pg; col < mcol - pg; col++) {
      const f = 2 - fc(row, col); if (f === 1) continue;
      const p = at(row, col) * 3, horiz = m3(row - sgrow) === 0, c = (horiz ? 1 : TS) * 3, h = (horiz ? 3 * TS : 3) * 3;
      for (let d = 0; d < 4; d++) {
        const R = rgb[base + d], g = R[p + 1];
        const i = d > 1 || (d === 0 && horiz) || (d === 1 && !horiz) || Math.abs(g - R[p + c + 1]) + Math.abs(g - R[p - c + 1]) < 2 * (Math.abs(g - R[p + h + 1]) + Math.abs(g - R[p - h + 1])) ? c : h;
        R[p + f] = (R[p + i + f] + R[p - i + f] + 2 * g - R[p + i + 1] - R[p - i + 1]) / 2;
      }
    }
    // red and blue in the 2 x 2 blocks of green
    const p22 = passes === 1 ? 8 : 4;
    for (let row = top + p22; row < mrow - p22; row++) { if (!m3(row - sgrow)) continue; for (let col = left + p22; col < mcol - p22; col++) {
      if (!m3(col - sgcol)) continue;
      const p = at(row, col) * 3, hex = hexmap(row, col);
      for (let d = 0, k = 0; d < ndir; d += 2, k++) {
        const R = rgb[base + k], a = hex[d] * 3, b = hex[d + 1] * 3;
        if (hex[d] + hex[d + 1]) { const g = 3 * R[p + 1] - 2 * R[p + a + 1] - R[p + b + 1]; for (let c = 0; c < 4; c += 2) R[p + c] = (g + 2 * R[p + a + c] + R[p + b + c]) / 3; }
        else { const g = 2 * R[p + 1] - R[p + a + 1] - R[p + b + 1]; for (let c = 0; c < 4; c += 2) R[p + c] = (g + R[p + a + c] + R[p + b + c]) / 2; }
      }
    } }
  }
  // which of the versions is smoothest at each pixel
  const dirs = [1, TS, TS + 1, TS - 1], drv = Array.from({ length: ndir }, () => new Float32Array(N)), yuv = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const py = passes === 1 ? 8 : 13;
  for (let d = 0; d < ndir; d++) {
    const R = rgb[d];
    for (let r = py; r < TH - py; r++) for (let c = py; c < TS - py; c++) { const p = r * TS + c, y = greenOnly ? R[p * 3 + 1] : 0.2627 * R[p * 3] + 0.678 * R[p * 3 + 1] + 0.0593 * R[p * 3 + 2]; yuv[0][p] = y; if (greenOnly) continue; yuv[1][p] = (R[p * 3 + 2] - y) * 0.56433; yuv[2][p] = (R[p * 3] - y) * 0.67815; }
    const f = dirs[d & 3];
    for (let r = py + 1; r < TH - py - 1; r++) for (let c = py + 1; c < TS - py - 1; c++) { const p = r * TS + c; drv[d][p] = (2 * yuv[0][p] - yuv[0][p + f] - yuv[0][p - f]) ** 2 + (2 * yuv[1][p] - yuv[1][p + f] - yuv[1][p - f]) ** 2 + (2 * yuv[2][p] - yuv[2][p + f] - yuv[2][p - f]) ** 2; }
  }
  const homo = Array.from({ length: ndir }, () => new Uint8Array(N)), ph = py + 2;
  for (let r = ph; r < TH - ph; r++) for (let c = ph; c < TS - ph; c++) {
    const p = r * TS + c; let t = Infinity;
    for (let d = 0; d < ndir; d++) if (t > drv[d][p]) t = drv[d][p];
    t = Math.max(8 * t, 1e-10);
    for (let d = 0; d < ndir; d++) { let n = 0; for (let v = -1; v <= 1; v++) for (let h = -1; h <= 1; h++) if (drv[d][p + v * TS + h] <= t) n++; homo[d][p] = n; }
  }
  const out = new Float32Array(width * height * 3), hm = new Int32Array(8);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const p = at(row, col); let most = 0;
    for (let d = 0; d < ndir; d++) { let s = 0; for (let v = -2; v <= 2; v++) for (let h = -2; h <= 2; h++) s += homo[d][p + v * TS + h]; hm[d] = s; if (s > most) most = s; }
    most -= most >> 3;
    for (let d = 0; d < ndir - 4; d++) { if (hm[d] < hm[d + 4]) hm[d] = 0; else if (hm[d] > hm[d + 4]) hm[d + 4] = 0; }
    let n = 0, a = 0, b = 0, c = 0;
    for (let d = 0; d < ndir; d++) if (hm[d] >= most) { a += rgb[d][p * 3]; b += rgb[d][p * 3 + 1]; c += rgb[d][p * 3 + 2]; n++; }
    const o = (row * width + col) * 3; out[o] = Math.max(0, a / n); out[o + 1] = Math.max(0, b / n); out[o + 2] = Math.max(0, c / n);
  }
  return out;
}
