// The keyboard: space, arrows and letters, as on a desktop player. z and x
// move the subtitles 0.1 s earlier or later.

import {savePrefs} from './prefs.js';
import {nudgeDelay, delayText} from './subtitle-menu.js';
import {seekStep, stepLabel} from './gestures.js';

/** Handles a key press for the open player `p`. */
export function key(p, e) {
  if (!p.isOpen || e.target.closest?.('input, textarea')) return;
  const k = e.key;
  // Locked means locked, keys too; only the Unlock button can be reached and pressed.
  if (p.ctl.locked) { if (k !== 'Tab' && !e.target.closest?.('.ap-unlock')) { e.preventDefault(); p.ctl.showLockHint(); } return; }
  // Space and Enter on a focused button or the seek bar press that, not play/pause.
  if ((k === ' ' || k === 'Enter') && e.target.closest?.('button, [role="slider"]')) return;
  if (k === ' ' || k === 'k') { e.preventDefault(); p.togglePlay(); }
  else if (k === 'ArrowLeft' || k === 'j' || k === 'ArrowRight' || k === 'l') { // the double tap's step (Settings › Player)
    e.preventDefault();
    const by = (k === 'ArrowLeft' || k === 'j' ? -1 : 1) * seekStep(p.prefs);
    p.seekBy(by); p.flash(stepLabel(by), {kind: by < 0 ? 'left' : 'right'});
  }
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    p.video.volume = Math.max(0, Math.min(1, p.video.volume + (k === 'ArrowUp' ? 0.05 : -0.05)));
    p.video.muted = p.video.volume === 0;
    p.prefs.volume = p.video.volume; savePrefs(p.prefs);
    p.flash(`Volume ${Math.round(p.video.volume * 100)}%`);
  } else if (k === 'm') { p.video.muted = !p.video.muted; p.flash(p.video.muted ? 'Muted' : 'Sound on'); }
  else if (k === 'f') p.system.toggleFullscreen();
  else if (k === 'c') p.menus.openModal('subtitles');
  else if (k === 'z' || k === 'x') { p.flash('Subtitles ' + delayText(nudgeDelay(p, k === 'z' ? -0.1 : 0.1))); if (p.menus.modalName === 'subtitles') p.menus.renderModal(); }
  else if (k === 'Escape' && p.menus.open) p.menus.dismiss();
  else return;
  if (!p.menus.open) p.showControls();
}
