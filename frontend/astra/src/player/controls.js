// What shows over the picture and when: the controls and their hide timer,
// the "You're watching" overlay after a pause, the short message in the
// middle, the play button, the buffering spinner and the lock. Whatever is
// covered (by a menu, the loading screen or the error card) is inert, so
// Tab and a screen reader stay on what can be seen.
//
// The controls come and go as groups (FEEL.md): the top bar from the top edge, the transport from the
// centre, the bar from the bottom, 8 px and a fade over --t-fast (feel.js restyle: interrupted, they
// turn back from where they are). They hide after the "Hide controls after" setting (3 s), never while a
// menu is open, a drag is under way or the film waits, and never while paused unless "Hide while
// paused" is on; never while a finger is on the screen (the hide waits for the lift). Waiting for data
// mid-film is a thin moving line at the bar, and words after WORDS_AFTER (no spinner over the picture).

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {restyle, appear, leave, arrive, ghost, gone} from './feel.js';

const PAUSE_OVERLAY_AFTER = 5000;
export const FEEDBACK_MS = 900;
export const LINE_AFTER = 400; // a short wait shows nothing
export const WORDS_AFTER = 2000;
/** The hide timer for the owner's setting (seconds; 0 is never). */
export const hideAfter = prefs => { const s = Number(prefs?.controlsHideAfter); return Number.isFinite(s) && s >= 0 ? s * 1000 : 3000; };

export class Controls {
  constructor(p) {
    this.p = p;
    this.visible = false;
    this.locked = false;
    this.buffering = false;
    this.hintAt = 0;
    this.fingers = new Set(); // pointers down anywhere on the player: nothing hides under them
    this.painted = false;
    // What moves as one when the controls come and go, and what rides above the bar with them.
    this.groups = ['.ap-shade-top', '.ap-shade-bottom', '.ap-top', '.ap-top-mid', '.ap-center', '.ap-bottom'].map(s => p.controls.querySelector(s));
    this.riders = [p.skipBtn, p.nextCard, p.noticeEl, p.waitBox];
    for (const type of ['pointerup', 'pointercancel']) p.root.addEventListener(type, e => this.fingers.delete(e.pointerId), {capture: true});
    p.root.addEventListener('pointerdown', e => this.fingers.add(e.pointerId), {capture: true});
    // Moving through the controls with Tab shows them.
    p.controls.addEventListener('focusin', () => { if (!this.visible && !this.locked) this.show(); });
    // Any touch or key on the controls (±10, the time, More, scrolling the row) restarts the hide timer.
    const busy = () => { if (this.visible) this.scheduleHide(); };
    p.controls.addEventListener('pointerdown', busy, {capture: true});
    p.controls.addEventListener('keydown', busy, {capture: true});
    p.actions.addEventListener('scroll', busy, {passive: true});
    new MutationObserver(() => this.cover()).observe(p.root, {subtree: true, attributeFilter: ['hidden', 'data-leaving']});
  }

  /** What the loading screen, the error card or a menu covers is out of reach. */
  cover() {
    const p = this.p, up = el => !el.hidden && el.dataset.leaving == null;
    const covered = up(p.loading) || up(p.errorCard) || up(p.modal) || up(p.panel);
    for (const el of [p.controls, p.skipBtn, p.nextCard, p.mutedChip]) if (el.inert !== covered) el.inert = covered;
  }

  /** Whether anything that shows the play position is on screen (the controls, or the lock's line). */
  get showing() { return this.visible || (this.locked && this.p.lockOverlay.classList.contains('show')); }

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
   * Waiting for data: after LINE_AFTER a thin line moves along the bar (along the bottom edge while
   * the controls are hidden), and after WORDS_AFTER words say so (loading.js puts how long a slow link
   * has left there). The controls are left as they are, so a double-tap seek or a slow host does not
   * keep popping them up, and the play button stays where it is.
   */
  setBuffering(on) {
    const p = this.p;
    this.buffering = on;
    clearTimeout(this.bufferTimer); clearTimeout(this.wordsTimer);
    if (on) {
      if (!gone(p.waitBox)) return;
      this.bufferTimer = setTimeout(() => { p.waitWords.hidden = true; arrive(p.waitBox, {name: 'player:waiting'}); }, LINE_AFTER);
      this.wordsTimer = setTimeout(() => { p.waitWords.hidden = false; appear(p.waitWords, {name: 'player:waiting-words', offset: 'translateY(6px)', ms: 150, curve: 'snappy'}); }, WORDS_AFTER);
    } else { leave(p.waitBox, {name: 'player:waited'}); this.scheduleHide(); }
  }

