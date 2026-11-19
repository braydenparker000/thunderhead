// A picture's own colour (FEEL.md "Loading" and rule 12 "Colour from artwork"). The small copy of a poster
// or backdrop (app/content.js artAt) is asked for with CORS, so the page may draw it on an 8×12 canvas and
// read it: four bands, top to bottom (the placeholder is a soft gradient of them, a blurred copy that costs
// no blur and no element), their average (the flat placeholder) and the most vivid colour (the title's
// tint). What was read is remembered per picture, in memory and on this phone (at most 400 pictures), so
// a poster seen once paints its colour at once ever after, and Details knows its title's tint before it
// opens. A host that refuses CORS is not asked again this visit; its pictures keep the surface colour.

import {artAt} from '../app/content.js';

const KEY = 'astra.art'; // this phone only: never synced, never in a backup
const LIMIT = 400;
const W = 8, H = 12;
let memory = null;
const reading = new Map(); // src -> promise of its entry
const refused = new Set(); // hosts that refused CORS this visit

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const linear = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
/** Relative luminance of a #rrggbb colour (WCAG). */
export const luminance = h => { const [r, g, b] = rgb(h).map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast between two #rrggbb colours. */
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function load() {
  if (memory) return memory;
  memory = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))) if (valid(v)) memory.set(k, v); } catch {}
  return memory;
}
const valid = v => v && Array.isArray(v.bands) && v.bands.length === 4 && v.bands.every(b => /^#[0-9a-f]{6}$/.test(b)) && /^#[0-9a-f]{6}$/.test(v.average) && (v.vivid === null || /^#[0-9a-f]{6}$/.test(v.vivid));
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = [...load()].slice(-LIMIT);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
  }, 1500);
}

/**
 * What a picture's pixels say (RGBA as getImageData gives them, `w` wide): four bands' colours top to
 * bottom, their average, and the most vivid colour (null for a picture of greys). Pure.
 * @param {ArrayLike<number>} data @param {number} w @returns {{bands: string[], average: string, vivid: string | null}}
 */
export function readPixels(data, w) {
  const rows = Math.floor(data.length / 4 / w), bands = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  let best = null, bestScore = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = data[i + 3] / 255;
    if (a < 0.5) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2], band = bands[Math.min(3, Math.floor(y * 4 / rows))];
    band[0] += r; band[1] += g; band[2] += b; band[3]++;
    // Vivid: much colour, neither near black nor near white.
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = (max - min) / 255, light = (max + min) / 510;
    const score = chroma * (1 - Math.abs(light - 0.5) * 1.2);
    if (score > bestScore) { bestScore = score; best = [r, g, b]; }
  }
  const total = bands.reduce((t, b) => [t[0] + b[0], t[1] + b[1], t[2] + b[2], t[3] + b[3]], [0, 0, 0, 0]);
  const avg = t => t[3] ? hex(t[0] / t[3], t[1] / t[3], t[2] / t[3]) : '#1a1a1a';
  const average = avg(total);
  return {bands: bands.map(b => b[3] ? avg(b) : average), average, vivid: best && bestScore > 0.22 ? hex(...best) : null};
}

/**
 * A title's tint from a vivid colour (FEEL.md rule 12): kept to a calm saturation and made light enough
 * that dark text (--on-tint, #111111) reads on it at 4.5:1 or better. Pure.
 */
export function tintFrom(vivid, ink = '#111111') {
  if (!vivid) return null;
  const [r, g, b] = rgb(vivid).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = Math.min(0.62, d ? d / (1 - Math.abs(2 * l - 1)) : 0);
  // HSL to RGB (h in sixths of a turn).
  const fromHsl = light => {
    const c = (1 - Math.abs(2 * light - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = light - c / 2;
    const [p, q, t] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
    return hex((p + m) * 255, (q + m) * 255, (t + m) * 255);
  };
  for (let light = Math.max(0.55, Math.min(0.8, l)); light < 0.95; light += 0.02) {
    const out = fromHsl(light);
    if (contrast(out, ink) >= 4.6) return out;
  }
  return fromHsl(0.94);
}

/** The text colour that reads on a tint at 4.5:1 (dark for every tint tintFrom makes, light for any other). */
export const onTint = t => (contrast(t, '#111111') >= 4.5 ? '#111111' : '#ffffff');
/** Sets a title's tint on `el` (--tint and --on-tint together), or takes both away with null. */
export function setTint(el, t) {
  if (t) { el.style.setProperty('--tint', t); el.style.setProperty('--on-tint', onTint(t)); }
  else { el.style.removeProperty('--tint'); el.style.removeProperty('--on-tint'); }
}

/** What is remembered of a picture, or null. */
export const artEntry = src => (src && load().get(src)) || null;

function remember(src, entry) {
  const m = load();
  m.delete(src); // newest last, so the oldest are the ones dropped
  m.set(src, entry);
  if (m.size > LIMIT + 50) for (const k of [...m.keys()].slice(0, m.size - LIMIT)) m.delete(k);
  save();
}

const hostOf = src => { try { return new URL(src).host; } catch { return ''; } };

/**
 * Reads a picture's colours from its small copy (once per picture). Resolves the entry, or null when the
 * host has no small copy or does not let a page read it.
 */
export function readArt(src) {
  const known = artEntry(src);
  if (known) return Promise.resolve(known);
  const small = artAt(src, 'small');
  if (!small || refused.has(hostOf(small)) || typeof Image !== 'function') return Promise.resolve(null);
  if (reading.has(src)) return reading.get(src);
  const task = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const c = canvas.getContext('2d', {willReadFrequently: true});
        c.drawImage(img, 0, 0, W, H);
        const entry = readPixels(c.getImageData(0, 0, W, H).data, W);
        remember(src, entry);
        resolve(entry);
      } catch { resolve(null); }
    };
    img.onerror = () => { refused.add(hostOf(small)); resolve(null); };
    img.src = small;
  });
  reading.set(src, task);
  task.then(() => reading.delete(src));
  return task;
}

/**
 * Gives `el` its picture's placeholder as custom properties (--art-blur, a gradient of the four bands;
 * --art-flat, their average), which browse.css paints under the art per Settings (blur, colour or none).
 * Unknown pictures are read when `read` is set and painted when that lands. Returns the entry or null.
 */
export function paintArt(el, src, {read = false} = {}) {
  const apply = e => {
    if (!e || !el) return;
    el.style.setProperty('--art-blur', `linear-gradient(${e.bands.join(', ')})`);
    el.style.setProperty('--art-flat', e.average);
  };
  const e = artEntry(src);
  if (e) apply(e);
  else if (read) readArt(src).then(apply);
  return e;
}

/** The title's tint, from what is remembered of its poster, then its backdrop; null when neither is known or vivid. */
export function tintOfArt(meta) {
  for (const src of [meta?.poster, meta?.background]) {
    const e = artEntry(src);
    if (e?.vivid) return tintFrom(e.vivid);
  }
  return null;
}

/** Reads the title's art when its tint is not known yet; resolves the tint or null. */
export async function readTint(meta) {
  const now = tintOfArt(meta);
  if (now) return now;
  for (const src of [meta?.poster, meta?.background]) {
    const e = src ? await readArt(src) : null;
    if (e?.vivid) return tintFrom(e.vivid);
  }
  return null;
}
