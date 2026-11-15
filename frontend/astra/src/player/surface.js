// Touch on the picture: tap to show or hide the controls, double tap to
// seek, hold to play faster, swipe across to seek, swipe up or down for
// brightness (left) and volume (right). The rules are in gestures.js.

import {clock, haptic} from '../ui/dom.js';
import * as G from './gestures.js';
import {FEEDBACK_MS} from './controls.js';

const coarse = () => matchMedia('(pointer: coarse)').matches;

export class Surface {
  constructor(p) {
    this.p = p;
    this.holding = false;
    this.brightness = 1;
    this.bind();
  }

  bind() {
    const p = this.p, s = p.surface;
    let d = null, lastTap = null, streak = null, tapTimer = 0;
    const rect = () => s.getBoundingClientRect();
    s.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = rect();
      d = {id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, t: performance.now(), kind: null, moved: false};
      s.setPointerCapture(e.pointerId);
      if (p.ctl.locked) return;
      if (p.prefs.gestures && !p.video.paused) d.hold = setTimeout(() => { d.kind = 'hold'; this.startHold(); }, G.HOLD_MS);
    });
    s.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id || p.ctl.locked) return;
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top, dx = x - d.x, dy = y - d.y;
      if (!d.kind) {
        const kind = p.prefs.gestures ? G.classifyDrag({dx, dy, startX: d.x, startY: d.y, width: d.w, height: d.h}) : null;
        if (kind) { clearTimeout(d.hold); d.kind = kind; this.startDrag(d); }
      }
      if (d.kind === 'seek') this.dragSeek(d, dx);
      else if (d.kind === 'brightness' || d.kind === 'volume') this.dragLevel(d, dy);
    });
    const end = e => {
      if (!d || e.pointerId !== d.id) return;
      clearTimeout(d.hold);
      const done = d; d = null;
      if (p.ctl.locked) { p.ctl.showLockHint(); return; }
      if (done.kind === 'hold') return this.endHold();
      if (done.kind === 'seek') return this.endSeekDrag(e.type === 'pointercancel');
      if (done.kind === 'brightness' || done.kind === 'volume') return this.endLevel(done.kind);
      if (done.kind === 'none' || e.type === 'pointercancel') return;
      // A tap.
      const zone = G.zoneOf(done.x, done.w), now = performance.now();
      if (p.prefs.gestures && zone !== 'center' && streak && streak.zone === zone && now - streak.t < G.STREAK_MS) {
        streak.t = now; streak.total += zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP;
        p.seekBy(zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP); p.flash(G.deltaLabel(streak.total), {kind: zone}); haptic(8);
        return;
      }
      if (p.prefs.gestures && zone !== 'center' && lastTap && lastTap.zone === zone && now - lastTap.t < G.DOUBLE_TAP_MS) {
        clearTimeout(tapTimer); lastTap = null;
        const step = zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP;
        streak = {zone, t: now, total: step};
        p.seekBy(step); p.flash(G.deltaLabel(step), {kind: zone}); haptic(8);
        return;
      }
      streak = null;
      if (zone === 'center' || !p.prefs.gestures) { this.tap(zone); return; }
      lastTap = {zone, t: now};
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { lastTap = null; this.tap(zone); }, G.DOUBLE_TAP_MS);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('contextmenu', e => e.preventDefault());
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

  endHold() {
    const p = this.p;
    this.holding = false;
    p.video.playbackRate = this.holdBase || 1;
    p.feedback.className = 'ap-feedback';
  }

  startDrag(d) {
    const p = this.p;
    if (d.kind === 'seek') { d.from = p.video.currentTime; p.scrub.active = true; p.root.classList.add('seeking'); p.showControls(false); }
    else {
      d.level = d.kind === 'volume' ? (p.video.muted ? 0 : p.video.volume) : (this.brightness ?? 1);
      p.levelBars[d.kind].hidden = false;
    }
  }

  dragSeek(d, dx) {
    const p = this.p;
    const target = G.swipeTarget(d.from, dx, d.w, p.video.duration || 0);
    p.scrub.time = target;
    const [b, span] = p.seekPreview.children;
    b.textContent = clock(target);
    span.textContent = G.deltaLabel(target - d.from);
    span.className = target >= d.from ? 'fwd' : 'back';
    p.seekPreview.hidden = false;
    p.updateTime();
  }

  endSeekDrag(cancelled) {
    const p = this.p;
    if (!cancelled && p.scrub.time != null) p.video.currentTime = p.scrub.time;
    p.scrub.time = null; p.scrub.active = false;
    p.root.classList.remove('seeking');
    p.seekPreview.hidden = true;
    p.updateTime(); p.scheduleHide();
  }

  dragLevel(d, dy) {
    const p = this.p;
    const max = d.kind === 'brightness' ? 1.5 : 1;
    const value = G.dragLevel(d.level, dy, d.h, max);
    if (d.kind === 'volume') { p.video.volume = value; p.video.muted = value === 0; }
    else this.setBrightness(value);
    const bar = p.levelBars[d.kind];
    bar.querySelector('span').textContent = Math.round(value * 100) + '%';
    bar.querySelector('i').style.transform = `scaleY(${value / max})`;
  }

  endLevel(kind) { setTimeout(() => { this.p.levelBars[kind].hidden = true; }, FEEDBACK_MS); }

  setBrightness(value) {
    this.brightness = value;
    // A web page cannot change screen brightness; this changes the picture's.
    this.p.video.style.filter = Math.abs(value - 1) < 0.02 ? '' : `brightness(${value.toFixed(2)})`;
  }

  /** A new title starts at the picture's own brightness. */
  reset() { this.setBrightness(1); }

  close() {}
}
