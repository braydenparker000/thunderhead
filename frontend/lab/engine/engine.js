// @ts-check
// The engine test page (docs/engineering/ENGINE-RESEARCH.md): open a RAF (the camera's JPEG shows at once
// while the RAW decodes on a worker), develop it on the GPU through a camera profile from the owner's own
// set (kept in this browser only), and show what each step costs on this phone.
import { engine } from './gpu.js';
import { catalogue, saveSet, storedSet, unzip } from './profiles.js';
import { compare, grid } from './compare.js';
import { isolate } from './isolate.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view')), ev = /** @type {HTMLInputElement} */ ($('ev'));
// a −100..100 slider as −1..1, and Contrast as the engine takes it: the tone curve's slope at middle grey, on the editor's scale
const at = (/** @type {string} */ id) => Number(/** @type {HTMLInputElement} */ ($(id)).value) / 100, slope = () => 2 ** (at('ct') * 0.6);
const pick = /** @type {HTMLSelectElement} */ ($('profile')), preview = /** @type {HTMLImageElement} */ ($('preview'));
/** @type {Record<string, string>} */
const stats = {};
const show = () => { $('stats').replaceChildren(...Object.entries(stats).flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd]; })); };
const ms = (/** @type {number} */ x) => `${Math.round(x)} ms`;
const worker = new Worker(new URL('./decode-worker.js', import.meta.url), { type: 'module' });
/** @type {null | Awaited<ReturnType<typeof engine>>} */
let eng = null, busy = false, again = false;
/** @type {Map<string, ArrayBuffer> | null} */
let files = null;
/** @type {Awaited<ReturnType<typeof catalogue>>} */
let list = [];
const frames = /** @type {number[]} */ ([]);
// Exposure the developer adds before your own: the camera's DR mode (DR200/DR400 shoot 1/2 stops under)
// and a per-camera baseline (what Adobe's converter adds), measured against the camera JPEG.
const BASELINE_EV = 0.25;
let shotEv = 0;

// Decoding on every core needs this page cross-origin isolated (isolate.js).
const isolated = isolate('/lab/engine/');
const on = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).checked;

const draw = async () => {
  if (!eng) return;
  if (busy) { again = true; return; }
  busy = true;
  const t = await eng.render(Number(ev.value) + shotEv, slope(), { highlights: at('hi'), shadows: at('sh'), whites: at('wh'), blacks: at('bl'), saturation: at('sa'), vibrance: at('vi'), mask: on('mk'), showMask: on('sm'), rebuild: on('hl'), dither: on('dz'), exact: on('exact') });
  busy = false;
  // a frame that re-made the colour table (a new profile, Contrast) is timed apart from one that only read it (Exposure)
  if (eng.last.baked) stats['Frame, colour table re-made'] = ms(t);
  else { frames.push(t); if (frames.length > 30) frames.shift(); stats['Frame (GPU)'] = `${ms(t)} · median ${ms([...frames].sort((a, b) => a - b)[frames.length >> 1])}`; }
  show();
  if (again) { again = false; draw(); }
};
ev.addEventListener('input', () => { $('evv').textContent = `${Number(ev.value) >= 0 ? '+' : ''}${Number(ev.value).toFixed(2)} EV`; draw(); });
for (const id of ['ct', 'hi', 'sh', 'wh', 'bl', 'vi', 'sa']) $(id).addEventListener('input', () => { const v = Math.round(at(id) * 100); $(`${id}v`).textContent = `${v > 0 ? '+' : ''}${v}`; draw(); });
for (const id of ['hl', 'dz', 'exact', 'mk', 'sm']) $(id).addEventListener('change', () => { frames.length = 0; draw(); });

/** Fills the picker for this camera and picks Adobe Color (Adobe Standard when the set has no Adobe Color). @param {string} model */
const fillPicker = async (model) => {
  if (!files) return;
  list = await catalogue(files, model);
  pick.replaceChildren(...[{ label: 'Camera matrix (no profile)' }, ...list].map((e, k) => Object.assign(document.createElement('option'), { value: String(k - 1), textContent: e.label })));
  pick.disabled = false;
  const color = list.findIndex((e) => e.label === 'Adobe Color');
  pick.value = String(color >= 0 ? color : list.findIndex((e) => /Adobe Standard/.test(e.label)));
};
const usePick = () => {
  if (!eng) return;
  const e = list[Number(pick.value)] || null, k = eng.setProfile(e);
  $('kelvin').textContent = `${k} K`;
  $('which').textContent = e ? `${e.label}: ${e.profile.look2 ? `${e.profile.model} Adobe Standard + the look's table and curve` : e.profile.name}${e.table ? ' + look table' : ''}` : 'Camera matrix and a simple curve: no profile';
  const drawn = draw(); drawn.then(check);
  return drawn;
};
/** The colour check: this render against the camera's own JPEG (in the simulation it was shot with). */
const check = async () => {
  if (!eng || preview.hidden || !preview.complete) return;
  const shot = await eng.snapshot(), c = compare(grid(await createImageBitmap(shot)), grid(preview));
  stats['Vs camera JPEG'] = `brightness ${c.ev >= 0 ? '+' : ''}${c.ev.toFixed(2)} EV · colour ΔE ${c.mean.toFixed(1)} (90%: ${c.p90.toFixed(1)})`;
  /** @type {any} */ (window).__check = { ...c, profile: pick.selectedOptions[0]?.textContent };
  show();
};
pick.addEventListener('change', usePick);

