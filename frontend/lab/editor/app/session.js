// @ts-check
// The photo open in the editor (docs/design/EDITOR.md, docs/engineering/ENGINE-RESEARCH.md): the camera's JPEG
// shows at once, the RAF decodes on a worker (/lab/engine/'s), the GPU develops it through the camera profile
// matching the shot's film simulation, and every adjustment the dial turns is saved to this phone as you go.
// Boards read values through `value`/`text`/`toDial` and listen for `change`.
import { engine, warm } from '../../engine/gpu.js';
import { full } from '../../engine/full.js';
import { catalogue, storedSet, unzip } from '../../engine/profiles.js';
import * as hist from './past.js';
import * as store from './store.js';

/** Each adjustment's starting value (display units: EV, K, or −100..100). */
const ZERO = /** @type {Record<string, number>} */ ({ Amount: 100, Exposure: 0, Contrast: 0, Highlights: 0, Shadows: 0, Whites: 0, Blacks: 0, Temp: 0, Tint: 0, Vibrance: 0, Saturation: 0,
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
// boards mark where the photo goes with data-keep="photo" (dc.js leaves its insides alone); a slot that is also
// data-zoom is filled by zoom.js, which puts itself here
export const hooks = { fill: /** @type {null | ((slot: HTMLElement, el: HTMLElement) => void)} */ (null) };
const fill = (/** @type {HTMLElement} */ s) => { const el = ready ? canvas : img; if (s.dataset.zoom !== undefined && hooks.fill) hooks.fill(s, el); else s.replaceChildren(el); };
document.addEventListener('dc:keep', (e) => { const s = /** @type {HTMLElement} */ (/** @type {CustomEvent} */ (e).detail); if (s.dataset.keep === 'photo') fill(s); });

let worker = /** @type {Worker | null} */ (null), eng = /** @type {null | Awaited<ReturnType<typeof engine>>} */ (null), ready = false;
/** @type {{ id: string, name: string, values: Record<string, number>, wb: string, profile: string, shotEv: number, shotK: number, shotTint: number, oldTint: boolean, status: string, shot: string, count: string } | null} */
let cur = null;
let list = /** @type {Awaited<ReturnType<typeof catalogue>>} */ ([]), saveT = 0, drawing = false, again = false, film = '';
// the sensor's own pixels, for 100 % and export (they follow the editing copy); the photo's history and versions;
// a count that moves whenever the fitted photo is drawn anew
let big = /** @type {Awaited<ReturnType<typeof full>>} */ (null), asked = 0, past = /** @type {hist.Past | null} */ (null), gen = 0;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
// the slow parts made once, while the Library is up: the GPU's pipelines and the profiles read from the zip
warm();
const sets = /** @type {Map<string, ReturnType<typeof catalogue>>} */ (new Map());
const profilesFor = (/** @type {string} */ model) => {
  if (!sets.has(model)) sets.set(model, storedSet().then(async (z) => (z ? catalogue(await unzip(z), model) : []), () => []));
  return /** @type {ReturnType<typeof catalogue>} */ (sets.get(model));
};
profilesFor('Fujifilm X-E5');

const place = () => { const s = /** @type {HTMLElement | null} */ (document.querySelector('[data-keep="photo"]')); if (s) fill(s); };
/** @param {string} status */
const say = (status) => { if (cur) { cur.status = status; changed(); } };

/** Opens a photo from the Library. @param {string} id */
export async function open(id) {
  const p = store.photos().find((x) => x.id === id);
  if (!p || cur?.id === id) return;
  const edit = (await store.loadEdit(id)) || {};
  cur = { id, name: p.name, values: { ...ZERO, ...Object.fromEntries(Object.entries(edit).filter(([k, v]) => k in ZERO && typeof v === 'number')) }, wb: String(edit.wb || 'As shot'), profile: String(edit.profile || ''), shotEv: BASELINE_EV, shotK: 5500, shotTint: 0, oldTint: edit.wb === 'Custom' && edit.v !== 2, status: 'Opening…', shot: '', count: `${store.photos().indexOf(p) + 1} / ${store.photos().length}` };
  ready = false; picking = false; before = null; canvas.style.cursor = ''; big?.dispose(); big = null; eng?.dispose(); eng = null; film = ''; gen++; past = hist.load(edit, { values: { ...ZERO }, wb: 'As shot', profile: '' }, state()); img.src = await store.jpegUrl(id); place(); changed();
  worker ??= new Worker(new URL('../../engine/decode-worker.js', import.meta.url), { type: 'module' });
  const buf = await store.raw(id), me = cur, tag = ++asked;
  let sensor = (/** @type {Uint16Array} */ m) => {};
  const mosaic = /** @type {Promise<Uint16Array>} */ (new Promise((res) => { sensor = res; }));
  const r = await new Promise((res) => {
    /** @type {Worker} */ (worker).onmessage = (m) => {
      if (m.data.tag !== tag) return;   // a photo left behind, still answering
      if (m.data.mosaic) { sensor(m.data.mosaic); return; }
      if (m.data.preview) { me.shotEv = BASELINE_EV + Math.log2((m.data.dr || 100) / 100); film = filmOf(m.data.settings); me.shot = m.data.settings || ''; changed(); return; }
      res(m.data);
    };
    /** @type {Worker} */ (worker).postMessage({ buf, full: true, tag }, [buf]);
  });
  if (cur !== me) return;
  if (r.error) { say(`Couldn't open it: ${r.error}`); return; }
  try {
    const [e, l] = await Promise.all([engine(canvas, r, new URLSearchParams(location.search).has('readback')), profilesFor(`${r.meta.make} ${r.meta.model}`)]);
    if (cur !== me) { e.dispose(); return; }
    eng = e; list = l;
    applyProfile();
    ready = true; place(); say(''); await draw();
    mosaic.then(async (m) => {
      const b = cur === me ? await full(e, r, m) : null;
      /** @type {any} */ (m.buffer).transfer?.(0);   // its 80 MB given back now: the GPU has its own copy
      if (cur === me) { big = b; changed(); } else b?.dispose();
    }).catch(() => {});
  } catch (err) { say(String(/** @type {any} */ (err)?.message || err)); }
}

/** The shot's film simulation as a profile label to look for, from the camera's settings line. @param {string} [s] */
const filmOf = (s) => (s || '').split(' · ')[0] || '';
/** The profile the camera's film simulation stands for (Adobe Color when none matches, else Adobe Standard). */
function asShot() {
  const want = film.toUpperCase();
  return list.find((e) => want && !e.table && e.label.toUpperCase().startsWith(want)) || list.find((e) => want && !e.table && e.label.toUpperCase().startsWith(want.split(' ')[0]))
    || list.find((e) => e.label === 'Adobe Color') || list.find((e) => /Adobe Standard/.test(e.label)) || null;
}
const chosen = () => list.find((e) => e.id === cur?.profile) || asShot();
/** The shot's own white as the plate shows it: Temp to 50 K, Tint whole. */
const shotWb = () => [Math.round((cur?.shotK || 5500) / 50) * 50, Math.round(cur?.shotTint || 0)];
function applyProfile(pick = chosen()) {
  if (!eng || !cur) return;
  eng.setProfile(pick);
  const w = eng.shotWhite(); cur.shotK = w.kelvin; cur.shotTint = w.tint;
  // edits saved before Tint became the photo's own number kept it as a distance from the shot's
  if (cur.oldTint) { cur.values.Tint += Math.round(w.tint); cur.oldTint = false; }
  if (cur.wb === 'As shot') [cur.values.Temp, cur.values.Tint] = shotWb();
  else if (WB[cur.wb]) [cur.values.Temp, cur.values.Tint] = /** @type {[number, number]} */ (WB[cur.wb]);
  white();
}
/** Temp and Tint are the photo's own (as Lightroom shows them); "As shot" is the camera's white exactly. */
function white() {
  if (eng && cur) eng.setWhite(cur.wb === 'As shot' ? null : { kelvin: cur.values.Temp, tint: cur.values.Tint });
}
/** After Temp or Tint moved by hand: back on the shot's own values is "As shot" again. */
function custom() {
  if (!cur) return;
  const [k, t] = shotWb();
  cur.wb = cur.values.Temp === k && cur.values.Tint === t ? 'As shot' : 'Custom'; white();
}

/** One render with the photo's values. @param {Parameters<NonNullable<typeof eng>['render']>[2]} [more] */
function paint(more) {
  const e = /** @type {NonNullable<typeof eng>} */ (eng), c = /** @type {NonNullable<typeof cur>} */ (cur), v = c.values, h = (/** @type {string} */ k) => v[k] / 100;
  return e.render(v.Exposure + c.shotEv, 2 ** (h('Contrast') * 0.6), { amount: (v.Amount ?? 100) / 100, highlights: h('Highlights'), shadows: h('Shadows'), whites: h('Whites'), blacks: h('Blacks'), saturation: h('Saturation'), vibrance: h('Vibrance'), ...more });
}
/** @param {boolean} [fit] false: only the 100 % view is drawn again, the fitted photo left as it is */
async function draw(fit = true) {
  if (!eng || !cur) return;
  if (drawing) { again = true; return; }
  drawing = true; if (fit) gen++;
  await paint({ fit });
  drawing = false;
  if (again) { again = false; draw(); }
}
/** Runs a job that needs the engine to itself, between the dial's frames. @param {() => Promise<void>} job */
export async function alone(job) {
  while (drawing) await sleep(30);
  drawing = true;
  try { await job(); } finally { drawing = false; }
  if (again) { again = false; await draw(); }
}
/** The photo as last rendered, `w` pixels wide (0: the editing copy's own size): a JPEG's URL. @param {number} w */
async function shrink(w) {
  const im = await /** @type {NonNullable<typeof eng>} */ (eng).snapshot(), bm = await createImageBitmap(im, w ? { resizeWidth: w, resizeHeight: Math.round((w * im.height) / im.width), resizeQuality: 'medium' } : {});
  const c = new OffscreenCanvas(bm.width, bm.height); /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(bm, 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: w ? 0.8 : 0.92 }));
}
/** The edit as it stands. @returns {hist.State} */
export const state = () => ({ values: { ...cur?.values }, wb: cur?.wb || 'As shot', profile: cur?.profile || '' });
const put = (/** @type {hist.State} */ st) => { if (cur) Object.assign(cur, { values: { ...ZERO, ...st.values }, wb: st.wb, profile: st.profile }); };
/** The photo developed off screen (tiles.js): as it is now, or as the edit `st` would have it. A JPEG's URL, `w`
 * pixels wide; '' if the photo closes first. @param {hist.State | null} st @param {number} w @param {Parameters<typeof paint>[0]} [more] */
