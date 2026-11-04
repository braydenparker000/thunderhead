// @ts-check
// The Crop panel (PHOTOS.md, Crop and geometry): while it is open the photo shows its whole
// straightened frame with the crop over it: the frame with corner handles and the rule-of-thirds grid,
// the outside dimmed. Drag a corner or an edge to resize (held to the aspect when one is chosen), inside
// to move it. The tools: Aspect (Original, 1:1, 4:5, 3:2, 16:9, Free, and a turn between landscape and
// portrait), Rotate (the wheel, ±45°), Level (draw a line along what should be level), Flip, Vertical and
// Horizontal perspective, Constrain crop, and Reset. The crop is the recipe's CropLeft…CropBottom.
import { el } from '/th/ui.js';
import { icon } from '../shelf.js';
import { GEO_KEYS, aspectCrop, geometry } from './geometry.js';
import { val } from './fields.js';
import { segments } from './slider.js';

const ASPECTS = [['original', 'Original', 0], ['1:1', '1:1', 1], ['4:5', '4:5', 4 / 5], ['3:2', '3:2', 3 / 2], ['16:9', '16:9', 16 / 9], ['free', 'Free', 0]];
const CROP = ['CropLeft', 'CropTop', 'CropRight', 'CropBottom'];
const MIN = 0.05;

/** @typedef {import('./tools.js').Ed} Ed */
/** The crop's aspect in pixels and the preset it matches, or Free. @param {Ed} ed */
export function aspectOf(ed) {
  const r = ed.recipe, w = (val(r, 'CropRight') - val(r, 'CropLeft')) * ed.img.width, h = (val(r, 'CropBottom') - val(r, 'CropTop')) * ed.img.height;
  const k = w / h, near = (/** @type {number} */ x) => Math.abs(k - x) < 0.01 * x;
  if (ed.aspect) return { k, id: ed.aspect };
  const hit = ASPECTS.find((a) => a[2] && (near(+a[2]) || near(1 / +a[2])));
  return { k, id: near(ed.img.width / ed.img.height) ? 'original' : hit ? String(hit[0]) : 'free' };
}

/** @param {Ed} ed @param {Record<string, number>} c */
const putCrop = (ed, c) => CROP.forEach((k, i) => ed.set(k, Math.round(c[k] * 1e4) / 1e4, i === 3));

