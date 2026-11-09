// @ts-check
// Adobe's look files (docs/engineering/ENGINE-RESEARCH.md): Camera Raw keeps Adobe Color and its siblings as
// XMP, each naming a base camera profile and adding a LookTable (hue, saturation, value: the same table a DCP
// carries, stored in the file as text) and a point curve that follows the base profile's tone curve. The
// files are the owner's private ones (profiles.js); this only reads them.

const ABC = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?`'|()[]{}@%$#";
/** Adobe's text form of a table: base 85, five characters to four bytes, the low digit first. @param {string} text */
function bytes(text) {
  const out = new Uint8Array(Math.ceil((text.length * 4) / 5)); let n = 0, phase = 0, v = 0;
  for (const ch of text) {
    const d = ABC.indexOf(ch); if (d < 0) continue;
    v += d * 85 ** phase++;
    if (phase === 5) { for (let k = 0; k < 4; k++) out[n++] = (v / 2 ** (8 * k)) & 255; phase = 0; v = 0; }
  }
  for (let k = 0; k < phase - 1; k++) out[n++] = (v / 2 ** (8 * k)) & 255;
  return out.subarray(0, n);
}

/** The DNG SDK's curve through control points (its spline solver: smooth to the second derivative, which is
 * zero at both ends). @param {number[]} X @param {number[]} Y @returns {(x: number) => number} */
export function spline(X, Y) {
  const n = X.length, S = new Array(n).fill(0);
  let A = X[1] - X[0], B = (Y[1] - Y[0]) / A;
  S[0] = B;
  for (let j = 2; j < n; j++) { const C = X[j] - X[j - 1], D = (Y[j] - Y[j - 1]) / C; S[j - 1] = (B * C + D * A) / (A + C); A = C; B = D; }
  S[n - 1] = 2 * B - S[n - 2]; S[0] = 2 * S[0] - S[1];
  if (n > 2) {
    const E = new Array(n).fill(0), F = new Array(n).fill(0), G = new Array(n).fill(0);
    F[0] = 0.5; E[n - 1] = 0.5; G[0] = 0.75 * (S[0] + S[1]); G[n - 1] = 0.75 * (S[n - 2] + S[n - 1]);
    for (let j = 1; j < n - 1; j++) { A = (X[j + 1] - X[j - 1]) * 2; E[j] = (X[j + 1] - X[j]) / A; F[j] = (X[j] - X[j - 1]) / A; G[j] = 1.5 * S[j]; }
    for (let j = 1; j < n; j++) { A = 1 - F[j - 1] * E[j]; if (j !== n - 1) F[j] /= A; G[j] = (G[j] - G[j - 1] * E[j]) / A; }
    for (let j = n - 2; j >= 0; j--) G[j] -= F[j] * G[j + 1];
    for (let j = 0; j < n; j++) S[j] = G[j];
  }
  return (x) => {
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let j = 1; while (X[j] < x) j++;
    const a = X[j] - X[j - 1], b = (x - X[j - 1]) / a, c = (X[j] - x) / a;
    return (Y[j - 1] * (2 - c + b) + S[j - 1] * a * b) * c * c + (Y[j] * (2 - b + c) - S[j] * a * c) * b * b;
  };
}

const enc = (/** @type {number} */ x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
const dec = (/** @type {number} */ x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** Reads a look file. The point curve is on 0..255 of sRGB-encoded values (Camera Raw's curve axis: taken so,
 * to be checked against Lightroom when the engine is calibrated), returned as a function of linear values.
 * `needs` names what else the look sets that the engine can't do yet (Clarity, black and white…): such a look
 * would render wrong, so the picker leaves it out.
 * @param {string} text the XMP
 * @returns {Promise<null | { name: string, base: string, look: null | { dims: number[], d: Float32Array, srgb: boolean }, curve: null | ((x: number) => number), needs: string[] }>} */
export async function parseLook(text) {
  const attr = (/** @type {string} */ k) => new RegExp(`crs:${k}="([^"]*)"`).exec(text)?.[1];
  const base = attr('CameraProfile'), name = /<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]+)</.exec(text)?.[1];
  if (attr('PresetType') !== 'Look' || !base || !name) return null;
  let look = null;
  const id = attr('LookTable'), blob = id && attr(`Table_${id}`);
  if (blob) {
    const raw = bytes(blob.replaceAll('&apos;', "'"));
    const buf = await new Response(new Blob([raw.subarray(4)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(), v = new DataView(buf);
    if (v.getUint32(0, true) !== 0) return null;                  // 0: a look table (1 is an RGB table)
    const dims = [v.getUint32(8, true), v.getUint32(12, true), v.getUint32(16, true)], count = dims[0] * dims[1] * dims[2] * 3, d = new Float32Array(count);
    for (let k = 0; k < count; k++) d[k] = v.getFloat32(20 + k * 4, true);
    look = { dims, d, srgb: v.getUint32(20 + count * 4, true) === 1 };
  }
  const pts = [.../<crs:ToneCurvePV2012>([\s\S]*?)<\/crs:ToneCurvePV2012>/.exec(text)?.[1].matchAll(/<rdf:li>\s*(\d+),\s*(\d+)\s*<\/rdf:li>/g) || []].map((m) => [Number(m[1]) / 255, Number(m[2]) / 255]);
  const s = pts.length > 1 && pts.some(([x, y]) => x !== y) ? spline(pts.map((p) => p[0]), pts.map((p) => p[1])) : null;
  const needs = [...text.matchAll(/crs:(\w+?)(?:2012)?="([+-]?[\d.]+)"/g)].filter((m) => !/Version$|UUID|Table/.test(m[1]) && Number(m[2])).map((m) => m[1]);
  if (attr('ConvertToGrayscale') === 'True') needs.push('Black and white');
  return { name, base, look, curve: s && ((x) => dec(Math.min(1, Math.max(0, s(enc(x)))))), needs };
}
