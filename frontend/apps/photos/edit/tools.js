// @ts-check
// What sits above the chips for the chosen tool (PHOTOS.md, the editor): one slider, or Auto's start,
// the point curve, white balance (as shot, Auto, the picker, then Temp and Tint), Mix (eight colours,
// each with hue, saturation and luminance, and the targeted drag on the photo), Grading (three
// wheels with luminance, then Blending and Balance) and B&W.
import { el } from '/th/ui.js';
import { icon } from '../shelf.js';
import { cropTool } from './crop.js';
import { curveTool } from './curve.js';
import { opticsTool } from './optics.js';
import { versionsTool } from './versions.js';
import { HUES, PANELS, val, WHEELS } from './fields.js';
import { segments, slider, wheel } from './slider.js';

const SWATCH = { Red: '#e0453a', Orange: '#ef8a2c', Yellow: '#e8cf35', Green: '#4caf50', Aqua: '#2ec4c6', Blue: '#3f6fe8', Purple: '#8a52e0', Magenta: '#d64fb5' };

/** @typedef {{ recipe: import('./fields.js').Recipe, rawPhoto: boolean, shot: { temperature: number, tint: number }, auto: { temperature: number, tint: number } | null,
 *   mode: 'view' | 'pick' | 'target' | 'level', mixProp: string, mixHue: string, wheel: string, id: string, aspect: string | null,
 *   img: { width: number, height: number, ca?: number[] }, thumb: (r: import('./fields.js').Recipe) => Promise<HTMLCanvasElement>,
 *   compare: (two: { recipe: import('./fields.js').Recipe, label: string }[]) => void, restore: (r: import('./fields.js').Recipe) => void,
 *   set: (key: string, v: unknown, done: boolean) => void, setWb: (t: number, tint: number, done: boolean) => void,
 *   wbMode: (m: string) => void, runAuto: () => void, setMode: (m: 'view' | 'pick' | 'target' | 'level', hint?: string) => void }} Ed */

/** The white balance now in force: Custom's own, Auto's, or the file's. @param {Ed} ed */
export const wbNow = (ed) => (ed.recipe.WhiteBalance === 'Custom' ? { temperature: val(ed.recipe, 'Temperature'), tint: val(ed.recipe, 'Tint') }
  : ed.recipe.WhiteBalance === 'Auto' && ed.auto ? ed.auto : ed.shot);

/** @param {Ed} ed @param {import('./fields.js').Control} c */
function control(ed, c) {
  if (c.key === 'Temperature' || c.key === 'Tint') {
    const t = c.key === 'Temperature';
    return slider(c, {
      get: () => (t ? wbNow(ed).temperature : wbNow(ed).tint),
      set: (v, done) => (t ? ed.setWb(v, wbNow(ed).tint, done) : ed.setWb(wbNow(ed).temperature, v, done)),
      def: t ? ed.shot.temperature : ed.shot.tint,
    }).el;
  }
  return slider(c, { get: () => val(ed.recipe, c.key, ed.rawPhoto), set: (v, done) => ed.set(c.key, v, done), def: val({}, c.key, ed.rawPhoto) }).el;
}

