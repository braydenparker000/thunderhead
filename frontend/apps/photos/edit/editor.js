// @ts-check
// The editor (PHOTOS.md, the editor): the photo full-bleed on black, the panel strip along the bottom
// (Light, Color, Effects, Detail, Optics, Crop, Versions), the chosen panel's tools as chips above it and
// one tool at a time above them; Export in the top bar. The preview on this phone draws first; the
// original replaces it when its working copy is on the GPU. Every change renders at once and is saved
// half a second after the last one; an editing session's end keeps an automatic version.
import { el, toast } from '/th/ui.js';
import * as data from '../data.js';
import { back } from '../nav.js';
import { icon } from '../shelf.js';
import { neutralFor, srgbTo2020, tempTintOf } from './color.js';
import { copyButton } from './copy.js';
import { cropOverlay } from './crop.js';
import { exportSheet } from './export.js';
import { renderExport } from './export-run.js';
import { PANELS, withValue } from './fields.js';
import { frameSize, geometry } from './geometry.js';
import { photoGestures } from './gestures.js';
import { autoStart, drawHistogram, greyWorld, histogram } from './histogram.js';
import { lateralCA } from './optics.js';
import { makeRenderer } from './renderer.js';
import { loadRecipe, saver } from './save.js';
import { originalSource, previewSource } from './source.js';
import { toolView } from './tools.js';
import { touches } from './touch.js';
import { pack, toneLut } from './uniforms.js';
import { compareView, session, withGeometryOf } from './versions.js';
import { xmpOf, xmpSegment } from './xmp.js';
import { zoomer } from './zoom.js';

const SMALL = 256;
const CROPS = ['CropLeft', 'CropTop', 'CropRight', 'CropBottom'];
const TONE = ['Contrast2012', 'Whites2012', 'Blacks2012', 'ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'];
const sense = (/** @type {string} */ id, /** @type {string} */ panel) =>
  import('/th/senses/send.js').then((m) => m.sense('photo.edit', `photo:${id}`, { panel })).catch(() => {});
const remembered = () => { try { return JSON.parse(localStorage.getItem('th.photos.tools') || '{}'); } catch { return {}; } };

