// @ts-check
// The point curve inside Light (PHOTOS.md, the editor): white (all channels), red, green or blue; tap
// to add a point, drag one, double-tap one to take it away. Points are [input, output] 0–255, the
// recipe's ToneCurvePV2012 keys, inputs kept strictly increasing; the two ends stay at the edges.
import { el } from '/th/ui.js';
import { segments } from './slider.js';
import { spline } from './uniforms.js';

const KEYS = { all: 'ToneCurvePV2012', red: 'ToneCurvePV2012Red', green: 'ToneCurvePV2012Green', blue: 'ToneCurvePV2012Blue' };
const LINE = [[0, 0], [255, 255]];
const HIT = 22;
const DOUBLE_MS = 300;

/** @param {() => Record<string, any>} get @param {(key: string, pts: number[][], done: boolean) => void} set */
export function curveTool(get, set) {
  let ch = /** @type {keyof typeof KEYS} */ ('all');
  const cv = el('canvas', { class: 'curve', width: '600', height: '600', 'aria-label': 'Tone curve' });
  const pts = () => /** @type {number[][]} */ (get()[KEYS[ch]] ?? LINE).map((p) => [...p]);
  const draw = () => {
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const n = cv.width;
    g.clearRect(0, 0, n, n);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((i * n) / 4, 0); g.lineTo((i * n) / 4, n); g.moveTo(0, (i * n) / 4); g.lineTo(n, (i * n) / 4); g.stroke(); }
    const p = pts(), f = spline(/** @type {any} */ (p));
    g.strokeStyle = { all: '#fff', red: '#ef5350', green: '#4caf50', blue: '#4f7bf0' }[ch];
    g.lineWidth = 4;
    g.beginPath();
    for (let x = 0; x <= n; x += 4) g.lineTo(x, n - f(x / n) * n);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    for (const [x, y] of p) { g.beginPath(); g.arc((x / 255) * n, n - (y / 255) * n, 12, 0, Math.PI * 2); g.fill(); }
  };
  /** @param {PointerEvent} e */
  const at = (e) => {
    const b = cv.getBoundingClientRect();
    return [Math.round(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * 255), Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - b.top) / b.height)) * 255)];
  };
  let drag = -1, last = 0, lastAt = -1;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = pts(), [x, y] = at(e), b = cv.getBoundingClientRect(), k = 255 / b.width;
    drag = p.findIndex((q) => Math.hypot(q[0] - x, q[1] - y) < HIT * k);
    if (drag >= 0 && e.timeStamp - last < DOUBLE_MS && lastAt === drag && drag > 0 && drag < p.length - 1) {
      p.splice(drag, 1);
      drag = -1;
      set(KEYS[ch], p, true);
      draw();
      return;
    }
    last = e.timeStamp;
    lastAt = drag;
    if (drag < 0 && p.length < 16) {
      drag = p.findIndex((q) => q[0] > x);
      if (drag <= 0) { drag = -1; return; }
      p.splice(drag, 0, [x, y]);
      lastAt = drag;
      set(KEYS[ch], p, false);
      draw();
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0 || !cv.hasPointerCapture(e.pointerId)) return;
    const p = pts(), [x, y] = at(e);
    const lo = drag === 0 ? 0 : p[drag - 1][0] + 1, hi = drag === p.length - 1 ? 255 : p[drag + 1][0] - 1;
    p[drag] = [drag === 0 ? 0 : drag === p.length - 1 ? 255 : Math.min(hi, Math.max(lo, x)), y];
    set(KEYS[ch], p, false);
    draw();
  });
  cv.addEventListener('pointerup', () => { if (drag >= 0) set(KEYS[ch], pts(), true); drag = -1; });
  const tabs = segments([{ id: 'all', label: 'All' }, { id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }, { id: 'blue', label: 'Blue' }], ch, (id) => { ch = /** @type {any} */ (id); draw(); });
  const reset = el('button', { type: 'button', class: 'seg', text: 'Reset' });
  reset.addEventListener('click', () => { set(KEYS[ch], LINE, true); draw(); });
  tabs.append(reset);
  queueMicrotask(draw);
  return { el: el('div', { class: 'curvebox' }, [tabs, cv]), show: draw };
}
