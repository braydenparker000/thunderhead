// Touch on the picture: tap to show or hide the controls, double tap to
// seek, hold to play faster, swipe across to seek, swipe up or down for
// brightness (left) and volume (right). Which of these a finger is doing is
// decided by gestures.js (Gesture); this file does what it decides.

import {clock, haptic} from '../ui/dom.js';
import * as G from './gestures.js';
import {FEEDBACK_MS} from './controls.js';
import {put} from './view.js';

const coarse = () => matchMedia('(pointer: coarse)').matches;

export class Surface {
  constructor(p) {
    this.p = p;
    this.g = new G.Gesture();
    this.holding = false;
    this.holdBase = 1;
    this.brightness = 1;
    this.lastTap = null; // a first tap on a side, waiting to see if a second follows
    this.streak = null; // a run of double-tap seeks on one side
    this.tapTimer = 0;
    this.holdTimer = 0;
    this.levelTimers = {}; // per bar: hiding it a moment after the swipe
    this.drag = null; // where a seek or level drag started from
    this.bind();
  }

  bind() {
    const p = this.p, s = p.surface;
    const at = e => { const r = s.getBoundingClientRect(); return {id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height}; };
    s.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const started = this.g.down({...at(e), gestures: p.prefs.gestures && !p.ctl.locked, canHold: !p.ctl.locked && !p.video.paused});
      if (!started) return; // a second finger: the first one's gesture goes on
      try { s.setPointerCapture(e.pointerId); } catch {}
      if (started.holdIn) this.holdTimer = setTimeout(() => this.act(this.g.hold()), started.holdIn);
    });
    s.addEventListener('pointermove', e => {
      const actions = this.g.move(at(e));
      if (this.g.p?.moved) clearTimeout(this.holdTimer); // past the slop: not a hold (Gesture has ruled it out too)
      for (const a of actions) this.act(a);
    });
    const end = e => {
      if (!this.g.active) return;
      const a = e.type === 'pointerup' ? this.g.up(at(e)) : this.g.cancel(e.pointerId);
      if (this.g.active) return; // another pointer's event
      clearTimeout(this.holdTimer);
      if (p.ctl.locked) { if (e.type === 'pointerup') p.ctl.showLockHint(); return; }
      this.act(a);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('lostpointercapture', end);
    s.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Does what the gesture decided. */
  act(a) {
    if (!a) return;
    const p = this.p;
    if (a.type === 'hold') this.startHold();
    else if (a.type === 'drag') { clearTimeout(this.holdTimer); this.startDrag(a.kind); }
    else if (a.type === 'seek') this.dragSeek(a.dx);
    else if (a.type === 'level') this.dragLevel(a.kind, a.dy);
    else if (a.type === 'end') {
      if (a.kind === 'hold') this.endHold();
      else if (a.kind === 'seek') this.endSeekDrag(a.cancelled);
      else this.endLevel(a.kind);
    } else if (a.type === 'tap' && !p.ctl.locked) this.tapAt(a.x, a.w);
  }

  /** A tap: on a side, perhaps the first of a double tap. */
  tapAt(x, w) {
    const p = this.p, zone = G.zoneOf(x, w), now = performance.now(), gestures = p.prefs.gestures;
    const step = zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP;
    if (gestures && zone !== 'center' && this.streak?.zone === zone && now - this.streak.t < G.STREAK_MS) {
      this.streak.t = now; this.streak.total += step;
      p.seekBy(step); p.flash(G.deltaLabel(this.streak.total), {kind: zone}); haptic(8);
      return;
    }
    if (gestures && zone !== 'center' && this.lastTap?.zone === zone && now - this.lastTap.t < G.DOUBLE_TAP_MS) {
      clearTimeout(this.tapTimer); this.lastTap = null;
      this.streak = {zone, t: now, total: step};
      p.seekBy(step); p.flash(G.deltaLabel(step), {kind: zone}); haptic(8);
      return;
    }
    this.streak = null;
    if (zone === 'center' || !gestures) { this.tap(zone); return; }
    this.lastTap = {zone, t: now};
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => { this.lastTap = null; this.tap(zone); }, G.DOUBLE_TAP_MS);
  }

  tap(zone) {
    const p = this.p;
    // Full screen is lost after picture-in-picture; a tap (a user gesture) restores it.
    if (p.system.wantFullscreen && !document.fullscreenElement && !p.system.minimized && coarse()) p.system.enterFullscreen();
    if (p.menus.open) return p.menus.dismiss();
    if (!p.ctl.visible) p.showControls();
    else if (zone === 'center' || p.firstFrame) p.hideControls();
  }

  startHold() {
    const p = this.p;
    this.holding = true;
    this.holdBase = p.video.playbackRate;
    p.video.playbackRate = p.prefs.holdSpeed;
    p.feedback.textContent = `${p.prefs.holdSpeed}x ▸▸`;
    p.feedback.className = 'ap-feedback show hold';
    haptic(15);
  }

  /** Back to the speed the viewer chose. */
  endHold() {
    if (!this.holding) return;
    const p = this.p;
    this.holding = false;
    p.video.playbackRate = this.holdBase || 1;
    p.feedback.className = 'ap-feedback';
  }

  startDrag(kind) {
    const p = this.p;
    if (kind === 'seek') { this.drag = {from: p.video.currentTime}; p.scrub.active = true; p.root.classList.add('seeking'); p.showControls(false); return; }
    clearTimeout(this.levelTimers[kind]); // a second swipe soon after the first keeps its bar
    this.drag = {level: kind === 'volume' ? (p.video.muted ? 0 : p.video.volume) : this.brightness};
    p.levelBars[kind].hidden = false;
  }

  dragSeek(dx) {
    const p = this.p, from = this.drag.from, d = p.video.duration;
    if (!Number.isFinite(d)) return; // a live stream has no length to swipe across
    const target = G.swipeTarget(from, dx, p.surface.clientWidth || 1, d || 0);
    p.scrub.time = target;
    const [b, span] = p.seekPreview.children;
    b.textContent = clock(target);
    span.textContent = G.deltaLabel(target - from);
    span.className = target >= from ? 'fwd' : 'back';
    p.seekPreview.hidden = false;
    p.updateTime();
  }

  endSeekDrag(cancelled) {
    const p = this.p;
    try { if (!cancelled && p.scrub.time != null && Number.isFinite(p.video.duration)) p.video.currentTime = p.scrub.time; } catch {}
    finally {
      p.scrub.time = null; p.scrub.active = false; this.drag = null;
      p.root.classList.remove('seeking');
      p.seekPreview.hidden = true;
    }
    p.updateTime(); p.scheduleHide();
  }

  dragLevel(kind, dy) {
    const p = this.p;
    const max = kind === 'brightness' ? 1.5 : 1;
    const value = G.dragLevel(this.drag.level, dy, p.surface.clientHeight || 1, max);
    if (kind === 'volume') { p.video.volume = value; p.video.muted = value === 0; }
    else this.setBrightness(value);
    const bar = p.levelBars[kind];
    bar.querySelector('span').textContent = Math.round(value * 100) + '%';
    bar.querySelector('i').style.transform = `scaleY(${value / max})`;
  }

  endLevel(kind) {
    this.drag = null;
    clearTimeout(this.levelTimers[kind]);
    this.levelTimers[kind] = setTimeout(() => { this.p.levelBars[kind].hidden = true; }, FEEDBACK_MS);
  }

  /**
   * A web page cannot change the screen's brightness, so this changes the
   * picture's: darker is a black layer over it, brighter a filter on the video
   * (a filter costs the phone's GPU, so it is there only while above 100 %).
   */
  setBrightness(value) {
    const p = this.p, at = Math.abs(value - 1) < 0.02 ? 1 : value;
    this.brightness = value;
    const dim = at < 1 ? (1 - at).toFixed(2) : '';
    put(p.dim, 'opacity', dim);
    put(p.video, 'filter', at > 1 ? `brightness(${at.toFixed(2)})` : '');
  }

  /** Ends whatever a finger is doing (a menu opened, the lock, closing): a hold gives the speed back, a seek drag is dropped. */
  abort() {
    clearTimeout(this.holdTimer);
    this.act(this.g.cancel());
    this.endHold();
  }

  /** A new title starts at the picture's own brightness. */
  reset() { this.setBrightness(1); }

  close() {
    this.abort();
    clearTimeout(this.tapTimer); this.lastTap = null; this.streak = null;
    for (const [kind, timer] of Object.entries(this.levelTimers)) { clearTimeout(timer); this.p.levelBars[kind].hidden = true; }
  }
}