/** @param {Ed} ed @param {string} panelId @param {string} toolId */
export function toolView(ed, panelId, toolId) {
  const panel = PANELS.find((p) => p.id === panelId);
  const t = panel?.tools.find((x) => ('key' in x ? x.key : x.tool) === toolId);
  if (!t) return el('div');
  ed.setMode('view');
  if ('key' in t) return control(ed, t);
  if (panelId === 'crop') return cropTool(ed, t.tool);
  if (panelId === 'optics') return opticsTool(ed);
  if (panelId === 'versions') return versionsTool(ed, t.tool);
  if (t.tool === 'auto') {
    const b = el('button', { type: 'button', class: 'eauto' }, [icon('magic-wand'), el('span', { text: 'Auto' })]);
    b.addEventListener('click', () => ed.runAuto());
    return el('div', { class: 'erow' }, [b, el('p', { class: 'eline', text: 'A start from the histogram: Exposure and Contrast set, the rest yours.' })]);
  }
  if (t.tool === 'curve') return curveTool(() => ed.recipe, (key, pts, done) => ed.set(key, pts, done)).el;
  if (t.tool === 'wb') {
    const on = ed.recipe.WhiteBalance === 'Auto' ? 'Auto' : 'As Shot';
    const row = segments([{ id: 'As Shot', label: 'As shot' }, { id: 'Auto', label: 'Auto' }, { id: 'Pick', label: 'Pick' }], on, (id) => {
      if (id === 'Pick') ed.setMode('pick', 'Tap something that should be neutral grey.');
      else ed.wbMode(id);
    });
    const { temperature, tint } = wbNow(ed);
    return el('div', { class: 'ecol' }, [row, el('p', { class: 'eline', text: `${temperature} K, tint ${tint > 0 ? '+' : ''}${tint}${ed.recipe.WhiteBalance === 'Custom' ? '' : ', as the camera set it'}` })]);
  }
  if (t.tool === 'bw') {
    const on = Boolean(ed.recipe.ConvertToGrayscale);
    const b = el('button', { type: 'button', class: `eauto${on ? ' on' : ''}`, 'aria-pressed': String(on) }, [icon('circle-half'), el('span', { text: on ? 'Black and white' : 'Colour' })]);
    b.addEventListener('click', () => ed.set('ConvertToGrayscale', on ? undefined : true, true));
    return el('div', { class: 'erow' }, [b, el('p', { class: 'eline', text: "In black and white, Mix's luminance sets how light each colour turns." })]);
  }
  if (t.tool === 'mix') {
    const box = el('div', { class: 'ecol' });
    const draw = () => {
      const hues = segments(HUES.map((h) => ({ id: h, label: h })), ed.mixHue, (h) => { ed.mixHue = h; draw(); });
      hues.classList.add('hues');
      for (const b of hues.children) /** @type {HTMLElement} */ (b).style.setProperty('--sw', SWATCH[/** @type {keyof typeof SWATCH} */ (/** @type {HTMLElement} */ (b).dataset.id)]);
      const props = segments([{ id: 'Hue', label: 'Hue' }, { id: 'Saturation', label: 'Saturation' }, { id: 'Luminance', label: 'Luminance' }], ed.mixProp, (p) => { ed.mixProp = p; draw(); });
      const target = el('button', { type: 'button', class: `seg${ed.mode === 'target' ? ' on' : ''}`, 'aria-pressed': String(ed.mode === 'target'), 'aria-label': 'Drag on the photo' }, [icon('hand-pointing')]);
      target.addEventListener('click', () => { ed.setMode(ed.mode === 'target' ? 'view' : 'target', `Drag up or down on a colour in the photo: its ${ed.mixProp.toLowerCase()}.`); draw(); });
      props.append(target);
      const key = `${ed.mixProp}Adjustment${ed.mixHue}`;
      const mode = ed.mode;
      box.replaceChildren(hues, props, control(ed, { key, label: `${ed.mixHue} ${ed.mixProp.toLowerCase()}`, step: 1, up: ed.mixProp === 'Hue' ? 'shifted on' : 'more', down: ed.mixProp === 'Hue' ? 'shifted back' : 'less' }));
      ed.mode = mode;
    };
    draw();
    return box;
  }
  // Grading
  const box = el('div', { class: 'ecol' });
  const draw = () => {
    const tabs = segments([...WHEELS.map((w) => ({ id: w.id, label: w.label })), { id: 'blending', label: 'Blending' }, { id: 'balance', label: 'Balance' }], ed.wheel, (w) => { ed.wheel = w; draw(); });
    const w = WHEELS.find((x) => x.id === ed.wheel);
    if (!w) {
      const c = ed.wheel === 'blending' ? { key: 'ColorGradeBlending', label: 'Blending', step: 1, up: 'wider overlap', down: 'narrower overlap', zero: 'even' } : { key: 'SplitToningBalance', label: 'Balance', step: 1, up: 'toward highlights', down: 'toward shadows', zero: 'even' };
      box.replaceChildren(tabs, control(ed, c));
      return;
    }
    const pad = wheel(() => ({ hue: val(ed.recipe, w.hue), sat: val(ed.recipe, w.sat) }), (hue, sat, done) => { ed.set(w.hue, hue, false); ed.set(w.sat, sat, done); });
    box.replaceChildren(tabs, el('div', { class: 'erow' }, [pad.el, control(ed, { key: w.lum, label: 'Luminance', step: 1, up: 'lighter', down: 'darker' })]));
  };
  draw();
  return box;
}
