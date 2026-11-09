// @ts-check
// The photo open in the editor (docs/design/EDITOR.md, docs/engineering/ENGINE-RESEARCH.md): the camera's JPEG
// shows at once, the RAF decodes on a worker (/lab/engine/'s), the GPU develops it through the camera profile
// matching the shot's film simulation, and every adjustment the dial turns is saved to this phone as you go.
// Boards read values through `value`/`text`/`toDial` and listen for `change`.
import { engine } from '../../engine/gpu.js';
import { catalogue, storedSet, unzip } from '../../engine/profiles.js';
import * as store from './store.js';

/** Each adjustment's starting value (display units: EV, K, or −100..100). */
const ZERO = /** @type {Record<string, number>} */ ({ Exposure: 0, Contrast: 0, Highlights: 0, Shadows: 0, Whites: 0, Blacks: 0, Temp: 0, Tint: 0, Vibrance: 0, Saturation: 0,
  Texture: 0, Clarity: 0, Dehaze: 0, Vignette: 0, Grain: 0, Sharpening: 40, Radius: 1, Detail: 25, Noise: 0, 'Color noise': 25, Distortion: 0, Vignetting: 0, Defringe: 0 });
/** What the GPU applies today; the rest are kept with the edit and wait for their stage. */
export const LIVE = new Set(['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Temp', 'Tint', 'Vibrance', 'Saturation']);
export const WB = /** @type {Record<string, [number, number] | null>} */ ({ 'As shot': null, Daylight: [5500, 10], Cloudy: [6500, 10], Shade: [7500, 10], Tungsten: [2850, 0], Fluorescent: [3800, 21], Flash: [5500, 0] });
const BASELINE_EV = 0.25;   // measured against the camera's JPEG (/lab/engine/'s colour check)

export const events = new EventTarget();
const changed = () => events.dispatchEvent(new Event('change'));
const canvas = document.createElement('canvas'), img = document.createElement('img');
canvas.setAttribute('aria-label', 'The photo being edited'); img.alt = 'The photo being edited';
for (const el of [canvas, img]) el.style.cssText = 'max-width: 100%; max-height: 100%; display: block';
img.src = '/lab/editor/assets/sample.jpg';
// boards mark where the photo goes with data-keep="photo" (dc.js leaves its insides alone)
document.addEventListener('dc:keep', (e) => { const slot = /** @type {HTMLElement} */ (/** @type {CustomEvent} */ (e).detail); if (slot.dataset.keep === 'photo') slot.replaceChildren(ready ? canvas : img); });

let worker = /** @type {Worker | null} */ (null), eng = /** @type {null | Awaited<ReturnType<typeof engine>>} */ (null), ready = false;
/** @type {{ id: string, name: string, values: Record<string, number>, wb: string, profile: string, shotEv: number, shotK: number, shotTint: number, status: string, shot: string, count: string } | null} */
let cur = null;
let list = /** @type {ReturnType<typeof catalogue>} */ ([]), saveT = 0, drawing = false, again = false;

const slot = () => document.querySelector('[data-keep="photo"]');
const place = () => slot()?.replaceChildren(ready ? canvas : img);
/** @param {string} status */
const say = (status) => { if (cur) { cur.status = status; changed(); } };

/** Opens a photo from the Library. @param {string} id */
export async function open(id) {
  const p = store.photos().find((x) => x.id === id);
  if (!p || cur?.id === id) return;
  const edit = (await store.loadEdit(id)) || {};
  cur = { id, name: p.name, values: { ...ZERO, ...Object.fromEntries(Object.entries(edit).filter(([, v]) => typeof v === 'number')) }, wb: String(edit.wb || 'As shot'), profile: String(edit.profile || ''), shotEv: BASELINE_EV, shotK: 5500, shotTint: 0, status: 'Opening…', shot: '', count: `${store.photos().indexOf(p) + 1} / ${store.photos().length}` };
  ready = false; eng = null; img.src = await store.jpegUrl(id); place(); changed();
  worker ??= new Worker(new URL('../../engine/decode-worker.js', import.meta.url), { type: 'module' });
  const buf = await store.raw(id), me = cur;
  const r = await new Promise((res) => {
    /** @type {Worker} */ (worker).onmessage = (m) => {
      if (m.data.preview) { me.shotEv = BASELINE_EV + Math.log2((m.data.dr || 100) / 100); if (!me.profile) me.profile = filmOf(m.data.settings); me.shot = m.data.settings || ''; changed(); return; }
      res(m.data);
    };
    /** @type {Worker} */ (worker).postMessage(buf, [buf]);
  });
  if (cur !== me) return;
  if (r.error) { say(`Couldn't open it: ${r.error}`); return; }
  try {
    eng = await engine(canvas, r, new URLSearchParams(location.search).has('readback'));
    const set = await storedSet();
    list = set ? catalogue(await unzip(set), `${r.meta.make} ${r.meta.model}`) : [];
    applyProfile();
    ready = true; place(); say(''); await draw();
  } catch (err) { say(String(/** @type {any} */ (err)?.message || err)); }
}