  /**
   * The groups move to what the state now says: shown while `visible` and no menu covers them.
   * `change` (optional) makes the state change (a class) inside the same measured step.
   */
  paint(change = null) {
    const p = this.p;
    // Under the opening's dim nothing of them shows (player.css .ap.opening): the state changes with no
    // movement to measure, so no style pass is forced while the dim is being drawn; they come with the picture.
    if (p.root.classList.contains('opening')) { change?.(); p.root.classList.toggle('controls', this.visible); return; }
    restyle([...this.groups, ...this.riders], () => {
      change?.();
      p.root.classList.toggle('controls', this.visible);
    }, {name: this.visible ? 'controls:show' : 'controls:hide'});
  }

  show(autoHide = true) {
    const p = this.p;
    if (this.locked) return;
    const was = this.visible;
    this.visible = true;
    if (!was) this.paint();
    if (!p.pauseOverlay.hidden) { ghost(p.pauseOverlay, {name: 'pause-overlay:out'}); p.pauseOverlay.hidden = true; }
    p.markers.skipHiddenByTimer = false;
    if (autoHide) this.scheduleHide(); else clearTimeout(this.hideTimer); // an earlier timer must not hide what should stay
    p.updateTime(); // the bar is not kept up to date while hidden
  }

  hide() {
    const p = this.p;
    const was = this.visible;
    this.visible = false;
    if (was) this.paint(); else p.root.classList.remove('controls');
    clearTimeout(this.hideTimer);
    if (p.video.paused && p.prefs.pauseOverlay) this.schedulePauseOverlay();
  }

  scheduleHide() {
    const p = this.p;
    clearTimeout(this.hideTimer);
    const ms = hideAfter(p.prefs);
    if (!ms || (p.video.paused && !p.prefs.controlsHidePaused) || this.buffering || p.scrub.active || p.menus.open || !p.errorCard.hidden) return;
    // A finger still on the screen: the hide waits for the lift (looked at again a moment later).
    const run = () => { if (this.fingers.size) this.hideTimer = setTimeout(run, 400); else this.hide(); };
    this.hideTimer = setTimeout(run, ms);
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
      appear(p.pauseOverlay.firstChild, {name: 'pause-overlay:in', offset: 'translateY(12px)'});
    }, PAUSE_OVERLAY_AFTER);
  }

  flash(text, {kind = 'center'} = {}) {
    const p = this.p;
    p.feedback.textContent = text;
    p.feedback.className = 'ap-feedback show ' + kind;
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => { p.feedback.className = 'ap-feedback'; }, FEEDBACK_MS);
  }

  /**
   * Locked, Unlock stays in the page (unseen until a touch, or focused from
   * the keyboard), so there is always one thing that can be reached.
   */
  setLocked(on) {
    const p = this.p, focused = p.root.contains(document.activeElement);
    this.locked = on;
    p.root.classList.toggle('locked', on);
    clearTimeout(this.lockTimer);
    p.lockOverlay.classList.remove('show');
    p.lockOverlay.hidden = !on;
    if (on) {
      p.touch.abort(); p.menus.dismiss(); this.hide(); this.flash('Controls locked');
      if (focused) p.root.focus({preventScroll: true}); // the Lock button is gone: focus stays in the player
    } else this.show();
  }

  showLockHint() {
    const p = this.p;
    if (!p.lockOverlay.classList.contains('show')) this.hintAt = performance.now();
    p.lockOverlay.classList.add('show');
    p.updateTime();
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => p.lockOverlay.classList.remove('show'), 2000);
  }

  /** The tap that brings up the hint lands on Unlock as it appears: that one does not count, a second does (keys always do). */
  unlockPressed(e) {
    if (e.detail && performance.now() - this.hintAt < 350) return;
    this.setLocked(false);
  }

  /** The player closed: no timer left running, nothing left showing. */
  close() {
    const p = this.p;
    for (const t of [this.hideTimer, this.pauseTimer, this.feedbackTimer, this.bufferTimer, this.wordsTimer, this.lockTimer]) clearTimeout(t);
    this.buffering = false;
    p.waitBox.hidden = true; delete p.waitBox.dataset.leaving; p.waitBox.inert = false;
    p.pauseOverlay.hidden = true;
    p.feedback.className = 'ap-feedback';
    p.lockOverlay.classList.remove('show');
  }
}
