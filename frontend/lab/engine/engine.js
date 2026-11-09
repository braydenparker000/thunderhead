// @ts-check
// The engine test page (docs/engineering/ENGINE-RESEARCH.md): open a RAF, decode it on a worker, develop
// it on the GPU, and show what each step costs on this phone.
import { engine } from './gpu.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view')), ev = /** @type {HTMLInputElement} */ ($('ev')), ct = /** @type {HTMLInputElement} */ ($('ct'));
/** @type {Record<string, string>} */
const stats = {};
const show = () => { $('stats').replaceChildren(...Object.entries(stats).flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd]; })); };
const ms = (/** @type {number} */ x) => `${Math.round(x)} ms`;
const worker = new Worker(new URL('./decode-worker.js', import.meta.url), { type: 'module' });
/** @type {null | { render: (ev: number, c: number) => Promise<number> }} */
let eng = null, busy = false, again = false;
const frames = /** @type {number[]} */ ([]);

const draw = async () => {
  if (!eng) return;
  if (busy) { again = true; return; }
  busy = true;
  const t = await eng.render(Number(ev.value), Number(ct.value));
  busy = false;
  frames.push(t); if (frames.length > 30) frames.shift();
  stats['Frame (GPU)'] = `${ms(t)} · median ${ms([...frames].sort((a, b) => a - b)[frames.length >> 1])}`;
  show();
  if (again) { again = false; draw(); }
};
ev.addEventListener('input', () => { $('evv').textContent = `${Number(ev.value) >= 0 ? '+' : ''}${Number(ev.value).toFixed(2)} EV`; draw(); });
ct.addEventListener('input', () => { $('ctv').textContent = Number(ct.value).toFixed(2); draw(); });

$('file').addEventListener('change', async (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (!f) return;
  for (const k of Object.keys(stats)) delete stats[k];
  stats.File = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`; stats.Status = 'Reading…'; show();
  const t0 = performance.now();
  const buf = await f.arrayBuffer();
  stats.Read = ms(performance.now() - t0); stats.Status = 'Decoding…'; show();
  const t1 = performance.now();
  const r = await new Promise((res) => { worker.onmessage = (m) => res(m.data); worker.postMessage(buf, [buf]); });
  if (r.error) { stats.Status = `Couldn't open it: ${r.error}`; show(); return; }
  stats.Camera = `${r.meta.make} ${r.meta.model} · ${r.meta.width} × ${r.meta.height}`;
  stats.Decode = `${ms(r.decodeMs)} (worker round trip ${ms(performance.now() - t1)})`;
  stats['Editing copy'] = `${r.width} × ${r.height}`;
  try {
    const e2 = await engine(canvas, r, new URLSearchParams(location.search).has('readback'));
    eng = e2;
    stats.GPU = e2.adapter; stats.Upload = ms(e2.uploadMs); stats.Status = 'Ready: move the sliders';
    stats['To first image'] = ms(performance.now() - t0);
    await draw();
  } catch (err) { console.error(err); stats.Status = String(/** @type {any} */ (err)?.message || err); show(); }
});