/** @param {HTMLElement} box @param {string} id */
export async function editScreen(box, id) {
  const t0 = performance.now();
  let canvas = el('canvas', { class: 'ecanvas', 'aria-label': 'The photo' });
  const hist = el('canvas', { class: 'ehist', width: '512', height: '220', hidden: '' });
  const hint = el('div', { class: 'ehint', hidden: '' });
  const stage = el('div', { class: 'estage' }, [canvas, hist, hint]);
  const status = el('span', { class: 'estatus', 'aria-live': 'polite' });
  const close = el('button', { type: 'button', class: 'vback', 'aria-label': 'Back to the photo' }, [icon('caret-left')]);
  const exp = el('button', { type: 'button', class: 'vback eexport', 'aria-label': 'Export' }, [icon('export')]);
  const tool = el('div', { class: 'etool' });
  const chips = el('div', { class: 'echips', role: 'tablist', 'aria-label': 'Tools' });
  const strip = el('nav', { class: 'estrip', 'aria-label': 'Panels' });
  const root = el('div', { class: 'editor', role: 'dialog', 'aria-label': 'Edit the photo' }, [stage, el('div', { class: 'etop' }, [close, el('div', { class: 'etitle' }, [el('b', { text: 'Edit' }), status]), exp, copyButton(() => ed.recipe)]), el('div', { class: 'ebottom' }, [tool, chips, strip])]);
  box.replaceChildren(root);
  close.addEventListener('click', back);
  const say = (/** @type {string} */ s) => { status.textContent = s; };

  /** @type {data.PhotoItem} */
  let p;
  try { p = await data.photo(id); } catch { say('This photo is not on this phone yet.'); return; }
  const rawPhoto = p.format === 'raf' || p.format === 'dng';
  const made = await makeRenderer(canvas).catch((e) => { say(`This phone cannot draw the editor (${e.message}).`); return null; });
  if (!made) return;
  const r = made.r;
  canvas = made.canvas;
  root.dataset.gpu = r.kind;
  const save = saver(id, (s) => { root.dataset.saved = s; say({ saving: 'Saving…', saved: 'Saved', offline: 'Offline: kept on this phone, sent when you are back', failed: 'Not saved yet: kept on this phone' }[s]); });

  /** @type {import('./tools.js').Ed & { before: boolean }} */
  const ed = {
    recipe: await loadRecipe(id), rawPhoto, id, aspect: null, img: { width: 1, height: 1 },
    thumb: async (rec) => canvasOf(await readSmall(rec, 120)),
    compare: async (two) => { compareView(root, await Promise.all(two.map(async (t) => ({ canvas: canvasOf(await readSmall(withGeometryOf(t.recipe, ed.recipe), 480)), label: t.label })))); root.dataset.compare = 'open'; },
    restore(rec) { ed.recipe = rec; changed(true); pick(panel, tools[panel]); }, shot: { temperature: 6500, tint: 0 }, auto: null, mode: 'view', mixProp: 'Hue', mixHue: 'Orange', wheel: 'shadows', before: false,
    set(key, v, done) { ed.recipe = withValue(ed.recipe, key, v); changed(done); },
    setWb(t, tint, done) { ed.recipe = withValue(withValue(withValue(ed.recipe, 'WhiteBalance', 'Custom'), 'Temperature', Math.round(t)), 'Tint', Math.round(tint)); changed(done); },
    wbMode(m) { if (m === 'Auto') autoWb(true); else { ed.recipe = withValue(withValue(withValue(ed.recipe, 'WhiteBalance', undefined), 'Temperature', undefined), 'Tint', undefined); changed(true); } },
    runAuto() { runAuto(); },
    setMode(m, h) { ed.mode = m; root.dataset.mode = m; if (h) toast(h); },
  };
  const img = { raw: false, rawPhoto, asShot: [0.3127, 0.329], shot: ed.shot, auto: /** @type {any} */ (null), width: p.width ?? 1, height: p.height ?? 1, srcW: 1, ca: /** @type {number[] | undefined} */ (undefined) };
  ed.img = img;
  const sess = session(id, () => ed.recipe);
  /** @type {import('./zoom.js').View} */
  const view = { z: 1, cu: 0.5, cv: 0.5, pw: 1, ph: 1, tile: null };
  /** @type {import('./source.js').Original | null} */
  let original = null;
  let lutKey = '', lut = /** @type {Uint16Array} */ (new Uint16Array(0)), frames = 0;
  /** @type {{ px: Uint8Array, w: number, h: number } | null} */
  let small = null;

  const dpr = () => Math.min(3, devicePixelRatio || 1);
  // The crop shows whole while the Crop panel is open; the frame is what the output is (geometry.js).
  const shown = (/** @type {import('./fields.js').Recipe} */ rec) => (panel === 'crop' ? CROPS.reduce((r, k) => withValue(r, k, undefined), rec) : rec);
  const frameOf = (/** @type {import('./fields.js').Recipe} */ rec) => frameSize(geometry(rec, img.width, img.height));
  let fr = [1, 1];
  const fitScale = () => Math.min(canvas.width / fr[0], canvas.height / fr[1]);
  const viewOf = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ flip, full = false, f = fr) => {
    const s = full ? Math.min(w / f[0], h / f[1]) : Math.min(w / f[0], h / f[1]) * view.z;
    const cu = full ? 0.5 : view.cu, cv = full ? 0.5 : view.cv;
    return { scale: [1 / (s * f[0]), 1 / (s * f[1])], offset: [cu - w / (2 * s * f[0]), cv - h / (2 * s * f[1])], size: [w, h], flip, p0: [1 / view.pw, 1 / view.ph], tile: full ? null : view.tile };
  };
  const canvasOf = (/** @type {{ px: Uint8Array, w: number, h: number }} */ s) => {
    const c = /** @type {HTMLCanvasElement} */ (el('canvas', { width: String(s.w), height: String(s.h) }));
    /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).putImageData(new ImageData(new Uint8ClampedArray(/** @type {ArrayBuffer} */ (s.px.buffer), s.px.byteOffset, s.px.length), s.w, s.h), 0, 0);
    return c;
  };
  const uniforms = (/** @type {import('./fields.js').Recipe} */ rec, /** @type {number} */ w, /** @type {number} */ h, /** @type {boolean} */ screen) => {
    const key = JSON.stringify([img.raw, ...TONE.map((k) => /** @type {any} */ (rec)[k])]);
    if (key !== lutKey) { lutKey = key; lut = toneLut(rec, img.raw); }
    return pack(rec, img, viewOf(w, h, screen && r.kind === 'webgl2' ? 1 : 0, !screen, screen ? fr : frameOf(rec)));
  };
  const readSmall = async (/** @type {import('./fields.js').Recipe} */ rec, side = SMALL) => {
    const f = frameOf(rec), h = Math.max(1, Math.round((side * f[1]) / f[0]));
    const u = uniforms(rec, side, h, false);
    return { px: await r.read(u, lut, side, h), w: side, h };
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let settleT = null;
  let queued = false;
  const draw = () => {
    root.dataset.idle = 'false';
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const rec = ed.before ? {} : shown(ed.recipe), f = frameOf(rec);
      if (Math.abs(f[0] - fr[0]) > 0.5 || Math.abs(f[1] - fr[1]) > 0.5) { fr = f; view.z = 1; view.cu = view.cv = 0.5; view.tile = null; r.clearDetail(); }
      r.draw(uniforms(rec, canvas.width, canvas.height, true), lut);
      zoom.drawn();
      overlay?.update();
      root.dataset.frames = String(++frames);
      if (settleT) clearTimeout(settleT);
      const at = frames;
      settleT = setTimeout(async () => {
        small = await readSmall(ed.recipe);
        if (!hist.hidden) drawHistogram(hist, histogram(small.px));
        await zoom.idle();
        if (frames === at && root.dataset.idle === 'false') root.dataset.idle = 'true';
      }, 150);
    });
  };
  const zoom = zoomer({ stage, canvas, root, view, r, img, frame: () => fr, original: () => original, shown: () => shown(ed.recipe), draw, readSmall });
  const usedPanels = new Set();
  const changed = (/** @type {boolean} */ done) => {
    if (ed.recipe.AutoLateralCA && !img.ca) img.ca = original ? lateralCA(original.source) : [0, 0];
    sess.touched();
    draw();
    if (done && (panel === 'crop' || panel === 'optics') && !PANELS.find((x) => x.id === panel)?.tools.some((x) => 'key' in x && x.key === tools[panel])) tool.replaceChildren(toolView(ed, panel, tools[panel]));
    if (!usedPanels.has(panel)) { usedPanels.add(panel); sense(id, panel); }
    if (done) save.put(ed.recipe);
  };
  const runAuto = async () => {
    const s = await readSmall(withValue(withValue(ed.recipe, 'Exposure2012', undefined), 'Contrast2012', undefined));
    const a = autoStart(s.px);
    ed.recipe = withValue(withValue(ed.recipe, 'Exposure2012', a.Exposure2012), 'Contrast2012', a.Contrast2012);
    changed(true);
    toast('Auto set Exposure and Contrast from the histogram: a start, yours to change.');
  };
  const asShotWb = () => withValue(withValue(withValue(ed.recipe, 'WhiteBalance', undefined), 'Temperature', undefined), 'Tint', undefined);
  const autoWb = async (/** @type {boolean} */ apply) => {
    const s = await readSmall(asShotWb());
    img.auto = ed.auto = neutralFor(img.asShot, srgbTo2020(greyWorld(s.px)));
    if (apply) { ed.recipe = withValue(asShotWb(), 'WhiteBalance', 'Auto'); changed(true); }
    else draw();
  };

  const layout = () => {
    const b = stage.getBoundingClientRect();
    canvas.width = Math.max(1, Math.min(r.maxSize, Math.round(b.width * dpr())));
    canvas.height = Math.max(1, Math.min(r.maxSize, Math.round(b.height * dpr())));
  };
  /** @param {import('./renderer.js').Source} src @param {{ raw: boolean, width: number, height: number, asShot: number[] }} info */
  const use = (src, info) => {
    Object.assign(img, info);
    ed.shot = img.shot = tempTintOf(info.asShot);
    layout();
    const s = Math.min(1, fitScale(), r.maxSize / Math.max(img.width, img.height));
    view.pw = Math.max(1, Math.round(img.width * s));
    view.ph = Math.max(1, Math.round(img.height * s));
    view.tile = null;
    img.srcW = src.width;
    r.source(src, view.pw, view.ph);
    if (src.kind === 'bitmap') src.bitmap.close();
    if (ed.recipe.WhiteBalance === 'Auto') autoWb(false);
    draw();
  };

  // The panel strip, the chips and the tool.
  const tools = remembered();
  let panel = PANELS.some((x) => x.id === tools.panel && x.id !== 'crop') ? tools.panel : 'light';
  /** @type {ReturnType<typeof cropOverlay> | null} */
  let overlay = null;
  /** @param {string} pid @param {string} [tid] */
  const pick = (pid, tid) => {
    panel = pid;
    const pn = PANELS.find((x) => x.id === pid) ?? PANELS[0];
    const ids = pn.tools.map((x) => ('key' in x ? x.key : x.tool));
    const chosen = tid ?? (ids.includes(tools[pid]) ? tools[pid] : ids[pn.id === 'light' ? 1 : 0]);
    tools[pid] = chosen;
    tools.panel = pid;
    if (pid === 'crop' && !overlay) { overlay = cropOverlay(stage, ed); view.z = 1; view.cu = view.cv = 0.5; } else if (pid !== 'crop' && overlay) { overlay.remove(); overlay = null; }
    root.dataset.panel = pid;
    draw();
    try { localStorage.setItem('th.photos.tools', JSON.stringify(tools)); } catch {}
    for (const b of strip.children) b.setAttribute('aria-current', String(/** @type {HTMLElement} */ (b).dataset.id === pid));
    chips.replaceChildren(...pn.tools.map((x) => {
      const tidx = 'key' in x ? x.key : x.tool;
      const on = tidx === chosen || (tidx === 'bw' && Boolean(ed.recipe.ConvertToGrayscale));
      const c = el('button', { type: 'button', role: 'tab', class: `echip${on ? ' on' : ''}`, 'aria-selected': String(tidx === chosen), 'data-tool': tidx, text: x.label });
      c.addEventListener('click', () => pick(pid, tidx));
      return c;
    }));
    tool.replaceChildren(toolView(ed, pid, chosen));
    /** @type {HTMLElement | null} */ (chips.querySelector('.echip[aria-selected="true"]'))?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  for (const pn of PANELS) {
    const b = el('button', { type: 'button', class: 'epanel', 'data-id': pn.id }, [icon(pn.icon), el('span', { text: pn.label })]);
    b.addEventListener('click', () => pick(pn.id));
    strip.append(b);
  }
  pick(panel);

  // The photo's gestures (zoom.js moves the photo; gestures.js reads the fingers).
  const touch = touches({ ed, asShot: () => img.asShot, uvAt: zoom.uvAt, readSmall, asShotWb, small: () => small, changed, picked: () => pick('color', 'Temperature'), remix: () => tool.replaceChildren(toolView(ed, 'color', 'mix')) });
  photoGestures(stage, {
    before: (on) => { ed.before = on; hint.hidden = !on; hint.textContent = 'As shot'; root.dataset.before = String(on); draw(); },
    histogram: (on) => { hist.hidden = !on; root.dataset.histogram = String(on); if (on && small) drawHistogram(hist, histogram(small.px)); },
    down: zoom.down, pinch: zoom.pinch, pan: zoom.pan, release: zoom.release, doubleTap: zoom.doubleTap,
    mode: () => (panel === 'crop' || ed.mode === 'level' ? 'view' : ed.mode),
    tap: (x, y) => touch.tap(x, y),
    target: (x, y, dy, done) => touch.target(x, y, dy, done),
  });

  // The preview first, then the original.
  say('Preview');
  const prev = await previewSource(id).catch(() => null);
  if (prev) use(prev, { raw: false, width: p.width ?? prev.width, height: p.height ?? prev.height, asShot: img.asShot });
  root.dataset.frame = 'preview';
  root.dataset.previewMs = String(Math.round(performance.now() - t0));
  if (navigator.onLine !== false && p.drive_id) {
    say(rawPhoto ? 'Building the full photo…' : 'Loading the original…');
    try {
      original = await originalSource(p);
      if (original) {
        use(original.source, { raw: original.raw, width: original.width, height: original.height, asShot: original.asShot });
        root.dataset.frame = 'original';
        root.dataset.firstMs = String(Math.round(performance.now() - t0));
        if (original.memory) root.dataset.wasmMib = (original.memory / 1048576).toFixed(1);
        say('');
      }
    } catch {
      say('Editing the preview: the original did not load.');
    }
  } else say('Offline: editing the preview');
  new ResizeObserver(() => { if (!root.isConnected) return; layout(); zoom.clamp(); draw(); }).observe(stage);
  // Test and diagnostics hook: the current render, small, read back.
  /** @type {any} */ (root).probe = async (/** @type {boolean} */ before) => readSmall(before ? {} : ed.recipe);
  /** @type {any} */ (root).recipe = () => ed.recipe;
  // An export takes the GPU's detail for its blocks: the screen leaves it until the export is done.
  exp.addEventListener('click', () => exportSheet(root, [{ id, name: p.name, render: (j) => { view.tile = null; return renderExport({ r, img, recipe: ed.recipe, p0: [1 / view.pw, 1 / view.ph], working: img.srcW / img.width, tile: original?.tile ?? null, segments: [xmpSegment(xmpOf(ed.recipe))], ...j })
    .finally(zoom.retile); } }]));
  root.addEventListener('photos:leave', () => { save.flush(); sess.end(); original?.close(); });
}
