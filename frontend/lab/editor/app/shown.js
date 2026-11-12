// @ts-check
// What a board shows of the photo (docs/design/EDITOR.md). In the app (boot.js, photos on this phone) that is the
// open photo, or the one being opened, by its own name: never the design's sample (its picture, DSCF0412, its
// made-up values), which plays only on a screen of the design on its own (/lab/editor/screens/). A photo asked for
// is named at once, with "Opening…", and its camera JPEG is decoded before it is shown, so the photo before is
// never seen under the new name (session.js `open`).
import { current, geo, kindLine, ready, stem, uncropped } from './session.js';
import { frame, isNone } from '../../engine/crop.js';
import { jpegUrl } from './store.js';

/** Whether this is the app, not a screen of the design on its own. */
export const app = document.body.dataset.board === 'App';
/** The photo asked for, from the tap until it is the open one (session.js `open` sets and clears it). */
export const opening = { id: '', name: '' };
const SAMPLE = { fileName: 'DSCF0412', shotLine: '23 mm · f/5.6 · 1/250 · ISO 160' };

/** For a board's header and photo: whether the open photo shows (`real`), whether the design's sample plays
 * (`demo`: never in the app), the name and the line under it, and a word on the photo (`status`). */
export function face() {
  const cur = current(), next = !!opening.id && opening.id !== cur?.id;
  if (cur && !next) return { real: true, demo: false, fileName: stem(cur.name), shotLine: kindLine(), status: cur.status };
  if (!app) return { real: false, demo: true, ...SAMPLE, status: '' };
  return { real: false, demo: false, fileName: next ? stem(opening.name) : '', shotLine: '', status: next ? 'Opening…' : 'No photo open · pick one in the Library' };
}
/** The open photo, unless another is being opened (a board then shows no photo's values). */
export const shownPhoto = () => (face().real ? current() : null);

/** The photo's camera JPEG, decoded, ready to be shown the moment it is put on: its URL. @param {string} id */
export async function preview(id) {
  const url = await jpegUrl(id) || '', im = new Image();
  im.src = url;
  await im.decode().catch(() => {});   // a picture that will not decode shows as it can
  return url;
}

/** The picture's size as an export makes it before its long edge is set (engine/warp.js `geometry`: the crop's frame
 * in whole editing-copy pixels, a third of the sensor's), for the crop `g` (the photo's own when not given): Crop and
 * Export both say this one. Null until the photo's size is known. @param {import('../../engine/crop.js').Crop | null} [g] */
export function outSize(g = geo()) {
  if (!ready) return null;
  const [w, h] = uncropped();
  if (!g || isNone(g)) return [w, h];
  const c = frame(g, w, h), whole = (/** @type {number} */ v) => Math.max(8 * CELL, Math.round(v / CELL) * CELL);
  return [whole(c.ow), whole(c.oh)];
}
const CELL = 3;   // sensor pixels to an editing-copy pixel (engine/picture.js, the decoder)
