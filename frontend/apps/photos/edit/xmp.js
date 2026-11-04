// @ts-check
// The recipe as XMP (PHOTOS.md, Export: the XMP names): the packet an exported JPEG carries in its
// APP1, so the edit survives outside. Keys go under crs: where Lightroom has the name (most of ours
// are its names), under our own namespace where it has none (the flips), with crs:AlreadyApplied so
// a reader knows the pixels already carry the edit. recipeOfXmp reads a packet back into a recipe.
import { CURVES, NUMBERS } from './fields.js';

export const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
export const OURS = 'urn:thunderhead:photos:1.0';
const FLAGS = ['ConvertToGrayscale', 'AutoLateralCA', 'LensProfileEnable', 'CropConstrainToWarp', 'FlipHorizontal', 'FlipVertical'];
/** Ours: Lightroom keeps a flip in the file's orientation, not in its settings. */
const OWN = new Set(['FlipHorizontal', 'FlipVertical']);
/** Lightroom writes these switches as 1 and 0; the rest as True and False. */
const ONE = new Set(['AutoLateralCA', 'LensProfileEnable', 'CropConstrainToWarp']);
const CROP = ['CropTop', 'CropLeft', 'CropBottom', 'CropRight', 'CropAngle'];

/** @param {import('./fields.js').Recipe} recipe @returns {string} */
export function xmpOf(recipe) {
  const r = /** @type {Record<string, unknown>} */ (recipe);
  const attrs = ['crs:ProcessVersion="11.0"', 'crs:AlreadyApplied="True"'];
  const seqs = [];
  for (const k of Object.keys(r).sort()) {
    const v = r[k], ns = OWN.has(k) ? 'th' : 'crs';
    if (typeof v === 'number' && NUMBERS[k]) attrs.push(`${ns}:${k}="${v > 0 && NUMBERS[k][0] < 0 ? '+' : ''}${Math.round(v * 1e4) / 1e4}"`);
    else if (typeof v === 'boolean' && FLAGS.includes(k)) attrs.push(`${ns}:${k}="${ONE.has(k) ? (v ? 1 : 0) : v ? 'True' : 'False'}"`);
    else if (k === 'WhiteBalance' && typeof v === 'string') attrs.push(`crs:WhiteBalance="${v.replace(/[^A-Za-z ]/g, '')}"`);
    else if (CURVES.includes(k) && Array.isArray(v)) seqs.push(`<crs:${k}><rdf:Seq>${v.map((p) => `<rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('')}</rdf:Seq></crs:${k}>`);
  }
  if (CROP.some((k) => k in r)) attrs.push('crs:HasCrop="True"');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:crs="${CRS}" xmlns:th="${OURS}"
 ${attrs.join('\n ')}>
${seqs.join('\n')}
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** A packet back to a recipe: only the keys the recipe has, in its types. @param {string} xml */
export function recipeOfXmp(xml) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [, , k, v] of xml.matchAll(/\b(crs|th):(\w+)="([^"]*)"/g)) {
    if (NUMBERS[k] && Number.isFinite(Number(v))) out[k] = Number(v);
    else if (FLAGS.includes(k)) out[k] = v === 'True' || v === '1';
    else if (k === 'WhiteBalance') out[k] = v;
  }
  for (const [, k, body] of xml.matchAll(/<crs:(ToneCurvePV2012\w*)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>/g))
    if (CURVES.includes(k)) out[k] = [...body.matchAll(/<rdf:li>(\d+), (\d+)<\/rdf:li>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  for (const k of FLAGS) if (out[k] === false) delete out[k];
  return /** @type {import('./fields.js').Recipe} */ (out);
}

/** The APP1 payload: the XMP header, then the packet. @param {string} xml */
export const xmpSegment = (xml) => new TextEncoder().encode(XMP_HEADER + xml);

/** The XMP packet in a JPEG's APP1, if it has one. @param {Uint8Array} b */
export function findXmp(b) {
  const head = new TextEncoder().encode(XMP_HEADER);
  for (let i = 2; i + 4 < b.length && b[i] === 0xff;) {
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xda) break;
    if (m === 0xe1 && head.every((c, k) => b[i + 4 + k] === c)) return new TextDecoder().decode(b.subarray(i + 4 + head.length, i + 2 + len));
    i += 2 + len;
  }
  return null;
}