export async function picture(st, w, more) {
  const me = cur; let url = '';
  await alone(async () => {
    if (cur !== me || !eng || !me) return;
    const was = state();
    try { if (st) { put(st); applyProfile(); } await paint({ screen: false, ...more }); url = await shrink(w); } finally { if (st) { put(was); applyProfile(); } }
  });
  return url;
}
/** The fitted photo's pixels as it is now (the histogram's); null if the photo closes first. */
export async function pixels() {
  const me = cur; let im = /** @type {ImageData | null} */ (null);
  await alone(async () => { if (cur === me && eng && me) { await paint({ screen: false }); im = await eng.snapshot(); } });
  return im;
}
/** Moves whenever the fitted photo is drawn anew or another photo opens: what was made from it is then old. */
export const stamp = () => gen;

/* 100 % (zoom.js): the sensor's pixels once they are on the GPU, and what the view needs of the photo. */
export const whole = () => big;
/** Brings the engine's colour table and tone mask back to the photo as it is on screen: a look's tile or the
 * 100 % view's map may have drawn it another way since. For work that draws without a frame of its own (export). */
export const settle = () => paint({ fit: false });
/** One band of an export's JPEG, encoded on the decoder's thread (the engine's files.js asks).
 * @param {Uint8Array} rgb @param {number} w @param {number} h @param {number} quality @param {boolean} fine @returns {Promise<Uint8Array>} */
