// @ts-check
// The photo open in the editor (docs/design/EDITOR.md, docs/engineering/ENGINE-RESEARCH.md): the camera's JPEG
// shows at once, the RAF decodes on a worker (/lab/engine/'s), the GPU develops it through the camera profile
// matching the shot's film simulation, and every adjustment the dial turns is saved to this phone as you go.
// Boards read values through `value`/`text`/`toDial` and listen for `change`.
import { engine, warm } from '../../engine/gpu.js';
import { full } from '../../engine/full.js';
import { isNone } from '../../engine/crop.js';
import { tilt } from '../../engine/level.js';
import { START } from '../../engine/grade.js';
import { catalogue, storedSet, unzip } from '../../engine/profiles.js';
import { pref, prefOn } from '/th/pref.js';
import { auto, dials, forget } from './adjust.js';
import { opening } from './shown.js';
import * as hist from './past.js';
import * as kept from './looks.js';
import * as store from './store.js';
import { begin } from './starts.js';
import { ask } from './decoder.js';
import { firstPicture, keepView, note, onScreen, tap } from './kept-view.js';

/** Each adjustment's starting value (display units: EV, K, or −100..100). */
export const ZERO = /** @type {Record<string, number>} */ ({ Amount: 100, Cube: 100, Exposure: 0, Contrast: 0, Highlights: 0, Shadows: 0, Whites: 0, Blacks: 0, Temp: 0, Tint: 0, Vibrance: 0, Saturation: 0, Texture: 0, Clarity: 0, Dehaze: 0, Vignette: 0, Grain: 0, 'Grain size': 25, Sharpening: 40, Radius: 1, Detail: 25, Noise: 0, 'Color noise': 25, Distortion: 0, Vignetting: 0, Defringe: 0, ...START });
/** What the GPU applies today; the rest are kept with the edit and wait for their stage. */
export const LIVE = new Set(['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Temp', 'Tint', 'Vibrance', 'Saturation', 'Distortion', 'Vignetting', 'Texture', 'Clarity', 'Dehaze', 'Sharpening', 'Radius', 'Detail', 'Noise', 'Color noise', 'Vignette', 'Grain', 'Grain size', 'Defringe', ...Object.keys(START)]);
export const WB = /** @type {Record<string, [number, number] | null>} */ ({ 'As shot': null, Auto: null, Daylight: [5500, 10], Cloudy: [6500, 10], Shade: [7500, 10], Tungsten: [2850, 0], Fluorescent: [3800, 21], Flash: [5500, 0] });
const BASELINE_EV = 0.25;   // measured against the camera's JPEG (/lab/engine/'s colour check)
/** Where a JPEG starts that a RAF does not: the camera sharpened it and cleaned its colour already. */
export const STILL = /** @type {Record<string, number>} */ ({ Sharpening: 0, 'Color noise': 0 });

export const events = new EventTarget();
export const changed = () => events.dispatchEvent(new Event('change'));
export const canvas = document.createElement('canvas'), img = document.createElement('img');
canvas.setAttribute('aria-label', 'The photo being edited'); img.alt = 'The photo being edited';
for (const el of [canvas, img]) el.style.cssText = 'max-width: 100%; max-height: 100%; display: block';
// boards mark where the photo goes with data-keep="photo" (dc.js leaves its insides alone); a slot that is also
// data-zoom is filled by zoom.js, which puts itself here
export const hooks = { fill: /** @type {null | ((slot: HTMLElement, el: HTMLElement) => void)} */ (null), away: /** @type {null | (() => void)} */ (null) };
const fill = (/** @type {HTMLElement} */ s) => {
  const el = ready ? canvas : img, b = s.dataset.base !== undefined, mk = s.dataset.masks !== undefined;
  if (s.dataset.zoom !== undefined && hooks.fill) hooks.fill(s, el); else { hooks.away?.(); s.replaceChildren(el); }
  if (b !== base || mk !== masking) { base = b; masking = mk; if (ready) draw(); }   // the Crop board's slot (data-base) shows the picture before its crop; the Masks board's (data-masks) may show a mask in red
};
document.addEventListener('dc:keep', (e) => { const s = /** @type {HTMLElement} */ (/** @type {CustomEvent} */ (e).detail); if (s.dataset.keep === 'photo') fill(s); });

