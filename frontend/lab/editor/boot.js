// @ts-check
// The editor test page (docs/design/EDITOR.md). Fits the design frame to the screen the way the app
// will: full width, and the photo area gives up whatever height the phone lacks (--cut, used by the
// boards' photo and plate positions), so the camera plate ends at the bottom of the screen.
// /lab/editor/ plays the screens as one app: Library first, EDIT › into the editor, the corner button
// raises the tool dock, Export from the header, back arrows and the phone's back gesture go back.
// /lab/editor/screens/ keeps each screen on its own page. Not wired to an engine.
import { mount } from './dc.js';

const frame = /** @type {HTMLElement} */ (document.getElementById('frame') || document.getElementById('stage'));
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const fit = () => {
  const vw = window.visualViewport?.width || innerWidth, vh = window.visualViewport?.height || innerHeight;
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
  veil.addEventListener('click', () => { dock.hidden = veil.hidden = true; });
  dock.addEventListener('click', (e) => { const b = /** @type {HTMLElement} */ (e.target).closest('button'); if (b?.dataset.go) go(b.dataset.go); });
  // The boards' own navigation buttons, taken over by the app (the boards stay exactly as designed).
  stage.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button,[role=button]');
    if (!b) return;
    const label = b.getAttribute('aria-label') || '', text = (b.textContent || '').trim();
    let to = '';
    if (label === 'Back to the tools') { e.stopPropagation(); e.preventDefault(); dock.hidden = veil.hidden = false; return; }
    if (label === 'Back to Photos' || label === 'Back to Library') to = 'Library';
    else if (label === 'Back to the editor') to = 'Edit';
    else if (text === 'Export' && b.closest('header')) to = 'Export';
    else if (text === 'EDIT ›') to = 'Edit';
    if (!to) return;
    e.stopPropagation(); e.preventDefault();
    go(to);
  }, true);
  history.replaceState({ name: 'Library' }, '');
  show('Library');
}
