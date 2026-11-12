// @ts-check
// The open photo's adjustments (docs/design/EDITOR.md): what the plate's dial reads and turns, Reset, Auto, the
// white balance presets and the eyedropper. The photo itself, its drawing and its saving are session.js's,
// which hands these on as its own (boards import session.js alone).
import { STILL, WB, ZERO, canvas, changed, cur, custom, draw, eng, save, say, shotWb, white } from './session.js';
import { photos } from './store.js';
import { curveRows, gradeRows, mixerRows } from '../../engine/grade.js';

/** An edit's adjustments as the engine's frame takes them (session.js draws with them; cube-out.js makes a table).
 * @param {Record<string, number>} v @param {import('../../engine/grade.js').Curves | null} curve */
export function dials(v, curve) {
  const h = (/** @type {string} */ k) => v[k] / 100;
  return { amount: (v.Amount ?? 100) / 100, highlights: h('Highlights'), shadows: h('Shadows'), whites: h('Whites'), blacks: h('Blacks'), saturation: h('Saturation'), vibrance: h('Vibrance'), texture: h('Texture'), clarity: h('Clarity'), dehaze: h('Dehaze'),
    sharpen: v.Sharpening / 40, radius: v.Radius, detail: h('Detail'), noise: h('Noise'), colorNoise: h('Color noise'), vignette: h('Vignette'), grain: h('Grain'), cube: v.Cube / 100, defringe: v.Defringe / 100, mixer: mixerRows(v), grade: gradeRows(v), curve: curveRows(curve) };
}