export let eng = /** @type {null | Awaited<ReturnType<typeof engine>>} */ (null), ready = false;
/** @type {{ id: string, name: string, values: Record<string, number>, wb: string, profile: string, geo: import('../../engine/crop.js').Crop | null, curve: import('../../engine/grade.js').Curves | null, cube: string, masks: import('../../engine/local.js').Mask[], spots: import('../../engine/heal.js').Spot[], plain: boolean, start?: Record<string, number>, noise0?: number, shotEv: number, shotK: number, shotTint: number, oldTint: boolean, status: string, shot: string, count: string } | null} */
export let cur = null;
/** How long the open photo's last waits were, in seconds (0: not yet): to open, for 100 % to turn sharp, to save. The boards say them, so the phone's own speed can be read off the screen. */
export const took = { open: 0, detail: 0, save: 0 };
export const view = { mask: -1 };   // the mask laid over the picture in red while the Masks board is up (masks.js)
let masking = false;
let bent = '', base = false, whole0 = [7728, 5152];   // what the engine's geometry was last made with; whether the picture shows uncropped (the Crop board); its uncropped size
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
export const say = (status) => { if (cur) { cur.status = status; changed(); } };

/** Where Noise starts for a photo shot at an ISO: nothing up to 400, then 20 more for each doubling, to 40 from 1600 up. @param {number} iso */
export const noiseStart = (iso) => Math.max(0, Math.min(40, Math.round(20 * Math.log2((iso || 100) / 400))));
/** Opens a photo from the Library. @param {string} id @param {boolean} [quick] without its full-size pixels (work that only passes through: clip.js)
 * @param {boolean} [again] the photo that is open already, anew (its GPU device was lost) */
