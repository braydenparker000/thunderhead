// @ts-check
// A look as a .cube file (the 3D table that video and photo tools pass around): for each of n × n × n colours
// in, the colour out. The engine applies it to the finished picture as the screen holds it (sRGB), which is what
// these files are nearly always made for; one made for a camera's log footage will look too strong.

/** @typedef {{ n: number, d: Float32Array }} Cube `d`: n³ colours, red moving fastest (the file's own order) */

/** Reads a .cube file's text. Throws with a reason a person can read. @param {string} text @returns {Cube} */
export function parseCube(text) {
  let n = 0, k = 0, d = new Float32Array(0);
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] === '#') continue;
    const m = s.split(/\s+/);
    if (m[0] === 'LUT_3D_SIZE') { n = Number(m[1]); if (!(n >= 2 && n <= 65)) throw new Error('its table is a size this cannot hold'); d = new Float32Array(n * n * n * 3); }
    else if (m[0] === 'LUT_1D_SIZE') throw new Error('it is a 1D table, not a look');
    else if (m[0] === 'DOMAIN_MIN' || m[0] === 'DOMAIN_MAX') { if (m.slice(1, 4).some((v) => Number(v) !== (m[0] === 'DOMAIN_MIN' ? 0 : 1))) throw new Error('it is made for values outside 0 to 1'); }
    else if (/^[-+.\d]/.test(m[0]) && m.length >= 3) { if (k + 3 > d.length) throw new Error('it holds more colours than it says'); d[k++] = Number(m[0]); d[k++] = Number(m[1]); d[k++] = Number(m[2]); }
  }
  if (!n) throw new Error('it has no 3D table');
  if (k !== d.length) throw new Error('it holds fewer colours than it says');
  if (d.some((v) => !Number.isFinite(v))) throw new Error('some of its numbers cannot be read');
  return { n, d };
}
