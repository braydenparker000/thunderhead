// The phone around the player: full screen and the screen's rotation,
// picture-in-picture, keeping the screen awake, the lock-screen controls
// (Media Session), and the app behind the player being out of reach.

import {pushLayer} from '../app/back-stack.js';

export const coarse = () => matchMedia('(pointer: coarse)').matches;

export class System {
  constructor(p) {
    this.p = p;
    this.wantFullscreen = false;
    this.wasFullscreen = false;
    this.orientation = null;
    this.minimized = false;
    this.wakeLock = null;
    this.inerted = null;
    // Android leaves full screen on the way into and out of the floating window; those changes are not back.
    this.pipUntil = 0;
    const pipMove = () => { this.pipUntil = performance.now() + 1500; };
    p.video.addEventListener('enterpictureinpicture', () => {
      pipMove();
      p.root.classList.add('in-pip');
      if (p.isOpen) this.minimize(); // also when Chrome moves it by itself on leaving the app
    });
    p.video.addEventListener('leavepictureinpicture', () => { pipMove(); this.leftPip(); });
    this.onFullscreen = () => this.fullscreenChanged();
  }

  /** The player opened: the app behind it is out of reach, back closes the player, and it goes full screen. */
  open() {
    const p = this.p;
    // Keyboard focus stays in the player: the app behind it is inert while it is open.
    this.inerted = [...p.parent.children].filter(el => el !== p.root && !el.inert);
    for (const el of this.inerted) el.inert = true;
    document.documentElement.classList.add('ap-open');
    p.popLayer = pushLayer('player', () => { p.popLayer = null; p.close('back'); });
    this.enterFullscreen();
    document.addEventListener('fullscreenchange', this.onFullscreen);
  }

  /** Locks the screen to the viewer's choice; 'auto' follows the phone. Needs full screen. */
  lockOrientation(kind = this.p.prefs.orientation, {announce = false} = {}) {
    const p = this.p;
    this.orientation = kind;
    const failed = () => { if (announce) p.flash('This screen cannot be turned from here'); };
    try {
      if (kind !== 'landscape' && kind !== 'portrait') { screen.orientation?.unlock?.(); return; }
      if (!screen.orientation?.lock) return failed();
      screen.orientation.lock(kind).then(() => { if (announce) p.flash(kind === 'landscape' ? 'Landscape' : 'Portrait'); }, failed);
    } catch { failed(); }
  }

  /** Turns the player to the other orientation for this session. */
  rotate() {
    const p = this.p;
    const target = p.root.clientHeight > p.root.clientWidth ? 'landscape' : 'portrait';
    if (document.fullscreenElement) this.lockOrientation(target, {announce: true});
    else this.enterFullscreen(target, {announce: true});
    p.showControls();
  }

  /**
   * Picture-in-picture: the video moves to the system's floating window and
   * the player gets out of the way so the app can be used; tapping the
   * window's expand control brings the player back.
   */
  async togglePip() {
    const p = this.p;
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
    this.pipUntil = performance.now() + 3000;
    try {
      await p.video.requestPictureInPicture();
      this.minimize();
    } catch { this.pipUntil = 0; p.flash('Picture-in-picture is not available here'); }
  }

  minimize() {
    const p = this.p;
    if (this.minimized || !p.isOpen) return;
    this.minimized = true;
    p.menus.dismiss(true);
    this.wantFullscreen = false;
    if (document.fullscreenElement === p.root) document.exitFullscreen().catch(() => {});
    p.root.classList.add('mini');
    document.documentElement.classList.remove('ap-open');
    const pop = p.popLayer; p.popLayer = null; pop?.(); // back belongs to the app again
    removeEventListener('keydown', p.onKey);
  }

  /**
   * The floating window went away. Closing it (Chrome pauses the video just
   * before) ends playback; expanding it brings the player back, paused or not.
   */
  leftPip() {
    const p = this.p;
    p.root.classList.remove('in-pip');
    if (!this.minimized) return;
    // Decided a moment later: the pause that comes with closing may be dispatched just after this event.
    setTimeout(() => {
      if (!this.minimized) return;
      const closed = p.video.ended || (p.video.paused && performance.now() - (p.pausedAt || 0) < 400);
      if (closed) { this.minimized = false; p.root.classList.remove('mini'); p.close('pip'); return; }
      this.restoreFromPip();
    });
  }

