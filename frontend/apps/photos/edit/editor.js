// @ts-check
// The editor (PHOTOS.md, the editor): the photo full-bleed on black, the panel strip along the bottom
// (Light, Color, Effects, Detail), the chosen panel's tools as chips above it and one tool at a time
// above them. The preview on this phone draws first; the original replaces it when its working copy
// is on the GPU. Every change renders at once and is saved half a second after the last one.
import { el, toast } from '/th/ui.js';
import * as data from '../data.js';
import { back } from '../nav.js';
import { icon } from '../shelf.js';
import { neutralFor, srgbTo2020, tempTintOf } from './color.js';
import { HUES, PANELS, val, withValue } from './fields.js';
import { photoGestures } from './gestures.js';
import { autoStart, colourAt, drawHistogram, greyWorld, histogram } from './histogram.js';
import { makeRenderer } from './renderer.js';
import { loadRecipe, saver } from './save.js';
import { originalSource, previewSource } from './source.js';
import { toolView } from './tools.js';
import { pack, toneLut } from './uniforms.js';
import { linear } from './color.js';

const SMALL = 256;
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
  const tool = el('div', { class: 'etool' });
  const chips = el('div', { class: 'echips', role: 'tablist', 'aria-label': 'Tools' });
  const strip = el('nav', { class: 'estrip', 'aria-label': 'Panels' });
  const root = el('div', { class: 'editor', role: 'dialog', 'aria-label': 'Edit the photo' }, [stage, el('div', { class: 'etop' }, [close, el('div', { class: 'etitle' }, [el('b', { text: 'Edit' }), status])]), el('div', { class: 'ebottom' }, [tool, chips, strip])]);
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
    recipe: await loadRecipe(id), rawPhoto, shot: { temperature: 6500, tint: 0 }, auto: null, mode: 'view', mixProp: 'Hue', mixHue: 'Orange', wheel: 'shadows', before: false,
    set(key, v, done) { ed.recipe = withValue(ed.recipe, key, v); changed(done); },
    setWb(t, tint, done) { ed.recipe = withValue(withValue(withValue(ed.recipe, 'WhiteBalance', 'Custom'), 'Temperature', Math.round(t)), 'Tint', Math.round(tint)); changed(done); },
    wbMode(m) { if (m === 'Auto') autoWb(true); else { ed.recipe = withValue(withValue(withValue(ed.recipe, 'WhiteBalance', undefined), 'Temperature', undefined), 'Tint', undefined); changed(true); } },
    runAuto() { runAuto(); },
    setMode(m, h) { ed.mode = m; root.dataset.mode = m; if (h) toast(h); },
  };
  const img = { raw: false, rawPhoto, asShot: [0.3127, 0.329], shot: ed.shot, auto: /** @type {any} */ (null), width: p.width ?? 1, height: p.height ?? 1 };
  const view = { z: 1, cu: 0.5, cv: 0.5, pw: 1, ph: 1, tile: /** @type {null | { u0: number, v0: number, u1: number, v1: number, texel: number[] }} */ (null) };
  /** @type {import('./source.js').Original | null} */
  let original = null;
  let lutKey = '', lut = /** @type {Uint16Array} */ (new Uint16Array(0)), frames = 0;
  /** @type {{ px: Uint8Array, w: number, h: number } | null} */
  let small = null;

  const dpr = () => Math.min(3, devicePixelRatio || 1);
  const fitScale = () => Math.min(canvas.width / img.width, canvas.height / img.height);
  const viewOf = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ flip, full = false) => {
    const s = full ? Math.min(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height) * view.z;
    const cu = full ? 0.5 : view.cu, cv = full ? 0.5 : view.cv;
    return { scale: [1 / (s * img.width), 1 / (s * img.height)], offset: [cu - w / (2 * s * img.width), cv - h / (2 * s * img.height)], size: [w, h], flip, p0: [1 / view.pw, 1 / view.ph], tile: full ? null : view.tile };
  };
  const uniforms = (/** @type {import('./fields.js').Recipe} */ rec, /** @type {number} */ w, /** @type {number} */ h, /** @type {boolean} */ screen) => {
    const key = JSON.stringify([img.raw, ...TONE.map((k) => /** @type {any} */ (rec)[k])]);
    if (key !== lutKey) { lutKey = key; lut = toneLut(rec, img.raw); }
    return pack(rec, img, viewOf(w, h, screen && r.kind === 'webgl2' ? 1 : 0, !screen));
  };
  const readSmall = async (/** @type {import('./fields.js').Recipe} */ rec) => {
    const h = Math.max(1, Math.round((SMALL * img.height) / img.width));
    const u = uniforms(rec, SMALL, h, false);
    return { px: await r.read(u, lut, SMALL, h), w: SMALL, h };
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let settleT = null;
  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      r.draw(uniforms(ed.before ? {} : ed.recipe, canvas.width, canvas.height, true), lut);
      root.dataset.frames = String(++frames);
      if (settleT) clearTimeout(settleT);
      settleT = setTimeout(async () => {
        small = await readSmall(ed.recipe);
        if (!hist.hidden) drawHistogram(hist, histogram(small.px));
      }, 150);
    });
  };
  const usedPanels = new Set();
  const changed = (/** @type {boolean} */ done) => {
    draw();
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
    r.source(src, view.pw, view.ph);
    if (src.kind === 'bitmap') src.bitmap.close();
    if (ed.recipe.WhiteBalance === 'Auto') autoWb(false);
    draw();
  };

  // The panel strip, the chips and the tool.
  const tools = remembered();
  let panel = PANELS.some((x) => x.id === tools.panel) ? tools.panel : 'light';
  /** @param {string} pid @param {string} [tid] */
  const pick = (pid, tid) => {
    panel = pid;
    const pn = PANELS.find((x) => x.id === pid) ?? PANELS[0];
    const ids = pn.tools.map((x) => ('key' in x ? x.key : x.tool));
    const chosen = tid ?? (ids.includes(tools[pid]) ? tools[pid] : ids[pn.id === 'light' ? 1 : 0]);
    tools[pid] = chosen;
    tools.panel = pid;
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

  // The photo's gestures.
  const uvAt = (/** @type {number} */ x, /** @type {number} */ y) => {
    const b = stage.getBoundingClientRect(), v = viewOf(canvas.width, canvas.height, 0);
    return [v.offset[0] + (x - b.left) * dpr() * v.scale[0], v.offset[1] + (y - b.top) * dpr() * v.scale[1]];
  };
  const zmax = () => Math.max(1, 1 / fitScale());
  const clampView = () => {
    const v = viewOf(canvas.width, canvas.height, 0), hu = (canvas.width * v.scale[0]) / 2, hv = (canvas.height * v.scale[1]) / 2;
    view.cu = hu >= 0.5 ? 0.5 : Math.min(1 - hu, Math.max(hu, view.cu));
    view.cv = hv >= 0.5 ? 0.5 : Math.min(1 - hv, Math.max(hv, view.cv));
  };
  let detailN = 0;
  const settle = async () => {
    const n = ++detailN;
    if (view.z <= 1.05) { view.tile = null; r.clearDetail(); draw(); return; }
    const v = viewOf(canvas.width, canvas.height, 0);
    const u0 = Math.max(0, v.offset[0]), v0 = Math.max(0, v.offset[1]);
    const u1 = Math.min(1, v.offset[0] + canvas.width * v.scale[0]), v1 = Math.min(1, v.offset[1] + canvas.height * v.scale[1]);
    const w = Math.max(1, Math.round((u1 - u0) / v.scale[0])), h = Math.max(1, Math.round((v1 - v0) / v.scale[1]));
    const full = original && fitScale() * view.z > (original.source.width / img.width) * 1.05;
    const tile = full && original ? await original.tile(Math.floor(u0 * img.width), Math.floor(v0 * img.height), Math.ceil((u1 - u0) * img.width), Math.ceil((v1 - v0) * img.height)).catch(() => null) : null;
    if (n !== detailN) { if (tile?.kind === 'bitmap') tile.bitmap.close(); return; }
    r.detail(tile, [u0, v0, u1, v1], w, h);
    if (tile?.kind === 'bitmap') tile.bitmap.close();
    view.tile = { u0, v0, u1, v1, texel: [1 / w, 1 / h] };
    root.dataset.detail = tile ? 'tile' : 'working';
    draw();
  };
  const zoomAt = (/** @type {number} */ z, /** @type {number} */ x, /** @type {number} */ y) => {
    const [u, v] = uvAt(x, y);
    view.z = Math.min(zmax(), Math.max(1, z));
    const [u2, v2] = uvAt(x, y);
    view.cu += u - u2; view.cv += v - v2;
    clampView();
    view.tile = null; r.clearDetail();
    draw();
  };
  let targetBase = /** @type {null | { k: number, f: number, a: number, b: number }} */ (null);
  photoGestures(stage, {
    before: (on) => { ed.before = on; hint.hidden = !on; hint.textContent = 'As shot'; root.dataset.before = String(on); draw(); },
    histogram: (on) => { hist.hidden = !on; root.dataset.histogram = String(on); if (on && small) drawHistogram(hist, histogram(small.px)); },
    zoom: (f, x, y) => zoomAt(view.z * f, x, y),
    pan: (dx, dy) => { const v = viewOf(canvas.width, canvas.height, 0); view.cu -= dx * dpr() * v.scale[0]; view.cv -= dy * dpr() * v.scale[1]; clampView(); draw(); },
    settle,
    doubleTap: (x, y) => { zoomAt(view.z > 1.05 ? 1 : zmax(), x, y); settle(); },
    mode: () => ed.mode,
    tap: async (x, y) => {
      if (ed.mode !== 'pick') return;
      const [u, v] = uvAt(x, y);
      const s = await readSmall(asShotWb());
      const c = colourAt(s.px, s.w, s.h, u, v).map(linear);
      const wb = neutralFor(img.asShot, srgbTo2020(c));
      ed.setMode('view');
      ed.setWb(wb.temperature, wb.tint, true);
      pick('color', 'Temperature');
    },
    target: (x, y, dy, done) => {
      if (!small) return;
      if (!targetBase) {
        const [u, v] = uvAt(x, y);
        const c = colourAt(small.px, small.w, small.h, u, v);
        const mx = Math.max(...c), mn = Math.min(...c), d = mx - mn || 1e-6;
        const hue = (((mx === c[0] ? (c[1] - c[2]) / d : mx === c[1] ? 2 + (c[2] - c[0]) / d : 4 + (c[0] - c[1]) / d) * 60) + 360) % 360;
        const C = [0, 30, 60, 120, 180, 240, 270, 300, 360];
        const k = Math.max(0, C.findIndex((h, i) => hue >= h && hue < C[i + 1]));
        const key = (/** @type {number} */ i) => `${ed.mixProp}Adjustment${HUES[i % 8]}`;
        targetBase = { k, f: (hue - C[k]) / (C[k + 1] - C[k]), a: val(ed.recipe, key(k)), b: val(ed.recipe, key(k + 1)) };
        ed.mixHue = HUES[targetBase.f < 0.5 ? k : (k + 1) % 8];
      }
      const t = targetBase, delta = -dy / 2;
      const clamp = (/** @type {number} */ q) => Math.round(Math.max(-100, Math.min(100, q)));
      ed.recipe = withValue(ed.recipe, `${ed.mixProp}Adjustment${HUES[t.k]}`, clamp(t.a + delta * (1 - t.f)));
      ed.recipe = withValue(ed.recipe, `${ed.mixProp}Adjustment${HUES[(t.k + 1) % 8]}`, clamp(t.b + delta * t.f));
      changed(done);
      if (done) { targetBase = null; tool.replaceChildren(toolView(ed, 'color', 'mix')); ed.setMode('target'); }
    },
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
  new ResizeObserver(() => { if (!root.isConnected) return; layout(); clampView(); draw(); }).observe(stage);
  // Test and diagnostics hook: the current render, small, read back.
  /** @type {any} */ (root).probe = async (/** @type {boolean} */ before) => readSmall(before ? {} : ed.recipe);
  /** @type {any} */ (root).recipe = () => ed.recipe;
  root.addEventListener('photos:leave', () => { save.flush(); original?.close(); });
}
