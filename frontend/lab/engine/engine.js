// @ts-check
// The engine test page (docs/engineering/ENGINE-RESEARCH.md): open a RAF (the camera's JPEG shows at once
// while the RAW decodes on a worker), develop it on the GPU through a camera profile from the owner's own
// set (kept in this browser only), and show what each step costs on this phone.
import { engine } from './gpu.js';
import { catalogue, saveSet, storedSet, unzip } from './profiles.js';
import { compare, grid } from './compare.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view')), ev = /** @type {HTMLInputElement} */ ($('ev')), ct = /** @type {HTMLInputElement} */ ($('ct'));
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
/** @type {ReturnType<typeof catalogue>} */
let list = [];
const frames = /** @type {number[]} */ ([]);
// Exposure the developer adds before your own: the camera's DR mode (DR200/DR400 shoot 1/2 stops under)
// and a per-camera baseline (what Adobe's converter adds), measured against the camera JPEG.
const BASELINE_EV = 0.25;
let shotEv = 0;

const draw = async () => {
  if (!eng) return;
  if (busy) { again = true; return; }
  busy = true;
  const t = await eng.render(Number(ev.value) + shotEv, Number(ct.value));
  busy = false;
  frames.push(t); if (frames.length > 30) frames.shift();
  stats['Frame (GPU)'] = `${ms(t)} · median ${ms([...frames].sort((a, b) => a - b)[frames.length >> 1])}`;
  show();
  if (again) { again = false; draw(); }
};
ev.addEventListener('input', () => { $('evv').textContent = `${Number(ev.value) >= 0 ? '+' : ''}${Number(ev.value).toFixed(2)} EV`; draw(); });
ct.addEventListener('input', () => { $('ctv').textContent = Number(ct.value).toFixed(2); draw(); });

/** Fills the picker for this camera, Adobe Standard first. @param {string} model */
const fillPicker = (model) => {
  if (!files) return;
  list = catalogue(files, model);
  pick.replaceChildren(...[{ label: 'Camera matrix (no profile)' }, ...list].map((e, k) => Object.assign(document.createElement('option'), { value: String(k - 1), textContent: e.label })));
  pick.disabled = false;
  const std = list.findIndex((e) => /Adobe Standard/.test(e.label));
  pick.value = String(std);
};
const usePick = () => {
  if (!eng) return;
  const e = list[Number(pick.value)] || null, k = eng.setProfile(e);
  $('kelvin').textContent = `${k} K`;
  $('which').textContent = e ? `${e.label}: ${e.profile.name}${e.table ? ' + look table' : ''}` : 'Camera matrix and a simple curve: no profile';
  draw().then(check);
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

const loadSet = async (/** @type {ArrayBuffer} */ buf) => { files = await unzip(buf); fillPicker(stats.Camera?.split(' · ')[0] || ''); };
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
      if (m.data.preview) { shotEv = BASELINE_EV + Math.log2((m.data.dr || 100) / 100); stats['DR mode'] = `DR${m.data.dr || 100}`; preview.src = URL.createObjectURL(m.data.preview); preview.hidden = false; stats["Camera's JPEG on screen"] = ms(performance.now() - t0); show(); return; }
      res(m.data);
    };
    worker.postMessage(buf, [buf]);
  });
  if (r.error) { stats.Status = `Couldn't open it: ${r.error}`; show(); return; }
  stats.Camera = `${r.meta.make} ${r.meta.model} · ${r.meta.width} × ${r.meta.height}`;
  stats.Decode = `${ms(r.decodeMs)} (worker round trip ${ms(performance.now() - t1)})`;
  stats['Editing copy'] = `${r.width} × ${r.height}`;
  try {
    eng = await engine(canvas, r, new URLSearchParams(location.search).has('readback'));
    stats.GPU = eng.adapter; stats.Upload = ms(eng.uploadMs); stats.Status = 'Ready: move the sliders';
    if (files) fillPicker(`${r.meta.make} ${r.meta.model}`);
    usePick();
    await draw();
    stats['To developed image'] = ms(performance.now() - t0);
    show();
  } catch (err) { console.error(err); stats.Status = String(/** @type {any} */ (err)?.message || err); show(); }
});