  restoreFromPip({exit = false} = {}) {
    const p = this.p;
    if (!this.minimized) return;
    this.minimized = false;
    if (exit && document.pictureInPictureElement === p.video) document.exitPictureInPicture().catch(() => {});
    p.root.classList.remove('mini');
    document.documentElement.classList.add('ap-open');
    if (!p.popLayer) p.popLayer = pushLayer('player', () => { p.popLayer = null; p.close('back'); });
    addEventListener('keydown', p.onKey);
    this.wantFullscreen = true; // the next tap goes full screen again
    p.showControls();
  }

  enterFullscreen(orientation = this.orientation || this.p.prefs.orientation, {announce = false} = {}) {
    const p = this.p;
    this.wantFullscreen = true;
    const el = p.root;
    const failed = () => { if (announce) p.flash('This screen cannot be turned from here'); };
    if (!el.requestFullscreen || document.fullscreenElement) return failed();
    el.requestFullscreen({navigationUI: 'hide'}).then(() => {
      this.wasFullscreen = true;
      this.lockOrientation(orientation, {announce});
    }).catch(failed);
  }

  exitFullscreen() {
    this.wantFullscreen = false;
    try { screen.orientation?.unlock?.(); } catch {}
    if (document.fullscreenElement === this.p.root) document.exitFullscreen().catch(() => {});
    this.wasFullscreen = false;
  }

  toggleFullscreen() { if (document.fullscreenElement) this.exitFullscreen(); else this.enterFullscreen(); }

  fullscreenChanged() {
    const p = this.p;
    // On a phone, leaving full screen is the back button. Like back anywhere
    // else it closes what is open first (a menu or a panel); locked, it closes
    // nothing. The next tap goes full screen again. Only then does it close
    // the player, as Nuvio's does.
    if (document.fullscreenElement || !this.wasFullscreen || !p.isOpen || !this.wantFullscreen || this.minimized || document.pictureInPictureElement || !coarse()) return;
    if (performance.now() < this.pipUntil || p.root.classList.contains('in-pip')) return; // moving to or from the floating window
    if (p.menus.open) { p.menus.dismiss(); return; }
    if (p.ctl.locked) { p.ctl.showLockHint(); return; }
    p.close('back');
  }

  async wake(on) {
    try {
      if (on && !this.wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; }
    } catch { this.wakeLock = null; }
  }

  mediaSession() {
    const p = this.p, ms = navigator.mediaSession;
    if (!ms) return;
    const m = p.meta;
    try {
      ms.metadata = new MediaMetadata({title: m.episodeLine ? `${m.title} · ${m.episodeLine}` : m.title || 'Astra', artist: 'Astra', artwork: [m.poster, m.background].filter(Boolean).map(src => ({src}))});
      const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch {} };
      set('play', () => p.video.play());
      set('pause', () => p.video.pause());
      set('seekbackward', d => p.seekBy(-(d?.seekOffset || 10)));
      set('seekforward', d => p.seekBy(d?.seekOffset || 10));
      set('seekto', d => { if (d?.seekTime != null) p.video.currentTime = d.seekTime; });
      set('nexttrack', p.options.next ? () => p.markers.playNext() : null);
      // Where the browser offers it, leaving the app while playing opens picture-in-picture.
      set('enterpictureinpicture', p.prefs.autoPip ? () => p.video.requestPictureInPicture().catch(() => {}) : null);
    } catch {}
    try { p.video.autoPictureInPicture = !!p.prefs.autoPip; } catch {}
  }

  positionState() {
    const p = this.p, d = p.video.duration;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(d) || !(d > 0)) return;
    try { navigator.mediaSession.setPositionState({duration: d, position: Math.min(d, p.video.currentTime), playbackRate: p.video.playbackRate || 1}); } catch {}
  }

  /** The player closed: the app is in reach again, and the phone is as it was. */
  close() {
    const p = this.p;
    for (const el of this.inerted || []) el.inert = false;
    this.inerted = null;
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    this.exitFullscreen();
    this.wake(false);
    try { navigator.mediaSession.metadata = null; } catch {}
    if (document.pictureInPictureElement === p.video) document.exitPictureInPicture().catch(() => {});
    this.minimized = false;
    this.orientation = null; // a rotate-button choice lasts until the player closes
    p.root.classList.remove('mini', 'in-pip');
    document.documentElement.classList.remove('ap-open');
  }
}
