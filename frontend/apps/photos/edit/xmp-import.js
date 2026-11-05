// @ts-check
// A preset from the common desktop editor (PHOTOS.md, Looks: the .xmp table): an XMP file whose crs:
// values (attributes, elements, or a list) are a develop setting each. Only the values our recipe has
// are read, held inside its ranges; a Look block's parameters fill keys the preset leaves out, scaled by
// its Amount. Temperature and Tint come only with WhiteBalance="Custom", as offsets: kelvin are read
// against 5,500 K, the ±100 increments of a preset made for JPEGs as about ±50 mired. Its name is
// crs:Name (else the file's), its group a tag. Nothing else is read or kept: no author, no thumbnail.
import { PANEL_KEYS } from '../copied.js';
import { CURVES, NUMBERS } from './fields.js';
import { WB_REF } from './looks-apply.js';

/** The largest file read, in bytes: a preset is a few KB. */
export const XMP_MAX_BYTES = 512 * 1024;
const NAME_CHARS = 60, TAG_CHARS = 40;
const SKIP_CROP = new Set(PANEL_KEYS.crop);
const FLAGS = ['ConvertToGrayscale', 'AutoLateralCA', 'LensProfileEnable'];
/** A preset's own description of itself, not a setting: never counted as skipped. */
const META = /^(Name|Group|UUID|Version|ProcessVersion|PresetType|Cluster|Supports\w*|CameraModelRestriction|Copyright|ContactInfo|ShortName|SortName|Description|HasSettings|Thumbnail|Look|Parameters|Amount|ToneCurveName\w*|AlreadyApplied|RequiresRGBTables|CameraProfile\w*|HasCrop)$/;
/** @typedef {import('./fields.js').Recipe} Recipe */
/** @typedef {import('../copied.js').Panel} Panel */
/** @typedef {{ name: string, tag: string | null, recipe: Recipe, panels: Panel[], used: number, skipped: number }} Preset */

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
const decode = (/** @type {string} */ s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()]));
const clean = (/** @type {string} */ s, /** @type {number} */ n) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n).trim();

/** Every crs: value in `xml`: attributes, simple elements, and rdf lists (an Alt's first item). @param {string} xml */
function fields(xml) {
  /** @type {Map<string, string | string[]>} */
  const out = new Map();
  for (const m of xml.matchAll(/\bcrs:([A-Za-z0-9]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(m[1], decode(m[2] ?? m[3] ?? ''));
  for (const m of xml.matchAll(/<crs:([A-Za-z0-9]+)>([^<]*)<\/crs:\1>/g)) out.set(m[1], decode(m[2].trim()));
  for (const m of xml.matchAll(/<crs:([A-Za-z0-9]+)>\s*<rdf:(Alt|Seq|Bag)>([\s\S]*?)<\/rdf:\2>\s*<\/crs:\1>/g)) {
    const items = [...m[3].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((x) => decode(x[1].trim()));
    out.set(m[1], m[2] === 'Alt' ? (items[0] ?? '') : items);
  }
  return out;
}

/** A curve's points, 2 to 16 of them (a longer one keeps 16 spread along it), inputs rising. @param {string[]} items */
function curveOf(items) {
  const pts = items.map((s) => s.split(',').map((n) => Math.round(Number(n)))).filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0 && n <= 255));
  const rising = pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]);
  if (rising.length < 2 || rising.length !== pts.length) return null;
  if (rising.length <= 16) return rising;
  return Array.from({ length: 16 }, (_, i) => rising[Math.round((i * (rising.length - 1)) / 15)]);
}

/** The recipe values of one block of fields, and how many settings it had that the recipe has not. @param {Map<string, string | string[]>} f @param {number} [scale] */
function valuesOf(f, scale = 1) {
  /** @type {Record<string, unknown>} */
  const r = {};
  let skipped = 0;
  const custom = f.get('WhiteBalance') === 'Custom';
  for (const [k, raw] of f) {
    if (META.test(k)) continue;
    const s = typeof raw === 'string' ? raw : '';
    if (k === 'Temperature' || k === 'Tint') {
      const n = Number(s);
      if (!custom || !Number.isFinite(n)) { skipped++; continue; }
      if (k === 'Tint') r.Tint = Math.round(Math.min(150, Math.max(-150, n)));
      // Kelvin read against 5,500 K; a JPEG preset's ±100 as about ±50 mired (+ warmer).
      else r.Temperature = Math.round(Math.min(50000, Math.max(2000, n >= 2000 ? n : 1e6 / (1e6 / WB_REF - Math.max(-100, Math.min(100, n)) * 0.5))));
    } else if (k === 'WhiteBalance') {
      if (s === 'Custom' || s === 'Auto') r.WhiteBalance = s; else if (s !== 'As Shot') skipped++;
    } else if (CURVES.includes(k) && Array.isArray(raw)) {
      const c = curveOf(raw);
      if (c) r[k] = c; else skipped++;
    } else if (FLAGS.includes(k)) r[k] = s === 'True' || s === 'true' || s === '1';
    else if (NUMBERS[k] && !SKIP_CROP.has(k) && s.trim() !== '' && Number.isFinite(Number(s))) {
      const [lo, hi, def] = NUMBERS[k];
      r[k] = Math.min(hi, Math.max(lo, def + (Number(s) - def) * scale));
    } else skipped++;
  }
  return { r, skipped };
}

/** One .xmp file's text to a look, or null when it holds no setting the recipe has. @param {string} xml @param {string} [file] @returns {Preset | null} */
export function presetOfXmp(xml, file = '') {
  if (xml.length > XMP_MAX_BYTES || !/camera-raw-settings|\bcrs:/.test(xml)) return null;
  const block = xml.match(/<crs:Look>[\s\S]*?<\/crs:Look>/)?.[0] ?? '';
  const main = fields(xml.replace(block, '').replace(/<crs:Parameters>[\s\S]*?<\/crs:Parameters>/g, ''));
  const { r, skipped } = valuesOf(main);
  let skip = skipped;
  if (block) {
    const params = block.match(/<crs:Parameters>([\s\S]*?)<\/crs:Parameters>/)?.[1] ?? '';
    const amount = Number(fields(block.replace(params, '')).get('Amount') ?? 1);
    const look = valuesOf(fields(params), Number.isFinite(amount) ? Math.max(0, Math.min(2, amount)) : 1);
    for (const [k, v] of Object.entries(look.r)) if (!(k in r)) r[k] = v;
    skip += look.skipped;
  }
  for (const k of FLAGS) if (r[k] === false) delete r[k];
  const panels = /** @type {Panel[]} */ (Object.keys(PANEL_KEYS)).filter((p) => p !== 'crop' && PANEL_KEYS[/** @type {Panel} */ (p)].some((k) => k in r));
  if (!panels.length) return null;
  const given = main.get('Name'), group = main.get('Group');
  const name = clean(typeof given === 'string' && given ? given : file.replace(/\.xmp$/i, '') || 'Imported look', NAME_CHARS) || 'Imported look';
  const tag = typeof group === 'string' && clean(group, TAG_CHARS) ? clean(group, TAG_CHARS) : null;
  return { name, tag, recipe: /** @type {Recipe} */ (r), panels, used: Object.keys(r).length, skipped: skip };
}