// What each part of a frame costs on this phone: the same frame with one more part switched on each time, the
// median of nine. The first line is one frame after the chip has had a rest, as the first frame of a drag is.
$('time').addEventListener('click', async () => {
  const g = eng;
  if (!g || busy) return;
  busy = true;
  for (const k of Object.keys(stats)) if (k.startsWith('Timed')) delete stats[k];
  const e = Number(ev.value) + shotEv, c = slope(), off = { rebuild: false, dither: false };
  /** each: its name, what to render, and whether Contrast moves a hair every frame (so the colour table is re-made each time)
   * @type {[string, { highlights?: number, saturation?: number, mask?: boolean, rebuild?: boolean, dither?: boolean, time?: 'bare' | 'nearest' }, boolean?][]} */
  const steps = [['read and show only', { ...off, time: 'bare' }], ['+ colour table, nearest entry', { ...off, time: 'nearest' }], ['+ mixing its entries', off],
    ['+ rebuilding blown highlights', { dither: false }], ['+ dither: a whole frame', {}], ['+ Highlights −50 by pixel', { highlights: -0.5, mask: false }], ['+ Highlights −50 by area', { highlights: -0.5 }],
    ['a frame with Contrast moving (the colour table re-made)', {}, true], ['the same at Saturation +50', { saturation: 0.5 }, true]];
  await new Promise((r) => setTimeout(r, 1500));
  stats['Timed: a frame after a rest'] = ms(await g.render(e, c));
  for (const [name, more, moving] of steps) {
    const t = [], first = await g.render(e, c, more), made = g.last.masked;
    for (let k = 0; k < 9; k++) t.push(await g.render(e, moving ? c * (1 + (k + 1) * 1e-4) : c, more));
    const mid = t.sort((a, b) => a - b)[4];
    stats[`Timed: ${name}`] = ms(mid);
    if (made) stats['Timed: the area brightness, made once a photo'] = ms(first - mid);
    show();
  }
  busy = false; draw();
});

const loadSet = async (/** @type {ArrayBuffer} */ buf) => { files = await unzip(buf); await fillPicker(stats.Camera?.split(' · ')[0] || ''); };
$('profiles').addEventListener('change', async (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (!f) return;
  try { const buf = await f.arrayBuffer(); await loadSet(buf.slice(0)); await saveSet(buf); stats.Profiles = `${list.length} loaded and kept on this phone`; show(); usePick(); }
  catch (err) { stats.Profiles = `Couldn't read that: ${/** @type {any} */ (err)?.message || err}`; show(); }
});
storedSet().then((buf) => { if (buf) loadSet(buf).then(() => { stats.Profiles = `${list.length} on this phone`; show(); }); }).catch(() => {});

$('file').addEventListener('change', async (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (!f) return;
  for (const k of Object.keys(stats)) if (k !== 'Profiles') delete stats[k];
  stats.File = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`; stats.Status = 'Reading…'; show();
  const t0 = performance.now();
  const buf = await f.arrayBuffer();
  stats.Read = ms(performance.now() - t0); stats.Status = 'Decoding…'; show();
  const t1 = performance.now();
  const r = await new Promise((res) => {
    worker.onmessage = (m) => {
      if (m.data.preview) { shotEv = BASELINE_EV + Math.log2((m.data.dr || 100) / 100); stats['DR mode'] = `DR${m.data.dr || 100}`; if (m.data.settings) stats['Shot with'] = m.data.settings; preview.src = URL.createObjectURL(m.data.preview); preview.hidden = false; stats["Camera's JPEG on screen"] = ms(performance.now() - t0); show(); return; }
      res(m.data);
    };
    worker.postMessage(buf, [buf]);
  });
  if (r.error) { stats.Status = `Couldn't open it: ${r.error}`; show(); return; }
  stats.Camera = `${r.meta.make} ${r.meta.model} · ${r.meta.width} × ${r.meta.height}`;
  stats.Decode = `${ms(r.decodeMs)} on ${r.threads} thread${r.threads > 1 ? "s" : ""} (worker round trip ${ms(performance.now() - t1)})`;
  stats.Threads = crossOriginIsolated ? (r.threadsError ? `pool failed: ${r.threadsError}` : `${r.threads} (page isolated)`) : `1: ${isolated()}`;
  stats['Editing copy'] = `${r.width} × ${r.height}`;
  try {
    eng = await engine(canvas, r, new URLSearchParams(location.search).has('readback'));
    /** @type {any} */ (window).__engine = eng;   // for the checks run from outside the page
    stats.GPU = eng.adapter; stats.Upload = ms(eng.uploadMs); stats.Status = 'Ready: move the sliders'; /** @type {HTMLButtonElement} */ ($('time')).disabled = false;
    if (files) await fillPicker(`${r.meta.make} ${r.meta.model}`);
    await usePick();   // one frame: it makes the colour table and is the pipelines' first run, so it's far slower than a frame while editing
    stats['To developed image'] = ms(performance.now() - t0);
    show();
  } catch (err) { console.error(err); stats.Status = String(/** @type {any} */ (err)?.message || err); show(); }
});