/** The controls that don't run −100..100: lowest, highest, step. The dial's whole window (−5..5) spans them. */
const SPAN = /** @type {Record<string, number[]>} */ ({ Sharpening: [0, 150, 1], Radius: [0.5, 3, 0.1], Detail: [0, 100, 1], Noise: [0, 100, 1], 'Color noise': [0, 100, 1], Grain: [0, 100, 1], Blending: [0, 100, 1], Defringe: [0, 100, 1], Amount: [0, 150, 1], Cube: [0, 150, 1] });
/** Whether a control runs from nothing upwards (the dial's window then fills from its left end). @param {string} name */
export const upward = (name) => !!SPAN[name] && SPAN[name][0] === 0;
/** @param {string} name */
export const value = (name) => cur?.values[name] ?? ZERO[name] ?? 0;
/** The value as the plate shows it. @param {string} name */
export function text(name) {
  const v = value(name), sign = (/** @type {number} */ x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  if (name === 'Exposure') return `${sign(v)}${Math.abs(v).toFixed(2)}`;
  if (name === 'Temp') return Math.round(v).toLocaleString('en-US');
  if (SPAN[name]) return name === 'Radius' ? v.toFixed(1) : String(Math.round(v));
  return `${sign(v)}${Math.abs(Math.round(v))}`;
}
/** The dial's position for a value (its window runs −5..5): the control's own now, or `v`. @param {string} name @param {number} [v] */
export function toDial(name, v = value(name)) {
  if (name === 'Exposure') return v;
  if (name === 'Temp') return cur ? Math.log2(v / cur.shotK) / 0.25 : 0;
  if (name === 'Tint') return (v - shotWb()[1]) / 30;
  if (SPAN[name]) return ((v - SPAN[name][0]) / (SPAN[name][1] - SPAN[name][0])) * 10 - 5;
  return v / 20;
}
/** The dial turned to `d`. @param {string} name @param {number} d */
export function turn(name, d) {
  if (!cur) return;
  const [lo, hi, step] = SPAN[name] || [0, 0, 0], spanned = Math.round((lo + ((Math.max(-5, Math.min(5, d)) + 5) / 10) * (hi - lo)) / (step || 1)) * (step || 1);
  const v = SPAN[name] ? +spanned.toFixed(1) : name === 'Exposure' ? Math.round(d * 100) / 100 : name === 'Temp' ? Math.round((cur.shotK * 2 ** (d * 0.25)) / 50) * 50 : name === 'Tint' ? shotWb()[1] + Math.round(d * 30) : Math.round(d * 20);
  if (cur.values[name] === v) return;
  cur.values[name] = v;
  if (name === 'Temp' || name === 'Tint') custom();
  changed(); draw(); save(name, name, text(name));
}
/** Several adjustments set at once, as one step of the history (a grading wheel's hue and saturation; a reset of
 * many). @param {Record<string, number>} patch @param {string} key what keeps moving, for the history @param {string} name @param {string} [val] */
export function setValues(patch, key, name, val = '') { if (!cur) return; Object.assign(cur.values, patch); changed(); draw(); save(key, name, val); }
/** Puts adjustments back where they start, as one step. @param {string[]} names @param {string} name */
export const resetAll = (names, name) => setValues(Object.fromEntries(names.map((n) => [n, start(n)])), '', name);
/** Where an adjustment starts for this photo. @param {string} name */
const start = (name) => (name === 'Temp' ? shotWb()[0] : name === 'Tint' ? shotWb()[1] : name === 'Noise' ? cur?.noise0 || 0 : cur?.start && name in cur.start ? cur.start[name] : cur?.plain && name in STILL ? STILL[name] : ZERO[name] ?? 0);
/** The dial's position where an adjustment starts for this photo (the dial ticks there: boards/DialPlate.js). @param {string} name */
export const startDial = (name) => toDial(name, start(name));
/** A photo's name without its ending. @param {string} name */
export const stem = (name) => name.replace(/\.(RAF|JPE?G)$/i, '');
/** How a shot was taken, in a line (23 mm · f/5.6 · 1/250 · ISO 160): what its Exif says, '' when it says nothing. @param {import('./store.js').Photo['shot']} s */
export function shotLine(s) {
  const t = s?.time || 0, speed = !t ? '' : t >= 0.4 ? `${+t.toFixed(1)} s` : `1/${Math.round(1 / t)}`;
  return [s?.mm ? `${Math.round(s.mm)} mm` : '', s?.f ? `f/${+s.f.toFixed(1)}` : '', speed, s?.iso ? `ISO ${s.iso}` : ''].filter(Boolean).join(' · ');
}
/** The line under the open photo's name: its film simulation (a JPEG: that it is one), then how it was shot, or
 * that it is a RAF when its Exif does not say. */
export function kindLine() {
  const how = shotLine(photos().find((p) => p.id === cur?.id)?.shot);
  return cur?.plain ? `JPEG${how ? ` · ${how}` : ''}` : `${cur?.shot.split(' · ')[0] || 'Fujifilm'} · ${how || 'RAF'}`;
}
/** Whether an adjustment has moved from where the photo started. @param {string} name */
export const edited = (name) => !!cur && cur.values[name] !== start(name);
/** @param {string} name */
export function reset(name) {
  if (!cur) return;
  cur.values[name] = start(name);
  if (name === 'Temp' || name === 'Tint') custom();
  changed(); draw(); save(name, name, text(name));
}
/** The curve's point the dial turns: the one last touched on the curve board. */
export const picked = { i: 1 };
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
/** Whether the eyedropper is armed: the next tap on the photo is its (zoom.js hears the tap). */
export const armed = () => picking;
/** The eyedropper: armed, the next tap on the photo makes what is under it neutral. Tapping its key again
 * puts it away. @param {boolean} [on] */
export function pickWhite(on = !picking) {
  if (!eng || !cur || on === picking) return;
  picking = on; canvas.style.cursor = on ? 'crosshair' : '';
  say(on ? 'Tap something white or grey' : '');
}
/** A tap on the photo, as shares of its width and height: with the eyedropper armed, what is under it turns neutral.
 * @param {number} u @param {number} v */
export function pickAt(u, v) {
  if (!picking || !eng || !cur) return;
  const w = eng.whiteAt(u, v);
  if (!w) { say('Too bright there: tap somewhere else'); return; }
  picking = false; canvas.style.cursor = ''; cur.status = '';
  cur.values.Temp = Math.round(Math.min(15000, Math.max(2000, w.kelvin)) / 50) * 50; cur.values.Tint = Math.round(w.tint);
  custom(); changed(); draw(); save('', 'White balance', 'Picked');
}
/** Another photo opens: the eyedropper is put away and Auto forgets what it replaced. */
export function forget() { picking = false; before = null; canvas.style.cursor = ''; }
/** The Temp a preset stands for, for the menu. @param {string} name */
export const wbKelvin = (name) => (WB[name] || shotWb())[0];