export const jpegBand = (rgb, w, h, quality, fine) => new Promise((res, rej) => {
  const to = worker, tag = `j${++asked}`;
  if (!to) { rej(new Error('no decoder')); return; }
  const hear = (/** @type {MessageEvent} */ m) => { if (m.data.tag !== tag) return; to.removeEventListener('message', hear); if (m.data.jpeg) res(m.data.jpeg); else rej(new Error(m.data.error)); };
  to.addEventListener('message', hear); to.postMessage({ jpeg: [rgb, w, h, quality, fine], tag }, [rgb.buffer]);
});
/** The upright photo's size in sensor pixels. */
export const shape = () => (ready ? [canvas.width * 3, canvas.height * 3] : img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : [7728, 5152]);
/** Draws the 100 % view where it now looks. */
export async function frame() { while (drawing) await sleep(8); await draw(false); }
/** Saves the edit to this phone, shortly. Given a name, the change is first noted as a step of the photo's history
 * (past.js): `key` is the control, so one that keeps moving stays one step. @param {string} [key] @param {string} [name] @param {string} [val] */
function save(key, name, val) {
  clearTimeout(saveT);
  const me = cur, p = past;
  if (me && p && name !== undefined) hist.note(p, key || '', name, val || '', state());
  saveT = setTimeout(() => { if (me) store.saveEdit(me.id, { ...me.values, wb: me.wb, profile: me.profile, v: 2, ...(p ? hist.dump(p) : {}) }); }, 400);
}
/** The photo's history: each step's name and value, and the step it is at. */
export const history = () => ({ steps: past ? past.steps.map(({ name, val }) => ({ name, val })) : [], at: past ? past.at : 0 });
/** Back, or forward again, to a step: the edit as it stood then. @param {number} i */
export function goto(i) { if (!cur || !past?.steps[i]) return; past.at = i; put(past.steps[i].st); applyProfile(); changed(); draw(); save(); }
export const undo = () => { if (past && past.at > 0) goto(past.at - 1); };
/** The photo's versions: as imported, then the edits kept by name. `on` marks the one the edit now equals. */
export const versions = () => (past ? [{ name: 'Original', st: past.steps[0].st }, ...past.versions].map((v) => ({ ...v, on: hist.same(v.st, state()) })) : []);
/** Keeps the edit as it stands as a new version. */
export function keep() { if (!cur || !past) return; past.versions.push({ name: `Version ${past.versions.length + 1}`, st: state() }); changed(); save(); }
/** Puts a version on: a step of the history like any other. @param {number} i */
export function version(i) { const v = versions()[i]; if (!cur || !v) return; put(v.st); applyProfile(); changed(); draw(); save('', `Version · ${v.name}`, ''); }

