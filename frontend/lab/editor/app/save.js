// @ts-check
// Export from the editor (docs/design/EDITOR.md): the open photo, as edited, developed from the sensor's own
// pixels and saved to the phone's Downloads: one file for each preset that is on, all from one development.
import { OUTPUT, develop } from '../../engine/export.js';
import { block, carry, taken } from '../../engine/exif.js';
import * as files from '../../engine/files.js';
import * as photo from './session.js';
import { note } from './timings.js';
import * as store from './store.js';
import { prefOn } from '/th/pref.js';

/** @typedef {{ fmt: string, long: number, q: number, meta: 'All' | 'Copyright only' | 'None', gps: boolean, file: string, sharpen?: string, amt?: string }} Preset
 * `sharpen`: output sharpening for Screen or Print (anything else: none), `amt` how much (Low, Standard, High) */

const base = { fmt: 'JPEG', space: 'sRGB', sharpen: 'Off', amt: 'Standard', mark: false, meta: 'All', gps: false, naming: 'Camera name' }, KEPT = 'th.editor.export.presets';
/** The two files an export saves as the Export board first has them: the whole photo, and a small one for a screen. */
export const START = [{ ...base, name: 'Full', on: true, size: 'Full', long: 7728, q: 95 }, { ...base, name: 'Small', on: true, size: '2048', long: 2048, q: 85, sharpen: 'Screen', mark: true }];
/** The export's two files as the owner last set them on this phone (the Export board keeps them here), or as they start. */
export function presets() {
  try { const p = JSON.parse(localStorage.getItem(KEPT) || 'null'); if (Array.isArray(p) && p.length === 2 && p.every((x) => x && typeof x.fmt === 'string' && x.long > 0 && x.q > 0)) return p.map((x, i) => ({ ...START[i], ...x })); } catch { /* nothing kept */ }
  return START.map((x) => ({ ...x }));
}
/** @param {typeof START} list */
export function keepPresets(list) { try { localStorage.setItem(KEPT, JSON.stringify(list)); } catch { /* a private window */ } }
/** What to save of a photo for the files that are on: each at its size (no larger than the photo), under its name.
 * @param {typeof START} list @param {string} name the photo's file name @param {number[]} shape its size @param {string} date the day it was taken, '' if unknown @returns {Preset[]} */
export function jobs(list, name, shape, date) {
  const full = Math.max(shape[0], shape[1]), stem0 = name.replace(/\.\w+$/, '');
  return list.filter((x) => x.on).map((x) => {
    const stem = x.naming === 'Date + number' ? `${date || 'photo'}_${(stem0.match(/\d+$/) || [stem0])[0]}` : stem0;
    return { fmt: x.fmt, long: x.size === 'Full' ? full : Math.min(full, x.long), q: x.q, meta: /** @type {Preset['meta']} */ (x.meta), gps: x.gps, sharpen: x.sharpen, amt: x.amt, file: `${stem}${x.name === 'Small' ? '_small' : ''}.${x.fmt === 'JPEG' ? 'jpg' : x.fmt === 'PNG' ? 'png' : 'tif'}` };
  });
}

/** The day the open photo was taken (2026-11-09), for file names; '' when its Exif doesn't say. */
export async function day() { const p = photo.current(); return p ? taken(await store.jpegHead(p.id)) : ''; }

