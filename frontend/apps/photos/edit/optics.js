// @ts-check
// Optics (PHOTOS.md, Optics): Remove chromatic aberration measures this photo's lateral colour fringes
// on the RAW working copy (the radial scale of red and of blue that best lines each up with green at
// the strongest edges of the outer frame) and the develop pass samples red and blue at those scales;
// Distortion and Lens vignetting are set by hand (the lens's own tables in a RAF are not read yet).
import { el } from '/th/ui.js';
import { icon } from '../shelf.js';

/** @type {Float32Array | null} */
let F16 = null;
const f16 = () => F16 ?? (F16 = Float32Array.from({ length: 65536 }, (_, h) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15);
}));

/** [red, blue] radial scales less one, or [0, 0] for a photo the browser decoded (cameras fix their JPEGs).
 * @param {import('./renderer.js').Source} src */
export function lateralCA(src) {
  if (src.kind !== 'planar') return [0, 0];
  const { width: w, height: h, data } = src, n = w * h, f = f16();
  const at = (/** @type {number} */ c, /** @type {number} */ x, /** @type {number} */ y) => {
    const xi = Math.max(0, Math.min(w - 2, Math.floor(x))), yi = Math.max(0, Math.min(h - 2, Math.floor(y))), fx = x - xi, fy = y - yi, o = c * n + yi * w + xi;
    return (f[data[o]] * (1 - fx) + f[data[o + 1]] * fx) * (1 - fy) + (f[data[o + w]] * (1 - fx) + f[data[o + w + 1]] * fx) * fy;
  };
  const cx = w / 2, cy = h / 2, rmax = Math.hypot(cx, cy);
  /** @type {number[][]} */
  const pts = [];
  for (let y = 8; y < h - 8; y += 6) {
    for (let x = 8; x < w - 8; x += 6) {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r < 0.45 * rmax) continue;
      const ux = dx / r, uy = dy / r, a = at(1, x + ux, y + uy), b = at(1, x - ux, y - uy);
      if (Math.abs(a - b) / ((a + b) / 2 + 1e-3) > 0.3) pts.push([x, y, ux, uy]);
    }
  }
  const step = Math.max(1, Math.floor(pts.length / 4000)), use = pts.filter((_, i) => i % step === 0);
  if (use.length < 50) return [0, 0];
  const best = (/** @type {number} */ c) => {
    let bk = 0, bs = -Infinity;
    for (let i = -20; i <= 20; i++) {
      const k = i * 1e-4;
      let s = 0;
      for (const [x, y, ux, uy] of use) {
        let sg = 0, sc = 0, sgg = 0, scc = 0, sgc = 0;
        for (let t = -3; t <= 3; t++) {
          const gx = x + ux * t, gy = y + uy * t, g = at(1, gx, gy), v = at(c, cx + (gx - cx) * (1 + k), cy + (gy - cy) * (1 + k));
          sg += g; sc += v; sgg += g * g; scc += v * v; sgc += g * v;
        }
        s += (sgc - (sg * sc) / 7) / Math.sqrt(Math.max(1e-12, (sgg - (sg * sg) / 7) * (scc - (sc * sc) / 7)));
      }
      if (s > bs + 1e-9) { bs = s; bk = k; }
    }
    return bk;
  };
  return [best(0), best(2)];
}

/** The Optics panel's switch. @param {import('./tools.js').Ed} ed */
export function opticsTool(ed) {
  const on = Boolean(ed.recipe.AutoLateralCA);
  const b = el('button', { type: 'button', class: `eauto${on ? ' on' : ''}`, 'aria-pressed': String(on) }, [icon('aperture'), el('span', { text: on ? 'Removing colour fringes' : 'Remove chromatic aberration' })]);
  b.addEventListener('click', () => ed.set('AutoLateralCA', on ? undefined : true, true));
  const ca = ed.img.ca;
  const say = !ed.rawPhoto ? 'A camera’s JPEG comes with this done already.'
    : on && ca ? (ca[0] || ca[1] ? 'Red and blue lined up with green, measured on this photo.' : 'Measured: no fringes worth moving on this photo.')
    : 'Lines red and blue up with green where edges fringe toward the corners.';
  return el('div', { class: 'erow' }, [b, el('p', { class: 'eline', text: say })]);
}
