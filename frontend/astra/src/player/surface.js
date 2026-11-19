// Touch on the picture: tap to show or hide the controls, double tap to
// seek, hold to play faster, swipe across to seek, swipe up or down for
// brightness (left) and volume (right), pinch to zoom and, zoomed, drag to
// move the picture (zoom.js). Which of these a finger is doing is
// decided by gestures.js (Gesture); this file does what it decides, and
// gauges.js draws its answer (the ripple, the gauges, the seek readout).
// Each gesture has its own switch in Settings › Player (prefs gestureDoubleTap,
// gestureSwipeSeek, gestureBrightness, gestureVolume, gestureHold,
// gesturePinch), under the one that turns them all off (gestures).

import {clock, h} from '../ui/dom.js';
import * as G from './gestures.js';
import {put} from './view.js';
import {savePrefs} from './prefs.js';
import {Zoom} from './zoom.js';
import {Gauges} from './gauges.js';
import {tick} from './feel.js';

/** Whether a gesture is on: all of them (gestures), and its own switch. */
export const allowed = (prefs, own) => prefs.gestures !== false && prefs[own] !== false;

const coarse = () => matchMedia('(pointer: coarse)').matches;

export class Surface {
  constructor(p) {
    this.p = p;
    this.g = new G.Gesture();
    this.zoom = new Zoom(p);
    this.gauges = new Gauges(p);
    this.holding = false;
    this.holdBase = 1;
    this.brightness = 1;
    this.lastTap = null; // a first tap on a side, waiting to see if a second follows
    this.streak = null; // a run of double-tap seeks on one side
    this.tapTimer = 0;
    this.holdTimer = 0;
    this.drag = null; // where a seek or level drag started from
    this.bind();
  }

  bind() {
    const p = this.p, s = p.surface;
    const at = e => { const r = s.getBoundingClientRect(); return {id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height}; };
    s.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (!this.g.active) this.downY = at(e).y; // where a tap lands, for the ripple's wave
      const free = p.prefs.gestures && !p.ctl.locked, on = own => allowed(p.prefs, own);
      const allow = {seek: on('gestureSwipeSeek'), brightness: on('gestureBrightness'), volume: on('gestureVolume')};
      const started = this.g.down({...at(e), gestures: free, canHold: !p.ctl.locked && !p.video.paused && on('gestureHold'), zoom: free && on('gesturePinch'), zoomed: this.zoom.zoomed, allow});
      if (!started) return; // a finger too late to pinch: the first one's gesture goes on
      try { s.setPointerCapture(e.pointerId); } catch {}
      if (started.pinch) { clearTimeout(this.holdTimer); this.zoom.startPinch(); return; }
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
      if (this.g.active) { this.act(a); return; } // one finger of a pinch (which ends it), or an ignored finger (nothing)
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
    else if (a.type === 'drag') { clearTimeout(this.holdTimer); if (a.kind === 'pan') this.zoom.startPan(); else this.startDrag(a.kind); }
    else if (a.type === 'seek') this.dragSeek(a.dx);
    else if (a.type === 'level') this.dragLevel(a.kind, a.dy);
    else if (a.type === 'pinch') this.zoom.pinch(a);
    else if (a.type === 'pan') this.zoom.pan(a.dx, a.dy);
    else if (a.type === 'end') {
      if (a.kind === 'hold') this.endHold();
      else if (a.kind === 'seek') this.endSeekDrag(a.cancelled);
      else if (a.kind === 'pinch') this.zoom.endPinch();
      else if (a.kind === 'pan') this.zoom.endPan();
      else this.endLevel(a.kind);
    } else if (a.type === 'tap' && !p.ctl.locked) this.tapAt(a.x, a.w, this.downY);
  }

  /** A tap: on a side, perhaps the first of a double tap. */
  tapAt(x, w, y = 0) {
    const p = this.p, zone = G.zoneOf(x, w), now = performance.now(), gestures = allowed(p.prefs, 'gestureDoubleTap');
    const step = (zone === 'left' ? -1 : 1) * G.seekStep(p.prefs);
    const r = p.surface.getBoundingClientRect(), seek = total => { p.seekBy(step); this.gauges.seek(zone, total, r.left + x, r.top + y); tick('select'); };
    if (gestures && zone !== 'center' && this.streak?.zone === zone && now - this.streak.t < G.STREAK_MS) {
      this.streak.t = now; this.streak.total += step;
      seek(this.streak.total);
      return;
    }
    if (gestures && zone !== 'center' && this.lastTap?.zone === zone && now - this.lastTap.t < G.DOUBLE_TAP_MS) {
      clearTimeout(this.tapTimer); this.lastTap = null;
      this.streak = {zone, t: now, total: step};
      seek(step);
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
    this.holdBase = p.prefs.speed || p.video.playbackRate; // the chosen speed, which the lift goes back to
    p.video.playbackRate = p.prefs.holdSpeed;
    p.feedback.replaceChildren(h('b', {}, `${p.prefs.holdSpeed}×`), h('span', {class: 'ap-hold-arrows', 'aria-hidden': 'true'}, h('i', {}, '▸'), h('i', {}, '▸')));
    clearTimeout(p.ctl.feedbackTimer);
    p.feedback.className = 'ap-feedback show hold';
    tick('lift');
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
    this.drag = {level: kind === 'volume' ? (p.video.muted ? 0 : p.video.volume) : this.brightness};
    this.gauges.level(kind, this.drag.level, kind === 'brightness' ? 1.5 : 1);
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
    this.gauges.preview(true);
    p.updateTime();
  }

  endSeekDrag(cancelled) {
    const p = this.p;
    try { if (!cancelled && p.scrub.time != null && Number.isFinite(p.video.duration)) p.video.currentTime = p.scrub.time; } catch {}
    finally {
      p.scrub.time = null; p.scrub.active = false; this.drag = null;
      p.root.classList.remove('seeking');
      this.gauges.preview(false);
    }
    p.updateTime(); p.scheduleHide();
  }

  dragLevel(kind, dy) {
    const p = this.p;
    const max = kind === 'brightness' ? 1.5 : 1;
    const value = G.dragLevel(this.drag.level, dy, p.surface.clientHeight || 1, max);
    if (kind === 'volume') { p.video.volume = value; p.video.muted = value === 0; }
    else this.setBrightness(value);
    this.gauges.level(kind, value, max);
  }

  /** The level is kept for the next film (prefs.js). */
  endLevel(kind) {
    const p = this.p;
    this.drag = null;
    if (kind === 'volume') p.prefs.volume = p.video.muted ? 0 : p.video.volume; else p.prefs.brightness = this.brightness;
    savePrefs(p.prefs);
    this.gauges.levelDone(kind);
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

  /** A new title starts at the brightness last chosen, and not zoomed. */
  reset() { const b = this.p.prefs.brightness; this.setBrightness(Number.isFinite(b) ? Math.max(0.2, Math.min(1.5, b)) : 1); this.zoom.reset(); }

  close() {
    this.abort();
    clearTimeout(this.tapTimer); this.lastTap = null; this.streak = null;
    this.gauges.close();
  }
}
