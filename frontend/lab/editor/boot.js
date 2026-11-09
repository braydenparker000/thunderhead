// @ts-check
// The editor test page (docs/design/EDITOR.md): mounts the page's design board and fits its 412 × 915
// frame to the screen, centred, so it can be tried on the phone exactly as designed. Not wired to an engine.
import { mount } from './dc.js';

const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const fit = () => {
  const s = Math.min(innerWidth / 412, innerHeight / 915);
  stage.style.transform = `translate(${(innerWidth - 412 * s) / 2}px, ${(innerHeight - 915 * s) / 2}px) scale(${s})`;
};
addEventListener('resize', fit);
fit();
mount(stage, document.body.dataset.board || 'EditPlate');