/** The open photo's camera JPEG (for a tile still being drawn). */
export const jpeg = () => img.src;
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
  if (name === 'Tint') return (v - shotWb()[1]) / 30;
  return v / 20;
}
/** The dial turned to `d`. @param {string} name @param {number} d */
export function turn(name, d) {
  if (!cur) return;
  const v = name === 'Exposure' ? Math.round(d * 100) / 100 : name === 'Temp' ? Math.round((cur.shotK * 2 ** (d * 0.25)) / 50) * 50 : name === 'Tint' ? shotWb()[1] + Math.round(d * 30) : Math.round(d * 20);
  if (cur.values[name] === v) return;
  cur.values[name] = v;
  if (name === 'Temp' || name === 'Tint') custom();
  changed(); draw(); save(name, name, text(name));
}
/** Where an adjustment starts for this photo. @param {string} name */
const start = (name) => (name === 'Temp' ? shotWb()[0] : name === 'Tint' ? shotWb()[1] : ZERO[name] ?? 0);
/** Whether an adjustment has moved from where the photo started. @param {string} name */
export const edited = (name) => !!cur && cur.values[name] !== start(name);
/** @param {string} name */
export function reset(name) {
  if (!cur) return;
  cur.values[name] = start(name);
  if (name === 'Temp' || name === 'Tint') custom();
  changed(); draw(); save(name, name, text(name));
}
let before = /** @type {Record<string, number> | null} */ (null);
/** Auto for the Light controls, read from the photo (engine/auto.js). A second press, with none of them moved
 * since, puts back what was there. */
