// One sheet behaviour for every player menu (subtitles, audio and sound, sources, stream info with
// the picture section, playback, episodes, the subtitle search): FEEL.md "Sheets and menus".
// It rises with --spring-smooth; dragged by its grab strip it follows the finger exactly, resists the
// wrong way (one fifth), and goes past 30 % of its size or at a fling over 0.5 px/ms; the scrim's
// darkness follows it. Held sideways on a wide screen (and unless the owner chose otherwise:
// Settings › Player › Menus held sideways) it docks to the right edge, the film still showing beside
// it, and the same rules run sideways. Closing is at once for the player (the menu is out of reach
// and the controls take touches in the same frame) while the sheet leaves; opening again during
// the leave turns it back from where it is. Rows answer the touch in the same frame (pressed),
// tick when chosen, and a newly selected mark springs into place.
// ui/motion.js's sheet() runs one axis and rises from fixed: this one runs either way and takes over
// from wherever the sheet is, which the docked menu and a quick reopen need.

import {h} from '../ui/dom.js';
import {shouldDismiss, resist} from '../ui/motion.js';
import {T, EASE, spring, level, go, stop, handle, tick, gone} from './feel.js';
import {timed} from '../ui/feel-log.js';

const PRESSABLE = '.ap-row, .ap-chip, .ap-tab, .ap-source, .ap-episode, .ap-swatch, .ap-line, .ap-btn';
const MARKS = '.ap-row.selected, .ap-chip.on, .ap-tab.on, .ap-swatch.on, .ap-source.current, .ap-episode.current';
const keyOf = el => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 60);

/** Whether menus dock to the right: a wide screen held sideways, unless the owner keeps them at the bottom. */
export const docks = (w, h, choice = 'auto') => choice !== 'bottom' && w > h && w >= 640;