/** The overlay on the stage. @param {HTMLElement} stage @param {Ed} ed */
export function cropOverlay(stage, ed) {
  const svg = (/** @type {string} */ tag, /** @type {Record<string, string>} */ a = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    return n;
  };
  const mask = svg('path', { class: 'cmask', 'fill-rule': 'evenodd' });
  const grid = svg('path', { class: 'cgrid' });
  const box = svg('rect', { class: 'cbox' });
  const line = svg('line', { class: 'cline' });
  const handles = [0, 1, 2, 3].map(() => svg('path', { class: 'chandle' }));
  const art = svg('svg', { class: 'ccrop', 'aria-hidden': 'true' });
  art.append(mask, grid, box, line, ...handles);
  const root = el('div', { class: 'coverlay', 'aria-label': 'The crop: drag a corner, an edge or the inside' }, [art]);
  stage.append(root);
  /** The displayed frame in CSS px, and the crop in display terms (the flips mirror it). */
  const placed = () => {
    const b = stage.getBoundingClientRect(), a = ed.img.width / ed.img.height;
    const w = Math.min(b.width, b.height * a), h = w / a;
    return { x: (b.width - w) / 2, y: (b.height - h) / 2, w, h, b };
  };
  const shown = () => {
    const r = ed.recipe, fh = Boolean(r.FlipHorizontal), fv = Boolean(r.FlipVertical);
    const L = val(r, 'CropLeft'), T = val(r, 'CropTop'), R = val(r, 'CropRight'), B = val(r, 'CropBottom');
    return [fh ? 1 - R : L, fv ? 1 - B : T, fh ? 1 - L : R, fv ? 1 - T : B];
  };
  /** @param {number[]} d */
  const toCrop = (d) => {
    const fh = Boolean(ed.recipe.FlipHorizontal), fv = Boolean(ed.recipe.FlipVertical);
    return { CropLeft: fh ? 1 - d[2] : d[0], CropTop: fv ? 1 - d[3] : d[1], CropRight: fh ? 1 - d[0] : d[2], CropBottom: fv ? 1 - d[1] : d[3] };
  };
  let d = shown();
  const paint = () => {
    const p = placed(), X = (/** @type {number} */ u) => p.x + u * p.w, Y = (/** @type {number} */ v) => p.y + v * p.h;
    art.setAttribute('viewBox', `0 0 ${p.b.width} ${p.b.height}`);
    const [x0, y0, x1, y1] = [X(d[0]), Y(d[1]), X(d[2]), Y(d[3])];
    mask.setAttribute('d', `M0 0H${p.b.width}V${p.b.height}H0Z M${x0} ${y0}H${x1}V${y1}H${x0}Z`);
    box.setAttribute('x', String(x0)); box.setAttribute('y', String(y0));
    box.setAttribute('width', String(x1 - x0)); box.setAttribute('height', String(y1 - y0));
    const tx = [1, 2].map((i) => x0 + ((x1 - x0) * i) / 3), ty = [1, 2].map((i) => y0 + ((y1 - y0) * i) / 3);
    grid.setAttribute('d', [...tx.map((x) => `M${x} ${y0}V${y1}`), ...ty.map((y) => `M${x0} ${y}H${x1}`)].join(' '));
    const L = 18;
    [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]].forEach(([x, y, sx, sy], i) =>
      handles[i].setAttribute('d', `M${x} ${y + sy * L}V${y}H${x + sx * L}`));
    root.dataset.crop = d.map((v) => v.toFixed(3)).join(' ');
  };
  /** @type {null | { kind: string, x: number, y: number, d: number[] }} */
  let grab = null;
  root.addEventListener('pointerdown', (e) => {
    const p = placed(), b = p.b, x = e.clientX - b.left, y = e.clientY - b.top;
    root.setPointerCapture(e.pointerId);
    if (ed.mode === 'level') { grab = { kind: 'level', x, y, d }; line.setAttribute('x1', String(x)); line.setAttribute('y1', String(y)); return; }
    const near = (/** @type {number} */ a, /** @type {number} */ c) => Math.abs(a - c) < 24;
    const [x0, y0, x1, y1] = [p.x + d[0] * p.w, p.y + d[1] * p.h, p.x + d[2] * p.w, p.y + d[3] * p.h];
    const h = (near(x, x0) ? 'l' : near(x, x1) ? 'r' : '') + (near(y, y0) ? 't' : near(y, y1) ? 'b' : '');
    const inBox = x > x0 && x < x1 && y > y0 && y < y1;
    grab = h && (y > y0 - 24 && y < y1 + 24) && (x > x0 - 24 && x < x1 + 24) ? { kind: h, x, y, d: [...d] } : inBox ? { kind: 'move', x, y, d: [...d] } : null;
  });
  root.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const p = placed(), x = e.clientX - p.b.left, y = e.clientY - p.b.top;
    if (grab.kind === 'level') { line.setAttribute('x2', String(x)); line.setAttribute('y2', String(y)); root.dataset.level = 'drawing'; return; }
    const dx = (x - grab.x) / p.w, dy = (y - grab.y) / p.h, g = grab.d, n = [...g];
    if (grab.kind === 'move') {
      const w = g[2] - g[0], h = g[3] - g[1];
      n[0] = Math.min(1 - w, Math.max(0, g[0] + dx)); n[1] = Math.min(1 - h, Math.max(0, g[1] + dy));
      n[2] = n[0] + w; n[3] = n[1] + h;
    } else {
      if (grab.kind.includes('l')) n[0] = Math.min(g[2] - MIN, Math.max(0, g[0] + dx));
      if (grab.kind.includes('r')) n[2] = Math.max(g[0] + MIN, Math.min(1, g[2] + dx));
      if (grab.kind.includes('t')) n[1] = Math.min(g[3] - MIN, Math.max(0, g[1] + dy));
      if (grab.kind.includes('b')) n[3] = Math.max(g[1] + MIN, Math.min(1, g[3] + dy));
      const a = aspectOf(ed);
      if (a.id !== 'free') lock(n, grab.kind, a.k * (ed.img.height / ed.img.width));
    }
    d = n;
    paint();
  });
  root.addEventListener('pointerup', (e) => {
    const was = grab;
    grab = null;
    if (!was) return;
    if (was.kind === 'level') {
      const p = placed(), x = e.clientX - p.b.left, y = e.clientY - p.b.top;
      line.removeAttribute('x2');
      if (Math.hypot(x - was.x, y - was.y) < 24) return;
      let phi = (Math.atan2(y - was.y, x - was.x) * 180) / Math.PI;
      if (phi > 90) phi -= 180; else if (phi < -90) phi += 180;
      if (Math.abs(phi) > 45) phi -= Math.sign(phi) * 90;
      if (Boolean(ed.recipe.FlipHorizontal) !== Boolean(ed.recipe.FlipVertical)) phi = -phi;
      ed.set('CropAngle', Math.round(Math.max(-45, Math.min(45, val(ed.recipe, 'CropAngle') - phi)) * 10) / 10, true);
      root.dataset.level = 'done';
      ed.setMode('view');
      return;
    }
    putCrop(ed, toCrop(d));
  });
  paint();
  return { el: root, update() { if (!grab) d = shown(); paint(); }, remove() { root.remove(); } };
}