export function auto() {
  if (!eng || !cur) return;
  const v = cur.values, a = /** @type {Record<string, number>} */ (eng.auto(cur.shotEv)), names = Object.keys(a), on = !!before && names.every((k) => v[k] === a[k]);
  const was = Object.fromEntries(names.map((k) => [k, v[k]])), me = cur, note = on ? 'Auto off' : 'Auto: tap again to undo';
  Object.assign(v, on ? before : a); before = on ? null : was;
  say(note); setTimeout(() => { if (cur === me && me.status === note) say(''); }, 2500); draw(); save('', on ? 'Auto off' : 'Auto', '');
}
/** A white balance preset from the plate's menu. @param {string} name */
export function setWb(name) {
  if (!cur || !(name in WB)) return;
  pickWhite(false); cur.wb = name; [cur.values.Temp, cur.values.Tint] = WB[name] || shotWb();
  white(); changed(); draw(); save('wb', 'White balance', name);
}
let picking = false;
/** The eyedropper: armed, the next tap on the photo makes what is under it neutral. Tapping its key again
 * puts it away. @param {boolean} [on] */
export function pickWhite(on = !picking) {
  if (!eng || !cur || on === picking) return;
  picking = on; canvas.style.cursor = on ? 'crosshair' : '';
  say(on ? 'Tap something white or grey' : '');
}
canvas.addEventListener('click', (e) => {
  if (!picking || !eng || !cur) return;
  const w = eng.whiteAt(e.offsetX / canvas.clientWidth, e.offsetY / canvas.clientHeight);
  if (!w) { say('Too bright there: tap somewhere else'); return; }
  picking = false; canvas.style.cursor = ''; cur.status = '';
  cur.values.Temp = Math.round(Math.min(15000, Math.max(2000, w.kelvin)) / 50) * 50; cur.values.Tint = Math.round(w.tint);
  custom(); changed(); draw(); save('', 'White balance', 'Picked');
});
/** The Temp a preset stands for, for the menu. @param {string} name */
export const wbKelvin = (name) => (WB[name] || shotWb())[0];

/* Looks: the camera profiles on this phone, each drawn small from this photo for its tile. */
/** The looks for the open photo, with the one it was shot with first marked. */
export const looks = () => { const shot = asShot(); return list.map((e) => ({ id: e.id, label: e.label, table: !!e.table, mono: /ACROS|Monochrome|Sepia/i.test(e.label), asShot: e === shot })); };
/** The look in use. */
export const look = () => chosen()?.id || '';
/** @param {string} id */
export function pickLook(id) { if (!cur || !list.some((e) => e.id === id)) return; cur.profile = id; applyProfile(); changed(); draw(); save('look', `Look · ${chosen()?.label || ''}`, ''); }
/** The look's strength, 0..150 % (a look's RGB table; a profile alone is all or nothing). @param {number} pct */
export function setAmount(pct) { if (!cur) return; cur.values.Amount = Math.max(0, Math.min(150, Math.round(pct))); changed(); draw(); save('Amount', 'Look amount', `${cur.values.Amount}%`); }
/** Press and hold: the photo as shot, without the chosen look. @param {boolean} on */
export function hold(on) { if (!eng || !cur) return; applyProfile(on ? asShot() : chosen()); draw(); }
