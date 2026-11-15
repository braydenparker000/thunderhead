// What shows over the picture and when: the controls and their hide timer,
// the "You're watching" overlay after a pause, the short message in the
// middle, the play button, the buffering spinner and the lock.

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';

const HIDE_AFTER = 3500;
const PAUSE_OVERLAY_AFTER = 5000;
export const FEEDBACK_MS = 900;

export class Controls {
  constructor(p) {
    this.p = p;
    this.visible = false;
    this.locked = false;
    this.buffering = false;
    // Moving through the controls with Tab shows them.
    p.controls.addEventListener('focusin', () => { if (!this.visible && !this.locked) this.show(); });
  }

  updatePlayState() {
    const p = this.p, paused = p.video.paused;
    const btn = p.playBtn;
    btn.replaceChildren(icon(paused ? 'play' : 'pause', {size: 34}));
    btn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    btn.title = paused ? 'Play' : 'Pause';
    p.viaEl.classList.toggle('off', !paused); // hidden but keeping its room, so the title does not jump
    p.root.classList.toggle('paused', paused);
  }

  /**
   * Waiting for data: a spinner of its own, over the picture whether or not
   * the controls show, after 400 ms (a short wait shows nothing). The controls
   * are left as they are, so a double-tap seek or a slow host does not keep
   * popping them up.
   */
  setBuffering(on) {
    const p = this.p;
    this.buffering = on;
    clearTimeout(this.bufferTimer);
    if (on) this.bufferTimer = setTimeout(() => { p.spinner.hidden = false; p.playBtn.hidden = true; }, 400);
    else { p.spinner.hidden = true; p.playBtn.hidden = false; this.scheduleHide(); }
  }

  show(autoHide = true) {
    const p = this.p;
    if (this.locked) return;
    this.visible = true;
    p.root.classList.add('controls');
    p.pauseOverlay.hidden = true;
    p.markers.skipHiddenByTimer = false;
    if (autoHide) this.scheduleHide(); else clearTimeout(this.hideTimer); // an earlier timer must not hide what should stay
    p.markers.updateSkip(p.video.currentTime);
  }

  hide() {
    const p = this.p;
    this.visible = false;
    p.root.classList.remove('controls');
    clearTimeout(this.hideTimer);
    if (p.video.paused && p.prefs.pauseOverlay) this.schedulePauseOverlay();
  }

  scheduleHide() {
    const p = this.p;
    clearTimeout(this.hideTimer);
    if (p.video.paused || this.buffering || p.scrub.active || p.menus.open || !p.errorCard.hidden) return;
    this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER);
  }

  schedulePauseOverlay() {
    const p = this.p;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      if (!p.video.paused || this.visible || this.locked || p.menus.open || !p.firstFrame) return;
      const m = p.meta;
      p.pauseOverlay.replaceChildren(h('div', {class: 'ap-pause-text'},
        h('p', {class: 'ap-pause-kicker'}, "You're watching"),
        m.logo ? h('img', {src: m.logo, alt: m.title || '', referrerpolicy: 'no-referrer'}) : h('h3', {}, m.title || ''),
        m.episodeLine ? h('p', {class: 'ap-pause-episode'}, m.episodeLine) : null,
        m.description ? h('p', {class: 'ap-pause-description'}, m.description) : null));
      p.pauseOverlay.hidden = false;
    }, PAUSE_OVERLAY_AFTER);
  }

  flash(text, {kind = 'center'} = {}) {
    const p = this.p;
    p.feedback.textContent = text;
    p.feedback.className = 'ap-feedback show ' + kind;
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => { p.feedback.className = 'ap-feedback'; }, FEEDBACK_MS);
  }

  setLocked(on) {
    const p = this.p;
    this.locked = on;
    p.root.classList.toggle('locked', on);
    p.lockOverlay.hidden = true;
    if (on) { p.menus.dismiss(); this.hide(); this.flash('Controls locked'); }
    else this.show();
  }

  showLockHint() {
    const p = this.p;
    p.lockOverlay.hidden = false;
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => { p.lockOverlay.hidden = true; }, 2000);
  }

  /** The player closed. */
  close() {
    clearTimeout(this.hideTimer); clearTimeout(this.pauseTimer); clearTimeout(this.feedbackTimer);
  }
}