export class MenuSheet {
  /** `el`: the menu's layer (p.modal or p.panel); `bodyClass`: its scrolling body's class; `onDismiss`: the player closes it. */
  constructor(p, el, {bodyClass, onDismiss, closeButton}) {
    this.p = p;
    this.el = el;
    this.onDismiss = onDismiss;
    this.scrim = h('div', {class: 'ap-modal-scrim', onclick: () => onDismiss()});
    this.grab = h('div', {class: 'ap-sheet-grab', 'aria-hidden': 'true'}, h('i'));
    this.body = h('div', {class: bodyClass});
    this.sheet = h('div', {class: 'ap-sheet'}, this.grab, closeButton, this.body);
    el.replaceChildren(this.scrim, this.sheet);
    this.bindDrag();
    // Rows: pressed on the touch, a tick when chosen (FEEL.md "Press", "Haptics").
    this.sheet.addEventListener('pointerdown', e => {
      const row = e.target.closest?.(PRESSABLE);
      if (!row || row.disabled || level() === 'off' || e.button !== 0) return;
      this.pressed = row;
      go(row, {transform: 'scale(0.97)'}, {duration: T.press, easing: EASE, keep: true});
    });
    const up = () => { const row = this.pressed; this.pressed = null; if (row?.isConnected) { const a = go(row, {transform: 'none'}, {duration: T.normal, easing: level() === 'full' ? spring('snappy') : EASE, keep: true}); a.finished.then(() => stop(row), () => {}); } };
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) this.sheet.addEventListener(type, up);
    this.sheet.addEventListener('click', e => { const row = e.target.closest?.(PRESSABLE); if (row && !row.disabled) tick('select'); });
  }

  /** The axis the sheet travels on now: 'y' (from the bottom) or 'x' (docked, from the right). */
  get axis() { return this.sheet.classList.contains('docked') ? 'x' : 'y'; }
  size() { const r = this.sheet.getBoundingClientRect(); return (this.axis === 'x' ? r.width : r.height) + 16; }
  at(offset) { return this.axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`; }
  where() { const t = getComputedStyle(this.sheet).transform; if (!t || t === 'none') return 0; const m = new DOMMatrixReadOnly(t); return this.axis === 'x' ? m.m41 : m.m42; }

  /** Draws `content` in the body, keeping its scroll; `look` is the scrim's kind ('', 'solid', 'preview'). The newly selected mark springs. */
  render(name, content, look = '') {
    const before = new Set([...this.body.querySelectorAll(MARKS)].map(keyOf)), open = !gone(this.el);
    this.scrim.className = 'ap-modal-scrim' + (look ? ' ' + look : '');
    this.sheet.classList.toggle('preview', look === 'preview');
    this.body.className = this.body.className.split(' ')[0] + (name ? ' ' + name : '');
    this.body.replaceChildren(...[content].flat(9).filter(x => x != null && x !== ''));
    if (!open || level() !== 'full') return;
    for (const el of this.body.querySelectorAll(MARKS)) {
      if (before.has(keyOf(el))) continue;
      const mark = el.querySelector(':scope > .icon') || el;
      go(mark, {transform: 'none'}, {from: {transform: mark === el ? 'scale(0.94)' : 'scale(0.4)'}, duration: T.lively, easing: spring('lively')});
    }
  }

  /** Rises (or turns back from where it is, if it was leaving). */
  open() {
    const p = this.p, was = gone(this.el), from = was && !this.el.hidden ? this.where() : null;
    const scrimFrom = was && !this.el.hidden ? Number(getComputedStyle(this.scrim).opacity) : 0;
    delete this.el.dataset.leaving; this.el.inert = false; this.el.hidden = false;
    this.sheet.classList.toggle('docked', docks(p.root.clientWidth, p.root.clientHeight, p.prefs.menuDock));
    if (!was) return;
    this.run = timed('sheet:open', () => {
      const lv = level();
      stop(this.sheet); stop(this.scrim);
      if (lv === 'off') return handle([]);
      if (lv === 'reduced') return handle([go(this.sheet, {opacity: 1}, {from: {opacity: 0}, duration: T.fade}), go(this.scrim, {opacity: 1}, {from: {opacity: scrimFrom}, duration: T.fade})]);
      return handle([go(this.sheet, {transform: 'none'}, {from: {transform: this.at(from ?? this.size())}, duration: T.travel, easing: spring('smooth')}),
        go(this.scrim, {opacity: 1}, {from: {opacity: scrimFrom}, duration: T.normal, easing: EASE})]);
    });
  }

  /** Leaves: out of reach at once, then hidden once it has gone (a fling leaves faster). */
  close({velocity = this.velocity || 0} = {}) {
    const el = this.el;
    this.velocity = 0;
    if (gone(el)) return;
    el.dataset.leaving = ''; el.inert = true;
    const from = this.drag?.last ?? null;
    this.drag = null;
    this.sheet.style.transform = ''; this.scrim.style.opacity = '';
    const done = cancelled => { if (cancelled && el.dataset.leaving == null) return; delete el.dataset.leaving; el.inert = false; el.hidden = true; stop(this.sheet); stop(this.scrim); };
    const run = timed('sheet:close', () => {
      const lv = level(), size = this.size();
      if (lv === 'off') return handle([]);
      if (lv === 'reduced') return handle([go(this.sheet, {opacity: 0}, {duration: T.fade, keep: true}), go(this.scrim, {opacity: 0}, {duration: T.fade, keep: true})]);
      const ms = velocity > 0.5 ? Math.max(160, Math.min(T.sheet, size / velocity)) : T.sheet;
      return handle([go(this.sheet, {transform: this.at(size)}, {from: from != null ? {transform: this.at(from)} : null, duration: ms, easing: spring('smooth'), keep: true}),
        go(this.scrim, {opacity: 0}, {duration: ms, easing: EASE, keep: true})]);
    });
    run.finished.then(({cancelled}) => done(cancelled));
  }

  /** Gone at once (the player closed). */
  hide() { stop(this.sheet); stop(this.scrim); delete this.el.dataset.leaving; this.el.inert = false; this.el.hidden = true; this.drag = null; }

  /** The grab strip follows a finger along the sheet's axis (FEEL.md: exactly, resisting the wrong way). */
  bindDrag() {
    const g = this.grab, pos = e => this.axis === 'x' ? e.clientX : e.clientY;
    g.addEventListener('pointerdown', e => {
      if (e.button !== 0 || gone(this.el)) return;
      const now = this.where();
      stop(this.sheet); stop(this.scrim);
      this.drag = {id: e.pointerId, start: pos(e) - now, last: now, samples: [{v: pos(e), t: e.timeStamp}], size: this.size(), past: false};
      this.sheet.style.transform = this.at(now);
      try { g.setPointerCapture(e.pointerId); } catch {}
    });
    g.addEventListener('pointermove', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      d.last = resist(pos(e) - d.start);
      d.samples.push({v: pos(e), t: e.timeStamp});
      while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 80) d.samples.shift();
      this.sheet.style.transform = this.at(d.last);
      this.scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - d.last / d.size)));
      const past = d.last > 0.3 * d.size;
      if (past !== d.past) { d.past = past; if (past) tick('edge'); }
    });
    const up = e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const a = d.samples[0], b = d.samples.at(-1), velocity = b.t > a.t ? (b.v - a.v) / (b.t - a.t) : 0;
      if (e.type !== 'pointercancel' && shouldDismiss({offset: d.last, height: d.size, velocity})) { this.velocity = velocity; this.onDismiss(); return; }
      this.drag = null;
      this.sheet.style.transform = ''; this.scrim.style.opacity = '';
      timed('sheet:settle', () => handle(level() === 'off' ? [] : [go(this.sheet, {transform: 'none'}, {from: {transform: this.at(d.last)}, duration: T.sheet, easing: level() === 'full' ? spring('smooth') : EASE}),
        go(this.scrim, {opacity: 1}, {from: {opacity: Math.max(0, 1 - d.last / d.size)}, duration: T.normal, easing: EASE})]));
    };
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }
}
