// The sleep timer: after 15 to 60 minutes, or at the end of the episode, the
// film pauses (a real pause, so its place is saved) and a notice says so.
// "End of episode" also keeps the next-episode card away (markers.js asks
// `episodeEnd`). It lives for one player session: a switch to the next
// episode keeps it, closing the player clears it, and it never runs while
// the player is closed. The maths is in rules.js.

import {sleepTimer, sleepLeft, sleepLabel} from './rules.js';

export class Sleep {
  constructor(p) {
    this.p = p;
    this.timer = null;
    this.choice = 0;
    this.tick = 0;
    p.video.addEventListener('ended', () => { if (this.timer?.episode && p.isOpen) this.fire(); });
  }

  get episodeEnd() { return !!this.timer?.episode; }

  /** 0 (off), minutes, or 'episode'. */
  set(choice) {
    clearInterval(this.tick); this.tick = 0;
    this.timer = sleepTimer(choice, performance.now());
    this.choice = this.timer ? choice : 0;
    if (this.timer) this.tick = setInterval(() => this.check(), 1000);
    this.show();
  }

  left() {
    const v = this.p.video;
    return sleepLeft(this.timer, {now: performance.now(), time: v.currentTime, duration: v.duration, rate: v.playbackRate});
  }

  check() {
    if (!this.p.isOpen) return this.clear();
    if (!this.timer.episode && this.left() <= 0) return this.fire();
    this.show();
  }

  fire() {
    const p = this.p;
    this.clear();
    if (!p.video.paused) p.video.pause(); // the pause saves the place
    else p.emitProgress(true);
    p.notice('Sleep timer: paused');
  }

  /** What is left, in the Playback menu and quietly at the top of the controls. */
  text() {
    if (!this.timer) return '';
    const left = this.left();
    if (this.timer.episode) return left == null ? 'Pauses at the end of this episode' : `Pauses at the end of this episode, in ${sleepLabel(left)}`;
    return `Pauses in ${sleepLabel(left)}`;
  }

  show() {
    const p = this.p, left = this.timer ? this.left() : null;
    const quiet = left == null ? (this.timer ? 'Sleep: end of episode' : '') : `Sleep ${sleepLabel(left)}`;
    if (p.sleepEl.textContent !== quiet) p.sleepEl.textContent = quiet;
    if (p.sleepEl.hidden === !!quiet) p.sleepEl.hidden = !quiet;
    const status = p.modal.querySelector('.ap-sleep-status');
    if (status && status.textContent !== this.text()) status.textContent = this.text();
  }

  clear() {
    clearInterval(this.tick); this.tick = 0;
    this.timer = null; this.choice = 0;
    this.show();
  }

  close() { this.clear(); }
}
