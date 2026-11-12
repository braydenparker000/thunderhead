// @ts-check
// Compare methods (/lab/editor/compare/): one photo from the editor's Library on this device, made by each way the
// engine has of turning sensor data into pixels (the classic demosaic looking twice or once, the network), beside
// the camera's own JPEG and any picture added here. Each is a layer of tiles made once and kept; switching only
// changes which layer shows. `?open=<photo id>` opens a photo; with none, the Library's photos to pick from.
import { init, jpegUrl, photos, urlNow } from '../app/store.js';
import * as photo from '../app/session.js';
import { isolate } from '../../engine/isolate.js';
import { S, changed, method } from './state.js';
import { TILE, letters } from './tiles.js';
import { pump, ready, show } from './render.js';
import { draw, flip, say, wire } from './controls.js';
import * as view from './view.js';

const SAMPLE = '/lab/editor/assets/sample.jpg';   // what the store answers for a photo with no camera JPEG
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** The Library's photos as a grid, each a link that opens it here. @param {ReturnType<typeof photos>} all */
function grid(all) {
  const list = $('grid');
  list.hidden = false; $('compare').hidden = true;
  if (!all.length) { $('status').textContent = 'No photos in the Library on this device yet. Add some in the editor first.'; return; }
  $('status').textContent = 'Pick a photo to compare.';
  for (const p of all) {
    const a = document.createElement('a'), img = document.createElement('img'), li = document.createElement('li');
    a.href = `?open=${encodeURIComponent(p.id)}`; img.src = urlNow(p.id); img.alt = photo.stem(p.name); img.loading = 'lazy';
    a.append(img); li.append(a); list.append(li);
  }
}

/** A picture as a bitmap, through an image element (blob: URLs are pictures to this page's CSP, not fetches). @param {string} url */
async function bitmapOf(url) {
  const img = new Image(); img.src = url; await img.decode();
  return createImageBitmap(img);
}

/** A method that lays a picture over the photo: the camera's JPEG, or a file added here.
 * @param {string} id @param {string} name @param {string} kind @param {ImageBitmap} src */
function addPicture(id, name, kind, src) {
  S.methods.push({ id, name, kind, src });
  if (!S.letters[id]) S.letters[id] = 'PQRSTUVWXYZ'.split('').find((l) => !Object.values(S.letters).includes(l)) || '?';
  view.layer(id);
}

let files = 0;
/** Pictures the owner adds, each a method of its own named by its file. @param {FileList | null} list */
async function addFiles(list) {
  for (const f of list ? [...list] : []) {
    let src = /** @type {ImageBitmap | null} */ (null);
    try { src = await createImageBitmap(f); } catch { say('This browser cannot read that file. Export it as JPEG or PNG.'); continue; }
    addPicture(`file${++files}`, f.name.replace(/\.[^.]+$/, '') || f.name, 'file', src);
  }
  pump(); changed();
}

/** Opens a photo, makes its methods, and starts on the tiles in view. @param {string} id */
async function open(id) {
  const p = photos().find((x) => x.id === id);
  if (!p) { say('That photo is not in the Library on this device.'); return; }
  $('title').textContent = photo.stem(p.name);
  /** @type {HTMLAnchorElement} */ (document.querySelector('.back')).href = `/lab/editor/?open=${encodeURIComponent(id)}`;   // back into this photo, not the Library
  say('Opening…');
  await photo.open(id);
  let big = photo.whole();
  for (let i = 0; !big && i < 6000; i++) {   // the sensor's pixels reach the GPU a while after the photo opens
    const st = photo.current()?.status || '';
    if (/^Couldn't|Error/i.test(st)) { say(st); return; }
    await sleep(50); big = photo.whole();
  }
  if (!big) { say('The photo did not open in time.'); return; }
  S.W = big.width; S.H = big.height;
  view.mount($('viewport'), pump, flip);
  for (const [mid, name, best] of /** @type {[string, string, true | 'twice' | 'once'][]} */ ([['classic', 'Classic', 'twice'], ['faster', 'Faster', 'once'], ['network', 'Network', true]])) {
    const v = await big.view(TILE, TILE, null, false, false, best);
    S.methods.push({ id: mid, name, kind: mid, view: v, off: best === true && !v.net });
    view.layer(mid);
  }
  S.letters = letters(S.methods.map((m) => m.id));
  S.a = S.shown = 'classic'; S.b = 'faster';
  // the camera's own JPEG: a RAF's, not a JPEG's (that is only its small copy) and not where there is none
  const url = p.kind === 'jpeg' ? SAMPLE : await jpegUrl(id);
  if (url && url !== SAMPLE) { try { addPicture('camera', 'Camera', 'camera', await bitmapOf(url)); S.letters = letters(S.methods.map((m) => m.id)); } catch (e) { console.warn('camera JPEG', e); } }
  say('');
  wire();
  pump();
}

// for tests: how many tiles the engine made, whether a method's tiles in view are ready, and what shows
/** @param {string} m a method's id or name */
const find = (m) => method(m) || S.methods.find((x) => x.name.toLowerCase() === m.toLowerCase());
Object.assign(window, { __compare: { get renders() { return S.renders; }, ready: (/** @type {string} */ m) => { const x = find(m); return !!x && ready(x.id); }, state: () => ({ zoom: view.zoom(), shown: S.shown, a: S.a, b: S.b }) } });

isolate('/lab/editor/compare/');
$('file').addEventListener('change', () => { const i = /** @type {HTMLInputElement} */ ($('file')); addFiles(i.files).finally(() => { i.value = ''; }); });
const wanted = new URLSearchParams(location.search).get('open');
init().then((all) => (wanted ? open(wanted) : grid(all)), (e) => say(`The Library could not be read: ${e?.message || e}`)).catch((e) => { console.error('compare', e); say(String(e?.message || e)); });
show(); draw();