export async function open(id, quick = false, again = false) {
  const p = store.photos().find((x) => x.id === id);
  if (!p || (cur?.id === id && !again)) return;
  Object.assign(opening, { id, name: p.name }); tap(); changed();   // the boards name it at once (shown.js)
  const turn = ++asked; while (drawing) await sleep(8);   // a frame of the photo before may be in flight (its tile, a dial's last turn): its engine is not taken from under it
  if (turn !== asked || (cur?.id === id && !again)) return;
  const began = performance.now(); took.open = took.detail = took.save = 0; again = false;
  const [saved, url] = await firstPicture(id), edit = saved || {}, plain = p.kind === 'jpeg', zero = { ...ZERO, ...(plain ? STILL : {}) };   // a JPEG: a picture already (engine/picture.js)
  if (turn !== asked) return; cur = { id, name: p.name, plain, values: { ...zero, ...Object.fromEntries(Object.entries(edit).filter(([k, v]) => k in ZERO && typeof v === 'number')) }, wb: String(edit.wb || 'As shot'), profile: String(edit.profile || ''), geo: edit.geo && typeof edit.geo === 'object' ? /** @type {any} */ (edit.geo) : null, curve: edit.curve && typeof edit.curve === 'object' ? /** @type {any} */ (edit.curve) : null, cube: typeof edit.cube === 'string' ? edit.cube : '', masks: Array.isArray(edit.masks) ? /** @type {any} */ (edit.masks) : [], spots: Array.isArray(edit.spots) ? /** @type {any} */ (edit.spots) : [], shotEv: plain ? 0 : BASELINE_EV, shotK: 5500, shotTint: 0, oldTint: edit.wb === 'Custom' && edit.v !== 2, status: 'Opening…', shot: '', count: `${store.photos().indexOf(p) + 1} / ${store.photos().length}` };
  ready = false; bent = ''; forget(); big?.dispose(); big = null; eng?.dispose(); eng = null; film = ''; gen++; past = hist.load(edit, { values: zero, wb: 'As shot', profile: '' }, state(), plain ? 'JPEG' : 'RAF'); img.src = url; opening.id = ''; place(); onScreen(); changed();
  const me = cur, stack = p.kind === 'stack', buf = plain || stack ? null : await store.raw(id);   // a stack: frames averaged into one (stack.js), kept as sensor data
  let sensor = (/** @type {Uint16Array | ImageBitmap} */ m) => {};
  const mosaic = /** @type {Promise<Uint16Array | ImageBitmap>} */ (new Promise((res) => { sensor = res; }));
  const file = buf ? null : await store.rawFile(id);
  const r = await new Promise((res) => ask(buf ? { buf, full: !quick } : plain ? { picture: file } : { stack: file, full: !quick }, buf ? [buf] : [], (d) => {
    if (cur !== me) { d.picture?.close(); return true; }   // a photo left behind, still answering
    if (d.mosaic) { sensor(d.mosaic); return true; }
    if (d.preview) { me.shotEv = BASELINE_EV + Math.log2((d.dr || 100) / 100); film = filmOf(d.settings); me.shot = d.settings || ''; changed(); return false; }
    res(d);
    return !!d.error || plain || quick || d.meta.cfaWidth !== 6;   // else the sensor's own pixels follow
  }));
  const heard = performance.now(); if (cur !== me) { r.picture?.close(); return; }
  if (r.picture) { if (quick) r.picture.close(); else sensor(r.picture); }
  if (r.error) { say(`Couldn't open it: ${r.error}`); return; }
  try {
    const [e, l] = await Promise.all([engine(canvas, r, new URLSearchParams(location.search).has('readback')), plain ? [] : profilesFor(`${r.meta.make} ${r.meta.model}`), kept.ready]);
    if (cur !== me) { e.dispose(); return; }
    // A photo not opened before starts with the noise reduction its ISO wants (measured: it helps at every ISO, most at the highest); one opened before keeps the start it was given then.
    me.noise0 = typeof edit.noise0 === 'number' ? edit.noise0 : typeof edit.Noise === 'number' || !prefOn('photos.new_noise', true) ? 0 : noiseStart(r.meta.iso || 0);
    if (typeof edit.Noise !== 'number') { me.values.Noise = me.noise0; if (past) for (const st of past.steps) st.st.values.Noise = me.noise0; }
    eng = e; list = l; whole0 = /Rotate(90|270)/.test(r.meta.orientation) ? [r.meta.fullHeight, r.meta.fullWidth] : [r.meta.fullWidth, r.meta.fullHeight];
    // The owner's settings for a photo not opened before (Settings › Photos › Editor): the look it opens in, and Auto.
    const fresh = !Object.keys(edit).length, color = fresh && pref('photos.new_profile') === 'adobe-color' ? l.find((x) => x.label === 'Adobe Color') : null;
    if (color) { me.profile = color.id; if (past) for (const st of past.steps) st.st.profile = color.id; }
    begin(me, past, fresh ? p.shot || {} : null, edit);   // the start kept for its camera and lens (starts.js)
    r.meta.quick = pref('photos.demosaic') === 'faster'; r.meta.net = prefOn('photos.neural', true);   // Full-size detail: Faster (engine/demosaic.js)
    applyProfile();
    await draw(); if (cur === me) { ready = true; place(); say(''); took.open = (performance.now() - began) / 1000; note('open', took.open * 1000, { file: p.kind || 'raf', quick, heard: Math.round(heard - began), decode: Math.round(r.decodeMs || 0), threads: r.threads || 0, ...(r.boot || {}), px: whole0[0] * whole0[1] }); }
    if (cur === me && fresh && prefOn('photos.new_auto', false)) auto();
    mosaic.then(async (m) => {
      const b = cur === me ? await full(e, r, m) : null;
      if (m instanceof Uint16Array) /** @type {any} */ (m.buffer).transfer?.(0); else m.close();   // its 80 MB given back now: the GPU has its own copy
      if (cur === me) { big = b; changed(); if (b) note('full', performance.now() - began); } else b?.dispose();
    }).catch((err) => { console.warn('full size', err); if (cur === me) say('The full-size photo could not be made, so 100 % and export are not there. Open the photo again.'); });
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
export const shotWb = () => [Math.round((cur?.shotK || 5500) / 50) * 50, Math.round(cur?.shotTint || 0)];
function applyProfile(pick = chosen(), bare = false) {
  if (!eng || !cur) return;
  eng.setProfile({ .../** @type {any} */ (pick || {}), cube: bare ? null : kept.get(cur.cube)?.cube || null });   // the profile, and a .cube look on top
  const w = eng.shotWhite(); cur.shotK = w.kelvin; cur.shotTint = w.tint;
  // edits saved before Tint became the photo's own number kept it as a distance from the shot's
  if (cur.oldTint) { cur.values.Tint += Math.round(w.tint); cur.oldTint = false; }
  if (cur.wb === 'As shot') [cur.values.Temp, cur.values.Tint] = shotWb();
  else if (WB[cur.wb]) [cur.values.Temp, cur.values.Tint] = /** @type {[number, number]} */ (WB[cur.wb]);
  white();
}
/** Temp and Tint are the photo's own (as Lightroom shows them); "As shot" is the camera's white exactly. */
export function white() {
  if (eng && cur) eng.setWhite(cur.wb === 'As shot' ? null : { kelvin: cur.values.Temp, tint: cur.values.Tint });
}
/** After Temp or Tint moved by hand: back on the shot's own values is "As shot" again. */
export function custom() {
  if (!cur) return;
  const [k, t] = shotWb();
  cur.wb = cur.values.Temp === k && cur.values.Tint === t ? 'As shot' : 'Custom'; white();
}

/** One render with the photo's values. @param {Parameters<NonNullable<typeof eng>['render']>[2]} [more] */
function paint(more) {
  const e = /** @type {NonNullable<typeof eng>} */ (eng), c = /** @type {NonNullable<typeof cur>} */ (cur), v = c.values, h = (/** @type {string} */ k) => v[k] / 100;
  const crop = base ? null : c.geo, key = `${v.Distortion},${v.Vignetting},${JSON.stringify(crop)},${JSON.stringify(c.spots)}`;
  if (bent !== key) { bent = key; e.setGeometry({ distortion: h('Distortion'), vignetting: h('Vignetting'), crop, spots: c.spots }); }   // Optics by hand, or the crop: the picture is laid out again
  return e.render(v.Exposure + c.shotEv, 2 ** (h('Contrast') * 0.6), { ...dials(v, c.curve), masks: c.masks, baseEv: c.shotEv, showMaskNo: masking && more?.screen !== false ? view.mask : -1, ...more });
}
/** @param {boolean} [fit] false: only the 100 % view is drawn again, the fitted photo left as it is */
export async function draw(fit = true) {
  if (!eng || !cur) return;
  if (drawing) { again = true; return; }
  drawing = true; if (fit) gen++;
  const was = `${canvas.width},${canvas.height}`;
  try { await paint({ fit }); } finally { drawing = false; }   // a frame that fails must not hold every later one
  if (was !== `${canvas.width},${canvas.height}`) { place(); changed(); }   // a crop changed the picture's size: its slot lays it out again
  if (again) { again = false; draw(); }
}
/** Whether a frame is being drawn or waiting to be (check scripts wait on this, not on a clock). */
export const busy = () => drawing || again;
/** Runs a job that needs the engine to itself, between the dial's frames. @param {() => Promise<void>} job */
export async function alone(job) {
  while (drawing) await sleep(30);
  drawing = true;
  try { await job(); } finally { drawing = false; }
  if (again) { again = false; await draw(); }
}
/** The photo as last rendered, `w` pixels wide (0: the editing copy's own size), as a JPEG; `also` is handed the frame whole. @param {number} w @param {(im: ImageData) => void} [also] */
async function small(w, also) {
  const im = await /** @type {NonNullable<typeof eng>} */ (eng).snapshot(), bm = await createImageBitmap(im, w ? { resizeWidth: w, resizeHeight: Math.round((w * im.height) / im.width), resizeQuality: 'medium' } : {}); also?.(im);
  const c = new OffscreenCanvas(bm.width, bm.height); /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(bm, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: w ? 0.8 : 0.92 });
}
/** The edit as it stands. @returns {hist.State} */
export const state = () => hist.copy({ values: cur?.values || {}, wb: cur?.wb || 'As shot', profile: cur?.profile || '', geo: cur?.geo, curve: cur?.curve, cube: cur?.cube, masks: cur?.masks, spots: cur?.spots });
const put = (/** @type {hist.State} */ st) => { if (cur) Object.assign(cur, { values: { ...ZERO, ...st.values }, wb: st.wb, profile: st.profile, geo: st.geo || null, curve: st.curve || null, cube: st.cube || '', masks: st.masks || [], spots: st.spots || [] }); };
/** The photo developed off screen (tiles.js): as it is now, or as the edit `st` would have it. A JPEG's URL, `w`
 * pixels wide; '' if the photo closes first. @param {hist.State | null} st @param {number} w @param {Parameters<typeof paint>[0]} [more] */
export async function picture(st, w, more) {
  const me = cur; let url = '';
  await alone(async () => { if (cur === me && eng && me) { await unseen(st, more); url = URL.createObjectURL(await small(w)); } });
  return url;
}
/** One frame off screen, of the edit `st` (null: the photo's own), always as cropped whatever board is up. The frame is
 * sent to the GPU and the photo's own edit put back in the same breath, before anything else can run: a tap that
 * lands while a tile is being drawn must find the photo's edit, not the tile's. @param {hist.State | null} st @param {Parameters<typeof paint>[0]} [more] */
function unseen(st, more) {
  const was = state(), shown = base;
  base = false;
  try { if (st) { put(st); applyProfile(); } return paint({ screen: false, ...more }); } finally { base = shown; if (st) { put(was); applyProfile(); } }
}
/** The fitted photo's pixels as it is now (the histogram's); null if the photo closes first. */
export async function pixels() {
  const me = cur; let im = /** @type {ImageData | null} */ (null);
  await alone(async () => { if (cur === me && eng && me) { await unseen(null); im = await eng.snapshot(); } });
  return im;
}
/** The crop (engine/crop.js; null for none), and the upright picture's size before it. */
export const geo = () => cur?.geo || null;
export const uncropped = () => (ready ? whole0 : shape());
/** Sets the crop, a step of the history (`val` says what changed). While the Crop board is up the picture stays uncropped under its frame. @param {import('../../engine/crop.js').Crop} g @param {string} [val] */
export function setGeo(g, val = '') { if (!cur) return; cur.geo = isNone(g) ? null : g; changed(); if (!base) draw(); save('crop', 'Crop', val); }
/** The point curve (engine/grade.js): each channel's points, or null while all are straight. */
export const curve = () => cur?.curve || null;
/** Sets one channel's points (RGB, R, G or B); none, with no channel, straightens them all. @param {string} [ch] @param {number[][]} [pts] */
export function setCurve(ch, pts) { if (!cur) return; cur.curve = ch && pts ? { ...cur.curve, [ch]: pts } : null; changed(); draw(); save('curve', ch ? `Curve · ${ch}` : 'Curve reset', ''); }
/** How far the picture's lines lean, in degrees clockwise (engine/level.js), read from it as it is shown. */
export async function level() { const im = await pixels(); return im ? tilt(im) : 0; }
/** Moves whenever the fitted photo is drawn anew or another photo opens: what was made from it is then old. */
export const stamp = () => gen;

/* 100 % (zoom.js): the sensor's pixels once they are on the GPU, and what the view needs of the photo. */
export const whole = () => big;
/** Brings the engine's colour table and tone mask back to the photo as it is on screen: a look's tile or the
 * 100 % view's map may have drawn it another way since. For work that draws without a frame of its own (export). */
export const settle = () => paint({ fit: false });
export { jpegBand } from './decoder.js';
/** The upright photo's size in sensor pixels. */
export const shape = () => (ready ? [canvas.width * 3, canvas.height * 3] : img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : [7728, 5152]);
/** Draws the 100 % view where it now looks. */
export async function frame() { while (drawing) await sleep(8); await draw(false); }
/** Saves the edit to this phone, shortly. Given a name, the change is first noted as a step of the photo's history
 * (past.js): `key` is the control, so one that keeps moving stays one step. @param {string} [key] @param {string} [name] @param {string} [val] */
export function save(key, name, val) {
  clearTimeout(saveT);
  const me = cur, p = past;
  if (me && p && name !== undefined) hist.note(p, key || '', name, val || '', state());
  clearTimeout(tileT); tileT = setTimeout(() => { keepTile(me)?.catch?.((err) => console.warn('tile not kept', err)); }, 1500);
  saveT = setTimeout(() => { if (me) store.saveEdit(me.id, record(me, p)).catch((err) => unsaved(me, err)); }, 400);
}
/** An edit the phone would not keep (its storage full, most often): said on the photo, since nothing else would show it. */
const unsaved = (/** @type {NonNullable<typeof cur>} */ me, /** @type {unknown} */ err) => { console.warn('edit not saved', err); if (cur === me) say('This edit could not be saved on this phone. Free some space, then change something to try again.'); };
const record = (/** @type {NonNullable<typeof cur>} */ me, /** @type {hist.Past | null} */ p) => ({ ...me.values, noise0: me.noise0 || 0, ...(me.start ? { start0: me.start } : {}), wb: me.wb, profile: me.profile, geo: me.geo, curve: me.curve, cube: me.cube, masks: me.masks, spots: me.spots, v: 2, ...(p ? hist.dump(p) : {}) });
/** Saves now what `save` would shortly, the tile too: for work that goes straight on to another photo (clip.js). */
export async function saveNow() { const me = cur; clearTimeout(saveT); clearTimeout(tileT); if (me) { await store.saveEdit(me.id, record(me, past)); await keepTile(me); } }
let tileT = 0;
/** The photo's Library tile follows its edit: a small picture of it as it now looks, or none once it is back as imported; the picture kept to show while it opens again (kept-view.js) is made from the same frame. */
async function keepTile(/** @type {typeof cur} */ me) {
  if (!me || cur !== me || !past) return;
  let blob = /** @type {Blob | null} */ (null);
  if (!hist.same(state(), past.steps[0].st)) await alone(async () => { if (cur === me && eng) { const rec = record(me, past); await unseen(null); blob = await small(480, (im) => keepView(me.id, rec, im)); } });   // the edit read before its frame is drawn: a change in between leaves a mark that matches no saved edit
  if (cur === me) { await store.saveTile(me.id, blob); changed(); }
}
/** Closes the open photo (it was deleted). */
export function shut() { big?.dispose(); big = null; eng?.dispose(); eng = null; cur = null; past = null; ready = false; opening.id = ''; img.removeAttribute('src'); place(); changed(); }
// The graphics chip was reset under the photo (the phone took it back, or its driver fell over): the picture would stay frozen with no word, so the edit is kept and the photo opened again on a new device.
addEventListener('th-gpu-lost', () => { const me = cur; if (!me) return; store.saveEdit(me.id, record(me, past)).catch(() => {}).finally(() => open(me.id, false, true)); });
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

/** The open photo's camera JPEG (for a tile still being drawn); and the open photo, if one is. */
export const jpeg = () => img.src, current = () => cur;
export * from './adjust.js';

/* Looks: the camera profiles on this phone, each drawn small from this photo for its tile. */
/** The looks for the open photo, with the one it was shot with first marked. */
export const looks = () => { const shot = asShot(); return list.map((e) => ({ id: e.id, label: e.label, table: !!e.table, mono: /ACROS|Monochrome|Sepia/i.test(e.label), asShot: e === shot })); };
/** @param {string} id */
export function pickLook(id) { if (!cur || !list.some((e) => e.id === id)) return; cur.profile = id; applyProfile(); changed(); draw(); save('look', `Look · ${chosen()?.label || ''}`, ''); }
/** A look's strength, 0..150 %: the profile's RGB table (a profile alone is all or nothing), or as `Cube` the .cube look's. @param {number} pct @param {string} [name] */
export function setAmount(pct, name = 'Amount') { if (!cur) return; cur.values[name] = Math.max(0, Math.min(150, Math.round(pct))); changed(); draw(); save(name, 'Look amount', `${cur.values[name]}%`); }
/** The look in use; and the `.cube` look on the photo (looks.js), '' for none. */
export const look = () => chosen()?.id || '', cubeOn = () => cur?.cube || '';
/** Puts a `.cube` look on; the one that is on comes off. @param {string} id */
export function pickCube(id) { if (!cur) return; cur.cube = cur.cube === id ? '' : id; applyProfile(); changed(); draw(); save('look', cur.cube ? `Look · ${kept.get(id)?.name || ''}` : 'Look off', ''); }
/** The edit as it would be wearing a saved look: everything the look holds but what is the photo's own (its exposure,
 * white balance, lens corrections and crop). @param {hist.State} st @returns {hist.State} */
export function worn(st) { const now = state(), v = { ...st.values }; for (const k of ['Exposure', 'Temp', 'Tint', 'Distortion', 'Vignetting']) delete v[k]; return { ...now, values: { ...now.values, ...v }, profile: st.profile ?? now.profile, curve: st.curve || null, cube: st.cube || '' }; }   // a look with no profile of its own (a preset brought in: xmp.js) keeps the photo's
/** Puts a whole edit on, a step of the history. @param {hist.State} st @param {string} name the step's */
export function lay(st, name) { if (!cur) return; put(st); applyProfile(); changed(); draw(); save('', name, ''); }
/** Puts a saved look on. @param {hist.State} st @param {string} name */
export const wear = (st, name) => lay(worn(st), `Look · ${name}`);
/** Press and hold: the photo as shot, without the chosen look. @param {boolean} on */
export function hold(on) { if (!eng || !cur) return; applyProfile(on ? asShot() : chosen(), on); draw(); }
