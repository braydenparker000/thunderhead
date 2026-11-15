// The video element's own events: the first frame, waiting, pause and play,
// the clock (timeupdate), sound and speed. What each changes on screen.

export function bindVideo(p) {
  const v = p.video, ctl = p.ctl;
  v.addEventListener('playing', () => {
    if (!p.firstFrame) { p.firstFrame = true; p.loader.show(false); p.showControls(); }
    ctl.setBuffering(false); ctl.updatePlayState(); p.system.wake(true);
  });
  v.addEventListener('waiting', () => { if (p.firstFrame) ctl.setBuffering(true); });
  v.addEventListener('pause', () => {
    p.pausedAt = performance.now();
    ctl.updatePlayState(); p.system.wake(false); p.showControls(false); p.emitProgress(true);
  });
  v.addEventListener('play', () => { ctl.updatePlayState(); p.scheduleHide(); p.system.positionState(); });
  v.addEventListener('volumechange', () => { p.mutedChip.hidden = !(v.muted || v.volume === 0); });
  v.addEventListener('timeupdate', () => {
    if (p.firstFrame && !v.seeking && v.currentTime > 0) p.playedTo = v.currentTime;
    p.updateTime(); p.emitProgress(false);
  });
  v.addEventListener('progress', () => { if (p.ctl.showing) p.updateTime(); });
  v.addEventListener('durationchange', () => { p.updateTime(); p.system.positionState(); });
  v.addEventListener('seeked', () => p.system.positionState());
  v.addEventListener('ratechange', () => { p.speedBtn.textContent = `Speed ${p.touch.holding ? p.touch.holdBase : v.playbackRate}x`; p.system.positionState(); });
  v.addEventListener('ended', () => { p.showControls(false); p.emitProgress(true); });
}