/** Holds `n` (display units) to aspect `k` (display width over height), the edge or corner dragged.
 * @param {number[]} n @param {string} kind @param {number} k */
function lock(n, kind, k) {
  const cx = (n[0] + n[2]) / 2, cy = (n[1] + n[3]) / 2;
  let w = n[2] - n[0], h = n[3] - n[1];
  if (kind === 't' || kind === 'b') w = h * k; else h = w / k;
  const s = Math.min(1, (kind.includes('l') ? n[2] : kind.includes('r') ? 1 - n[0] : 2 * Math.min(cx, 1 - cx)) / w, (kind.includes('t') ? n[3] : kind.includes('b') ? 1 - n[1] : 2 * Math.min(cy, 1 - cy)) / h);
  w *= s; h *= s;
  if (kind.includes('l')) n[0] = n[2] - w; else if (kind.includes('r')) n[2] = n[0] + w; else { n[0] = cx - w / 2; n[2] = cx + w / 2; }
  if (kind.includes('t')) n[1] = n[3] - h; else if (kind.includes('b')) n[3] = n[1] + h; else { n[1] = cy - h / 2; n[3] = cy + h / 2; }
}

/** The Crop panel's own tools above the chips. @param {Ed} ed @param {string} tool */
export function cropTool(ed, tool) {
  const g = () => geometry(ed.recipe, ed.img.width, ed.img.height);
  const button = (/** @type {string} */ ic, /** @type {string} */ label, /** @type {boolean} */ on, /** @type {() => void} */ run) => {
    const b = el('button', { type: 'button', class: `eauto${on ? ' on' : ''}`, 'aria-pressed': String(on) }, [icon(ic), el('span', { text: label })]);
    b.addEventListener('click', run);
    return b;
  };
  if (tool === 'aspect') {
    const box = el('div', { class: 'ecol' });
    const draw = () => {
      const a = aspectOf(ed), tall = a.k < 1;
      const row = segments(ASPECTS.map(([id, label]) => ({ id: String(id), label: String(label) })), a.id, (id) => {
        const p = ASPECTS.find((x) => x[0] === id);
        ed.aspect = id === 'free' ? 'free' : null;
        if (id !== 'free' && p) putCrop(ed, aspectCrop(g(), id === 'original' ? ed.img.width / ed.img.height : tall ? 1 / +p[2] : +p[2]));
        draw();
      });
      const turn = el('button', { type: 'button', class: 'seg', 'aria-label': tall ? 'Make it landscape' : 'Make it portrait' }, [icon('arrow-clockwise')]);
      turn.addEventListener('click', () => { putCrop(ed, aspectCrop(g(), 1 / a.k)); draw(); });
      row.append(turn);
      box.replaceChildren(row);
    };
    draw();
    return box;
  }
  if (tool === 'level') {
    ed.setMode('level', 'Draw a line along something that should be level or upright.');
    return el('p', { class: 'eline', text: 'Draw a line on the photo along the horizon or an edge: the photo turns to make it level.' });
  }
  if (tool === 'flip') {
    return el('div', { class: 'erow' }, [
      button('flip-horizontal', 'Flip across', Boolean(ed.recipe.FlipHorizontal), () => ed.set('FlipHorizontal', ed.recipe.FlipHorizontal ? undefined : true, true)),
      button('flip-vertical', 'Flip over', Boolean(ed.recipe.FlipVertical), () => ed.set('FlipVertical', ed.recipe.FlipVertical ? undefined : true, true)),
    ]);
  }
  if (tool === 'constrain') {
    const on = Boolean(ed.recipe.CropConstrainToWarp);
    return el('div', { class: 'erow' }, [button('crop', on ? 'Constrained' : 'Constrain crop', on, () => ed.set('CropConstrainToWarp', on ? undefined : true, true)),
      el('p', { class: 'eline', text: 'Keeps the crop inside the photo after perspective and distortion.' })]);
  }
  return el('div', { class: 'erow' }, [button('arrow-counter-clockwise', 'Reset', false, () => {
    ed.aspect = null;
    GEO_KEYS.forEach((k, i) => ed.set(k, undefined, i === GEO_KEYS.length - 1));
  }), el('p', { class: 'eline', text: 'Crop, rotation, flips and perspective back to as shot.' })]);
}
