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

// Decoding on every core needs this page cross-origin isolated, which our service worker does (sw.js). A newer
// worker waits for the shell's safe moment, which this page never gives, and a phone that only ever opened
// this page has none: here nothing is open yet, so register or apply it and reload once. `isolation` says
// which, for the Threads row.
let isolation = crossOriginIsolated ? 'isolated' : 'not isolated';
if (!crossOriginIsolated && navigator.serviceWorker) (async () => {
  const once = () => { try { if (sessionStorage.getItem('engine-isolate')) return; sessionStorage.setItem('engine-isolate', '1'); } catch { return; } location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { isolation = 'service worker changed, reloading'; once(); });
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) { isolation = 'no service worker yet: installing it'; reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }); }
  else await reg.update().catch((e) => { isolation = `service worker update failed: ${e?.message || e}`; });
  const skip = (/** @type {ServiceWorker} */ w) => w.postMessage({ type: 'skipWaiting' });
  const follow = (/** @type {ServiceWorker} */ w) => w.addEventListener('statechange', () => {
    isolation = `new service worker ${w.state}`;
    if (w.state === 'installed') skip(w);
    if (w.state === 'redundant') isolation = 'the new service worker failed to install';
  });
  if (reg.waiting) { isolation = 'applying the waiting service worker'; skip(reg.waiting); }
  else if (reg.installing) { isolation = 'new service worker installing'; follow(reg.installing); }
  else if (reg.active && navigator.serviceWorker.controller) { isolation = 'the service worker in charge does not isolate this page'; once(); }
  else if (reg.active) { isolation = 'page opened without the service worker: reloading'; once(); }
})().catch((e) => { isolation = `service worker: ${e?.message || e}`; });

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
      if (m.data.preview) { shotEv = BASELINE_EV + Math.log2((m.data.dr || 100) / 100); stats['DR mode'] = `DR${m.data.dr || 100}`; if (m.data.settings) stats['Shot with'] = m.data.settings; preview.src = URL.createObjectURL(m.data.preview); preview.hidden = false; stats["Camera's JPEG on screen"] = ms(performance.now() - t0); show(); return; }
      res(m.data);
    };
    worker.postMessage(buf, [buf]);
  });
  if (r.error) { stats.Status = `Couldn't open it: ${r.error}`; show(); return; }
  stats.Camera = `${r.meta.make} ${r.meta.model} · ${r.meta.width} × ${r.meta.height}`;
  stats.Decode = `${ms(r.decodeMs)} on ${r.threads} thread${r.threads > 1 ? "s" : ""} (worker round trip ${ms(performance.now() - t1)})`;
  stats.Threads = crossOriginIsolated ? (r.threadsError ? `pool failed: ${r.threadsError}` : `${r.threads} (page isolated)`) : `1: ${isolation}`;
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