/** @param {Blob} blob @param {string} name */
function download(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

const MARK = 'th.editor.export';
const NET = 'th.editor.net';   // when the network last failed an export on this phone
/** Whether an export is made by the network (engine/neural.js). */
const netOn = () => { try { return prefOn('photos.neural', true) && Date.now() - Number(localStorage.getItem(NET) || 0) > 7 * 864e5; } catch { return false; } };
/** Where an export's time went (engine/export.js `develop`), as whole numbers for the timings: developing, reading
 * back, writing, and each step of the first pieces in ms a megapixel. @param {Record<string, any>} c */
const spent = (c) => ({ gpu: Math.round(c.gpu || 0), read: Math.round(c.read || 0), write: Math.round(c.write || 0), net: c.net || 0, fell: c.fell || 0,
  ...Object.fromEntries(Object.entries(c.split || {}).map(([k, v]) => [k, Math.round(Number(v) / Math.max(1, c.splitPx || 1) * 1e6)])) });
/** An export the page did not live to finish (it was closed, or the phone took the tab back): the photo's id and
 * name, once, if that photo is still here. A finished or refused export leaves no mark. */   // (`net`: the network was making it)
export function cutOff() {
  try {
    const m = JSON.parse(localStorage.getItem(MARK) || 'null');
    localStorage.removeItem(MARK);
    // cut off while the network was making it (the phone may have taken the tab back for the work it is): the
    // network is left alone here for a week, so the next export is made the usual way, and the timings say so
    if (m?.net) { localStorage.setItem(NET, String(Date.now())); note('save', 0, { net: 1, fell: 2 }); }
    return m && store.photos().some((p) => p.id === m.id) ? /** @type {{ id: string, name: string }} */ (m) : null;
  } catch { return null; }
}

/** Saves the open photo for each preset: developed once, each file taking its own size from it. `progress` hears how
 * far along it is (0 to 1). @param {Preset[]} presets @param {(done: number) => void} progress */
export async function save(presets, progress) {
  const p = photo.current(), big = photo.whole();
  if (!p || !big) throw new Error('The full-size photo is still loading. Try again in a moment.');
  const began = performance.now(), clock = /** @type {Record<string, any>} */ ({}), head = await store.jpegHead(p.id), saved = /** @type {{ file: string, width: number, height: number, bytes: number, blob: Blob }[]} */ ([]);
  const best = netOn();
  try { localStorage.setItem(MARK, JSON.stringify({ id: p.id, name: p.name, net: best })); } catch { /* a private window */ }
  try { await photo.alone(async () => {   // the engine to itself: no frame of the dial's between the bands
    await photo.settle();
    const jobsOf = () => presets.map((x) => ({ long: x.long, sharpen: OUTPUT[x.sharpen || '']?.[x.amt || 'Standard'] || 0, open: (/** @type {number} */ w, /** @type {number} */ h) => {
      const kept = carry(head, x.meta, x.gps, w, h);
      return x.fmt === 'JPEG' ? files.jpeg(w, h, x.q, photo.jpegBand, kept && block(kept)) : x.fmt === 'PNG' ? files.png(w, h, kept && block(kept)) : files.tiff(w, h, kept);
    } }));
    const step = (/** @type {number} */ d) => { if (photo.whole() !== big) throw new Error('The photo was closed.'); progress(d); };
    // By the network where it is on (Settings > Photos > Editor) and has not failed here lately; if it fails now, the
    // export is made again the usual way, and the network is left alone on this phone for a week.
    let made;
    try { made = await develop(big, jobsOf(), step, clock, best); }
    catch (err) {
      if (!clock.net || photo.whole() !== big) throw err;
      try { localStorage.setItem(NET, String(Date.now())); } catch { /* a private window */ }
      for (const k of Object.keys(clock)) delete clock[k];
      clock.fell = 1; made = await develop(big, jobsOf(), step, clock, false);
    }
    for (const [k, r] of made.entries()) { download(r.blob, presets[k].file); saved.push({ file: presets[k].file, width: r.width, height: r.height, bytes: r.blob.size, blob: r.blob }); }
  }); } finally { try { localStorage.removeItem(MARK); } catch { /* nothing was kept */ } }   // it ended, well or not, with the page alive
  note('save', performance.now() - began, { files: saved.length, px: saved.reduce((n, f) => n + f.width * f.height, 0), bytes: saved.reduce((n, f) => n + f.bytes, 0), kinds: presets.map((x) => x.fmt).join(' '), ...spent(clock) });
  return saved;
}

/** Exports many photos, one after another, each as it is edited, with the files the Export board has on: each is
 * opened as from the Library, developed from its own pixels and saved to Downloads. The screen is kept awake
 * while it runs (a phone that sleeps stops the page). `step(k, n, part)` as it goes: photos done, of how many, and
 * how far along the one in hand is. The photo that was open is opened again at the end. Returns how many photos
 * and files were saved, and how many photos could not be. @param {string[]} ids @param {(k: number, n: number, part: number) => void} step */
export async function saveMany(ids, step) {
  const was = photo.current()?.id, list = presets(), lock = await /** @type {any} */ (navigator).wakeLock?.request('screen').catch(() => null);
  let done = 0, files = 0, bad = 0;
  try {
    for (const [k, id] of ids.entries()) {
      step(k, ids.length, 0);
      try {
        await photo.open(id);
        for (let i = 0; i < 1200 && photo.current()?.id === id && photo.ready && !photo.whole(); i++) await new Promise((r) => setTimeout(r, 100));   // its own pixels follow the photo on screen
        const p = photo.current();
        if (p?.id !== id || !photo.whole()) throw new Error('not opened');
        files += (await save(jobs(list, p.name, photo.shape(), await day()), (d) => step(k, ids.length, d))).length; done++;
      } catch { bad++; }
    }
  } finally { lock?.release?.().catch(() => {}); }
  step(ids.length, ids.length, 0);
  if (was && was !== photo.current()?.id) await photo.open(was);
  return { done, files, bad };
}
