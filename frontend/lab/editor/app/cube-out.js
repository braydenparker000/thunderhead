// @ts-check
// An edit's look saved as a `.cube` table (engine/raw/ROADMAP.md stage 9), to use it elsewhere: on video, or in
// another editor. A table answers one colour with another, so it holds what an edit does to colour alone:
// Contrast, Whites, Blacks, Saturation, Vibrance, the colour mixer, grading, the point curve and a `.cube` look
// that is on. It cannot hold what reads a pixel's place or its neighbours (Highlights and Shadows, which work by
// area; Texture, Clarity, Dehaze, sharpening, noise, the vignette, grain, masks, spots), and it leaves out what is
// the photo's own (Exposure, the white balance, the camera's profile). It is made by the engine itself: a picture
// that is every point of the table goes through the same frame as a photo, each pixel developed exactly.
import { engine } from '../../engine/gpu.js';
import { XYZ_TO_SRGB } from '../../engine/picture.js';
import { ZERO, dials } from './session.js';
import * as kept from './looks.js';

/** Points along each side: the size most editors and cameras take. */
export const SIZE = 33;
const NOT = ['Exposure', 'Temp', 'Tint', 'Highlights', 'Shadows', 'Texture', 'Clarity', 'Dehaze', 'Vignette', 'Grain', 'Sharpening', 'Noise', 'Color noise', 'Distortion', 'Vignetting', 'Defringe'];

/** The table's text for an edit. @param {import('./past.js').State} st @param {string} title */
export async function cubeOf(st, title) {
  const N = SIZE, w = N * N, h = N, proxy = new Uint16Array(w * h * 4), lin = (/** @type {number} */ c) => Math.round(65535 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  // red runs fastest, then green, then blue: the order a .cube lists them in
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) proxy.set([lin(r / (N - 1)), lin(g / (N - 1)), lin(b / (N - 1))], (b * w + g * N + r) * 4);
  const meta = { make: '', model: '', picture: true, width: w, height: h, proxyWidth: w, proxyHeight: h, fullWidth: w * 3, fullHeight: h * 3, wb: [1, 1, 1, 0], xyzToCamD65: XYZ_TO_SRGB, orientation: 'Normal', chroma: [0, 0, 0], black: 0, white: 65535, hot: 0, iso: 0, lens: null };
  const e = await engine(document.createElement('canvas'), { proxy, width: w, height: h, meta }, true), v = { ...ZERO, ...st.values };
  for (const k of NOT) v[k] = k === 'Sharpening' ? 0 : ZERO[k] ?? 0;
  try {
    e.setProfile({ cube: kept.get(st.cube)?.cube || null });
    await e.render(0, 2 ** ((v.Contrast / 100) * 0.6), { ...dials(v, st.curve || null), sharpen: 0, colorNoise: 0, exact: true, dither: false });
    const px = (await e.snapshot()).data, out = [`TITLE "${title.replace(/["\r\n]/g, '')}"`, `LUT_3D_SIZE ${N}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let i = 0; i < w * h; i++) out.push(`${(px[i * 4] / 255).toFixed(6)} ${(px[i * 4 + 1] / 255).toFixed(6)} ${(px[i * 4 + 2] / 255).toFixed(6)}`);
    return `${out.join('\n')}\n`;
  } finally { e.dispose(); }
}
/** Saves an edit's look to Downloads as `<name>.cube`. @param {import('./past.js').State} st @param {string} name */
export async function saveCube(st, name) {
  const file = `${name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'look'}.cube`, a = document.createElement('a'), url = URL.createObjectURL(new Blob([await cubeOf(st, name)], { type: 'text/plain' }));
  a.href = url; a.download = file; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return file;
}
