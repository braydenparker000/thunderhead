// The keyboard: space, arrows and letters, as on a desktop player.

/** Handles a key press for the open player `p`. */
export function key(p, e) {
  if (!p.isOpen || e.target.closest?.('input, textarea')) return;
  const k = e.key;
  // Locked means locked, keys too; only the Unlock button can be reached and pressed.
  if (p.ctl.locked) { if (k !== 'Tab' && !e.target.closest?.('.ap-unlock')) { e.preventDefault(); p.ctl.showLockHint(); } return; }
  // Space and Enter on a focused button or the seek bar press that, not play/pause.
  if ((k === ' ' || k === 'Enter') && e.target.closest?.('button, [role="slider"]')) return;
  if (k === ' ' || k === 'k') { e.preventDefault(); p.togglePlay(); }
  else if (k === 'ArrowLeft' || k === 'j') { e.preventDefault(); p.seekBy(-10); p.flash('−10s', {kind: 'left'}); }
  else if (k === 'ArrowRight' || k === 'l') { e.preventDefault(); p.seekBy(10); p.flash('+10s', {kind: 'right'}); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    p.video.volume = Math.max(0, Math.min(1, p.video.volume + (k === 'ArrowUp' ? 0.05 : -0.05)));
    p.video.muted = p.video.volume === 0;
    p.flash(`Volume ${Math.round(p.video.volume * 100)}%`);
  } else if (k === 'm') { p.video.muted = !p.video.muted; p.flash(p.video.muted ? 'Muted' : 'Sound on'); }
  else if (k === 'f') p.system.toggleFullscreen();
  else if (k === 'c') p.menus.openModal('subtitles');
  else if (k === 'Escape' && p.menus.open) p.menus.dismiss();
  else return;
  if (!p.menus.open) p.showControls();
}
