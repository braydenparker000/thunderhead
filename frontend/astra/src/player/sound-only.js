// Sound only (Playback menu): the picture is covered with black, which an
// OLED screen barely lights, showing the title, the time, play/pause and
// "Show picture". The screen is let go (no wake lock), so the phone may
// sleep, and leaving the app does not open picture-in-picture. When the page
// is hidden and Chrome pauses the film, that is left alone: the lock screen's
// play (Media Session, system.js) resumes it. It lasts until the player
// closes or "Show picture".

import {icon} from '../ui/icons.js';
import {clock, h} from '../ui/dom.js';

export class SoundOnly {
  constructor(p) {
    this.p = p;
    this.on = false;
    this.title = h('p', {class: 'ap-so-title'});
    this.time = h('p', {class: 'ap-so-time'});
    this.play = h('button', {class: 'ap-icon-btn ap-so-play', type: 'button', onclick: () => p.togglePlay()});
    p.soundCover.append(h('div', {class: 'ap-so-box'}, this.title, this.time,
      h('div', {class: 'ap-so-actions'}, this.play, h('button', {class: 'ap-chip', type: 'button', onclick: () => this.set(false)}, 'Show picture'))));
    const v = p.video;
    v.addEventListener('timeupdate', () => { if (this.on) this.update(); });
    for (const type of ['play', 'pause']) v.addEventListener(type, () => { if (this.on) this.update(); });
  }

  update() {
    const v = this.p.video, d = v.duration, paused = v.paused;
    const text = Number.isFinite(d) && d > 0 ? `${clock(v.currentTime)} / ${clock(d)}` : clock(v.currentTime);
    if (this.time.textContent !== text) this.time.textContent = text;
    const label = paused ? 'Play' : 'Pause';
    if (this.play.getAttribute('aria-label') !== label) { this.play.setAttribute('aria-label', label); this.play.replaceChildren(icon(paused ? 'play' : 'pause', {size: 30})); }
  }

  /** The title shown (again for the next episode). */
  named() { const m = this.p.meta || {}; this.title.textContent = [m.title, m.episodeLine].filter(Boolean).join(' · '); }

  set(on) {
    const p = this.p;
    if (this.on === on) return;
    this.on = on;
    this.named();
    p.soundCover.hidden = !on;
    p.root.classList.toggle('sound-only', on);
    if (on) { p.touch.abort(); p.menus.dismiss(); this.update(); p.soundCover.querySelector('.ap-chip').focus({preventScroll: true}); }
    if (!p.isOpen) return; // closing: the player lets go of the phone itself
    p.system.wake(on ? false : !p.video.paused); // system.wake refuses the lock while this is on
    p.system.mediaSession(); // picture-in-picture on leaving the app: off while on
    if (!on) p.showControls();
  }

  close() { this.set(false); }
}
