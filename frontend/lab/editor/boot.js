// @ts-check
// The editor test page (docs/design/EDITOR.md). Fits the design frame to the screen the way the app
// will: full width, and the photo area gives up whatever height the phone lacks (--cut, used by the
// boards' photo and plate positions), so the camera plate ends at the bottom of the screen.
// /lab/editor/ plays the screens as one app: Library first, EDIT › into the editor, the corner button
// raises the tool dock, Export from the header, back arrows and the phone's back gesture go back.
// /lab/editor/screens/ keeps each screen on its own page. The app is wired to the engine (app/session.js):
// imported RAFs live on the phone (app/store.js) and open, developed, in Edit.
import { mount } from './dc.js';
import { init } from './app/store.js';
import { undo } from './app/session.js';
import { isolate } from '../engine/isolate.js';

const frame = /** @type {HTMLElement} */ (document.getElementById('frame') || document.getElementById('stage'));
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const fit = () => {
  // the layout's size: a page the browser has magnified is not a smaller screen (the app's own zoom is the photo's)
  const m = window.visualViewport?.scale || 1, vw = (window.visualViewport?.width || innerWidth) * m, vh = (window.visualViewport?.height || innerHeight) * m;
  const s = vw / 412, cut = Math.max(0, Math.min(260, 915 - vh / s));
  frame.style.setProperty('--cut', `${cut}px`);
  frame.style.height = `${915 - cut}px`;
  frame.style.transform = `translateY(${Math.max(0, (vh - (915 - cut) * s) / 2)}px) scale(${s})`;
};
addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);
fit();

const board = document.body.dataset.board || 'EditPlate';
if (board !== 'App') mount(stage, board);
else {
  // the app decodes RAFs on every core once the page is cross-origin isolated (the screens pages don't decode)
  isolate('/lab/editor/');
  const BOARDS = /** @type {Record<string, string>} */ ({ Library: 'LibraryPlate', Edit: 'EditPlate', Crop: 'CropPlate', Masks: 'MaskPlate', Looks: 'LooksPlate', Heal: 'HealPlate', Versions: 'ViewTools', Export: 'ExportPlate' });
  const dock = /** @type {HTMLElement} */ (document.getElementById('dock')), veil = /** @type {HTMLElement} */ (document.getElementById('dockveil'));
  let current = '';
  const show = (/** @type {string} */ name) => {
    current = name;
    dock.hidden = veil.hidden = true;
    for (const b of dock.querySelectorAll('button')) b.setAttribute('aria-current', b.dataset.go === name ? 'page' : 'false');
    stage.replaceChildren();
    stage.classList.remove('enter'); void stage.offsetWidth; stage.classList.add('enter');
    mount(stage, BOARDS[name]);
  };
  const go = (/** @type {string} */ name) => { if (name === current) { dock.hidden = veil.hidden = true; return; } history.pushState({ name }, ''); show(name); };
  addEventListener('popstate', (e) => show(e.state?.name || 'Library'));
  document.addEventListener('editor:open', (e) => go(/** @type {CustomEvent} */ (e).detail || 'Edit'));
  veil.addEventListener('click', () => { dock.hidden = veil.hidden = true; });
  dock.addEventListener('click', (e) => { const b = /** @type {HTMLElement} */ (e.target).closest('button'); if (b?.dataset.go) go(b.dataset.go); });
  // The boards' own navigation buttons, taken over by the app (the boards stay exactly as designed).
  stage.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button,[role=button]');
    if (!b) return;
    const label = b.getAttribute('aria-label') || '', text = (b.textContent || '').trim();
    let to = '';
    if (label === 'Undo') { undo(); return; }
    if (label === 'Back to the tools') { e.stopPropagation(); e.preventDefault(); dock.hidden = veil.hidden = false; return; }
    if (label === 'Back to Photos' || label === 'Back to Library') to = 'Library';
    else if (label === 'Show histogram') to = 'Versions';   // the View board holds the histogram and its clipping
    else if (label === 'Back to the editor') to = 'Edit';
    else if (text === 'Export' && b.closest('header')) to = 'Export';
    else if (text === 'EDIT ›') to = 'Edit';
    if (!to) return;
    e.stopPropagation(); e.preventDefault();
    go(to);
  }, true);
  addEventListener('contextmenu', (e) => { if (!(/** @type {HTMLElement} */ (e.target)).closest('input, textarea')) e.preventDefault(); });   // a long press is the app's own (hold to compare), not the browser's menu
  history.replaceState({ name: 'Library' }, '');
  // the Library shows the photos on this phone, so read them first (none yet: the design's sample roll)
  init().catch((e) => console.warn('photos:', e)).finally(() => show('Library'));
}