/** The shot's film simulation as a profile label to look for, from the camera's settings line. @param {string} [s] */
const filmOf = (s) => (s || '').split(' · ')[0] || '';
function applyProfile() {
  if (!eng || !cur) return;
  const want = cur.profile.toUpperCase(), pick = list.find((e) => e.id === cur?.profile) || list.find((e) => want && e.label.toUpperCase().startsWith(want))
    || list.find((e) => want && e.label.toUpperCase().startsWith(want.split(' ')[0])) || list.find((e) => /Adobe Standard/.test(e.label)) || null;
  eng.setProfile(pick);
  const w = eng.shotWhite(); cur.shotK = w.kelvin; cur.shotTint = w.tint;
  if (!cur.values.Temp) cur.values.Temp = Math.round(w.kelvin / 50) * 50;
  white();
}
function white() {
  if (!eng || !cur) return;
  const preset = WB[cur.wb], moved = cur.values.Temp !== Math.round(cur.shotK / 50) * 50 || cur.values.Tint !== 0;
  eng.setWhite(preset ? { kelvin: preset[0], tint: preset[1] } : moved ? { kelvin: cur.values.Temp, tint: cur.shotTint + cur.values.Tint } : null);
}

async function draw() {
  if (!eng || !cur) return;
  if (drawing) { again = true; return; }
  drawing = true;
  const v = cur.values, h = (/** @type {string} */ k) => v[k] / 100;
  await eng.render(v.Exposure + cur.shotEv, 2 ** (h('Contrast') * 0.6), { highlights: h('Highlights'), shadows: h('Shadows'), whites: h('Whites'), blacks: h('Blacks'), saturation: h('Saturation'), vibrance: h('Vibrance') });
  drawing = false;
  if (again) { again = false; draw(); }
}
function save() {
  clearTimeout(saveT);
  const me = cur;
  saveT = setTimeout(() => { if (me) store.saveEdit(me.id, { ...me.values, wb: me.wb, profile: me.profile }); }, 400);
}

/** Whether a photo is open. */
export const current = () => cur;
/** @param {string} name */
export const value = (name) => cur?.values[name] ?? ZERO[name] ?? 0;
/** The value as the plate shows it. @param {string} name */
export function text(name) {
  const v = value(name), sign = (/** @type {number} */ x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  if (name === 'Exposure') return `${sign(v)}${Math.abs(v).toFixed(2)}`;
  if (name === 'Temp') return Math.round(v).toLocaleString('en-US');
  if (name === 'Radius') return v.toFixed(1);
  return `${sign(v)}${Math.abs(Math.round(v))}`;
}
/** The dial's position for a value (its window runs −5..5). @param {string} name */
export function toDial(name) {
  const v = value(name);
  if (name === 'Exposure') return v;
  if (name === 'Temp') return cur ? Math.log2(v / cur.shotK) / 0.25 : 0;
  if (name === 'Tint') return v / 30;
  return v / 20;
}
/** The dial turned to `d`. @param {string} name @param {number} d */
export function turn(name, d) {
  if (!cur) return;
  const v = name === 'Exposure' ? Math.round(d * 100) / 100 : name === 'Temp' ? Math.round((cur.shotK * 2 ** (d * 0.25)) / 50) * 50 : name === 'Tint' ? Math.round(d * 30) : Math.round(d * 20);
  if (cur.values[name] === v) return;
  cur.values[name] = v;
  if (name === 'Temp' || name === 'Tint') { cur.wb = 'Custom'; white(); }
  changed(); draw(); save();
}
/** Whether an adjustment has moved from where the photo started. @param {string} name */
export const edited = (name) => !!cur && cur.values[name] !== (name === 'Temp' ? Math.round(cur.shotK / 50) * 50 : ZERO[name] ?? 0);
/** @param {string} name */
export function reset(name) {
  if (!cur) return;
  cur.values[name] = name === 'Temp' ? Math.round(cur.shotK / 50) * 50 : ZERO[name] ?? 0;
  if (name === 'Temp' || name === 'Tint') { cur.wb = 'As shot'; white(); }
  changed(); draw(); save();
}
/** A white balance preset from the plate's menu. @param {string} name */
export function setWb(name) {
  if (!cur || !(name in WB)) return;
  cur.wb = name; const p = WB[name];
  cur.values.Temp = p ? p[0] : Math.round(cur.shotK / 50) * 50; cur.values.Tint = 0;
  white(); changed(); draw(); save();
}
/** The Temp a preset stands for, for the menu. @param {string} name */
export const wbKelvin = (name) => (WB[name] ? /** @type {[number, number]} */ (WB[name])[0] : Math.round((cur?.shotK || 5500) / 50) * 50);
