// List scroller (ListScrollerView) and its letter bubble (ListIndexerPopupView).
// Modes come from the list (sd.s()): 0 hidden, 1 scrollbar thumb, 3 thumb on a
// list with sections (sections.js) and az_scroll off, 2 the section column
// (az_scroll on, default). The thumb shows while the list can scroll; the column
// and the thumb fade over 250 ms. The column is the list's section labels (the
// chars "0ABC…Z#" for a name sort, years, months; plus the scroll-up item when
// azScrollUp is set) laid out in azSize of the height, label size = azTextScale
// × cell, touched cell on azTouchedBackground. When the labels do not all fit at
// a legible size the column shows an even spread of them (the finger still
// reaches every section); labels too wide shrink, then the column widens a little.
// Pressing runs anim_scrollbar_pressed (scroller scaleX 1.5 at its right edge,
// bubble fades/scales in) and the bubble follows the touched cell or thumb.
import {FastTextView, measureText} from '../view/text.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {renderOps} from '../view/drawables.js';
import {colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';
import {cssFontFamily} from '../fonts.js';
import {AZ_CHARS, columnLabels, thinned} from './sections.js';

export {AZ_CHARS, sectionChar} from './sections.js';
const FADE_MS = 250;
const MIN = -0x80000000;
// The smallest label (dp): fewer labels are shown rather than smaller ones. The column widens by at
// most MAX_WIDEN_DP for labels wider than it (months, years); a label fills at most FILL of it.
const MIN_TEXT_DP = 7, MAX_WIDEN_DP = 14, FILL = 0.9;
// The rail takes a finger this wide (dp) though it draws narrower: the strip left of it is its too
// for a move along it (input.js stripAt), while a tap there still reaches the row.
const TOUCH_DP = 44;

export class ListScrollerView extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    const d = n => (a.ref(n) ? ctx.drawables.fromRef(a.ref(n), a.theme) : null);
    this.thumb = d('android:thumb');
    this.track = d('android:track');
    this.azBg = d('azBackground');
    this.azTouched = d('azTouchedBackground');
    this.scrollUp = d('azScrollUp');
    this.textScale = a.float('azTextScale', 1);
    this.azPadL = a.dim('azPaddingLeft', 0);
    this.azPadR = a.dim('azPaddingRight', 0);
    this.azPadT = a.dim('azPaddingTop', 0);
    this.azPadB = a.dim('azPaddingBottom', 0);
    const size = a.raw('azSize');
    const sizeVal = size === undefined ? null : a.res.resolveRaw(size, a.theme).value;
    this.azSizeFrac = typeof sizeVal === 'string' && sizeVal.endsWith('%') ? a.fraction('azSize', 1) : null;
    this.azSizePx = this.azSizeFrac === null && size !== undefined ? a.dim('azSize', 0) : 0x7fffffff;
    this.sepColor = colorForState(a.color('azSeparatorLineColor') ?? {color: 0}, {}) ?? 0;
    this.pivotFracX = a.fraction('transformPivotX_percent', 0.5);
    this.thumbW = this.thumb?.intrinsicWidth > 0 ? this.thumb.intrinsicWidth : Math.round(16 * ctx.dpr);
    this.thumbH = this.thumb?.intrinsicHeight > 0 ? this.thumb.intrinsicHeight : Math.round(64 * ctx.dpr);
    // The alphabet resource: localized_azChars with the Localized A-Z option.
    this.chars = (ctx.settings?.localized_az ? ctx.res.stringByName('localized_azChars') : ctx.res.stringByName('azChars')) || AZ_CHARS;
    this.mode = -1;
    this.index = null;
    this.extraW = 0;
    this.shown = [];
    this.labels = [];
    this.pressedIndex = MIN;
    this.pressedSlot = MIN;
    this.pressedRow = MIN;
    this.thumbAlpha = 0;
    this.textAlpha = 0;
    this.thumbPos = 0;
    this.clickable = true;
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'ops';
    this.azEl = document.createElement('div');
    this.azEl.className = 'ops';
    this.el.append(this.scrollEl, this.azEl);
    ctx.listScroller = this;
    (ctx.touchStrips ??= new Set()).add(this);
  }

  /** The strip left of the rail that is its for a move along it, and what it lies over (input.js stripAt). */
  get stripWidth() { return Math.max(0, Math.round(TOUCH_DP * (this.ctx.dpr || 1)) - this.width); }
  get stripOver() { return this.list ?? null; }

  /** A touch that starts in the strip and moves along the rail: the rail's, as a press on it is. */
  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    return this.onPointerDown(start);
  }

  onMeasure(wSpec, hSpec) {
    // The width it was measured with (computeAZ takes the column's own width from it).
    this.measuredExtra = this.extraW;
    const want = Math.max(this.minWidth, this.thumbW + this.paddingLeft + this.paddingRight) + this.extraW;
    const wm = MeasureSpec.getMode(wSpec), ws = MeasureSpec.getSize(wSpec);
    const w = wm === MeasureSpec.EXACTLY ? ws : wm === MeasureSpec.AT_MOST ? Math.min(want, ws) : want;
    const h = MeasureSpec.getMode(hSpec) === MeasureSpec.UNSPECIFIED ? this.thumbH : MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
  }

  onLayout() {
    this.pivotX = this.width * this.pivotFracX;
    this.computeAZ();
  }

  onSizeChanged() {
    this.pivotX = this.width * this.pivotFracX;
    this.computeAZ();
  }

  /** The list's section index (sections.js): the column's entries; null shows the alphabet. */
  setIndex(index) {
    if (this.index === index) return;
    this.index = index;
    this.pressedIndex = this.pressedSlot = this.pressedRow = MIN;
    this.computeAZ();
  }

  /**
   * Column geometry (e()): top r, height q, cell f, baseline offset e, text size; which entries show
   * (all, or an even spread when a cell would be smaller than a legible label), their labels, and
   * the text size and extra width that fit the widest label.
   */
  computeAZ() {
    const H = this.height;
    let avail = H - this.azPadT - this.azPadB;
    if (this.azSizeFrac !== null) { avail = Math.trunc(H * this.azSizeFrac + 0.5); this.azTop = Math.trunc((H - avail) / 2); }
    else if (this.azSizePx !== 0x7fffffff && this.azSizePx > 0) { avail = this.azSizePx; this.azTop = Math.trunc((H - avail) / 2); }
    else this.azTop = this.azPadT;
    const entries = this.index?.entries ?? [...this.chars].map(text => ({text}));
    const up = this.scrollUp ? 1 : 0, dpr = this.ctx.dpr || 1, minText = MIN_TEXT_DP * dpr;
    const fit = Math.max(1, Math.floor(avail / (minText / Math.max(0.01, this.textScale))) - up);
    this.shown = thinned(entries.length, fit);
    this.labels = columnLabels(entries, this.shown);
    this.azH = avail;
    this.cell = avail / Math.max(1, this.shown.length + up);
    // A short column (a few years) keeps the alphabet's letter size (at least the smallest label), its cells taller.
    let size = Math.min(this.textScale * this.cell, Math.max(minText, (this.textScale * avail) / Math.max(1, this.chars.length + up)));
    // Labels wider than the column (months, years): the letters' size kept by a wider column first, then
    // smaller text as far as it must, down to the smallest label.
    let extra = 0;
    const baseW = this.width - (this.measuredExtra ?? 0) - this.azPadL - this.azPadR;
    const widest = this.font && this.mode === 2 ? Math.max(0, ...this.labels.map(t => measureText(t, this.font, size))) : 0;
    if (baseW > 0 && widest > baseW * FILL) {
      extra = Math.min(MAX_WIDEN_DP * dpr, Math.ceil(widest / FILL - baseW));
      size = Math.max(Math.min(size, minText), Math.min(size, (size * (baseW + extra) * FILL) / widest));
    }
    this.azTextSize = size;
    // Paint.ascent()/descent() approximated by the font's bounding metrics.
    const asc = (this.font.yMax / this.font.upm) * this.azTextSize, desc = (-this.font.yMin / this.font.upm) * this.azTextSize;
    this.baseOff = this.cell - (this.cell - (asc - desc)) / 2;
    if (extra !== this.extraW) { this.extraW = extra; this.requestLayout(); }
    this.invalidate();
  }

  /** Mode from the list (y(I)); fades the column / thumb accordingly. */
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    // Only the column may widen the scroller (hidden, it stands narrow over the player's waveform).
    if (mode === 2) this.computeAZ();
    else if (this.extraW) { this.extraW = 0; this.requestLayout(); }
    this.fade('textAlpha', mode === 2);
    if (mode !== 1 && mode !== 3) this.fade('thumbAlpha', false);
    this.syncThumb();
  }

  fade(key, on) {
    const to = on ? 1 : 0;
    const anim = (this._fades ??= {})[key];
    if (anim?.to === to || (!anim && this[key] === to)) return;
    anim?.stop?.();
    const from = this[key], t0 = performance.now();
    const rec = this._fades[key] = {to};
    rec.stop = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / FADE_MS);
      this[key] = from + (to - from) * t;
      this.invalidate();
      if (t >= 1) { this._fades[key] = null; return false; }
      return true;
    });
  }

  /** Thumb position and visibility from the list's scroll state (d(), o()). */
  syncThumb() {
    const list = this.list;
    let pos = this.thumbPos;
    if (this.mode === 1 || this.mode === 3) {
      const max = list?.maxScroll?.() ?? 0;
      this.fade('thumbAlpha', max > 0);
      const frac = max > 0 ? Math.max(0, Math.min(1, list.scrollY / max)) : 0;
      pos = this.thumbPos = (this.height - this.thumbH - this.paddingTop - this.paddingBottom) * frac + this.paddingTop;
    }
    // The list syncs it at every placement (each frame of a scroll): drawn again only when the thumb moved, or
    // the list, its mode or the column's size changed (a fade draws itself).
    if (this._synced?.pos === pos && this._synced.list === list && this._synced.mode === this.mode && this._synced.h === this.height) return;
    this._synced = {pos, list, mode: this.mode, h: this.height};
    this.invalidate();
  }

  attachList(list, mode) {
    this.list = list;
    this.setMode(mode);
    this.syncThumb();
  }

  /**
   * What lies under y (f(F)): {slot, entry, sub}. slot is the shown cell (-1 the scroll-up item);
   * entry the section under the finger among all of them (shown or thinned out), sub how far into it.
   */
  touchAt(y) {
    const up = this.scrollUp ? 1 : 0, slots = Math.max(1, this.shown.length), yy = y - this.azTop;
    if (up && yy < this.cell) return {slot: -1, entry: -1, sub: 0};
    const n = this.index?.entries.length ?? this.chars.length;
    const frac = Math.max(0, Math.min(1, (yy - up * this.cell) / (slots * this.cell)));
    const pos = Math.min(n - 1e-6, frac * n), entry = Math.floor(pos);
    return {slot: Math.min(slots - 1, Math.floor(frac * slots)), entry, sub: pos - entry};
  }

  onPointerDown(e) {
    if (this.mode === 2) {
      this.press(true);
      this.touchAZ(e.y);
      return true;
    }
    if ((this.mode === 1 || this.mode === 3) && this.thumbAlpha > 0) {
      // Grabbing anywhere in the scroller drags the thumb; the grab point keeps its offset.
      const inThumb = e.y >= this.thumbPos && e.y <= this.thumbPos + this.thumbH;
      this.grab = inThumb ? e.y - this.thumbPos : this.thumbH / 2;
      this.press(true);
      this.dragThumb(e.y);
      return true;
    }
    return false;
  }

  onPointerMove(e) {
    if (!this.state.pressed) return;
    // A drag places the list once a frame at most: the latest finger position, in the frame before
    // its layout (a phone sends moves faster than it draws; each placed a page of rows).
    const queued = this.moveY != null;
    this.moveY = e.y;
    if (!queued) this.ctx.onFrame(() => { this.applyMove(); return false; });
  }

  applyMove() {
    const y = this.moveY;
    this.moveY = null;
    if (y == null || !this.state.pressed) return;
    if (this.mode === 2) this.touchAZ(y);
    else this.dragThumb(y);
  }

  onPointerUp() {
    this.applyMove();
    this.press(false);
  }

  onPointerCancel() {
    this.applyMove();
    this.press(false);
  }

  get interceptible() { return false; }

  // Hidden (mode 0: the album-art pager, the lyrics) it takes no touch (input.js hitTest): a drag at the
  // right edge goes to what is under it (the player's waveform), not to the list widget's swipe.
  get touchable() { return this.mode > 0; }

  press(on) {
    if (this.state.pressed === on) return;
    this.setPressed(on);
    if (!on) { this.pressedIndex = this.pressedSlot = this.pressedRow = MIN; this.invalidate(); }
    this.ctx.topNav?.stateAnim('anim_scrollbar_pressed', on, FADE_MS);
    const pop = this.popup();
    if (pop) {
      if (on) pop.setVisibility(0);
    }
  }

  popup() {
    let root = this;
    while (root.parent) root = root.parent;
    return root.findViewById('list_indexer');
  }

  touchAZ(y) {
    const {slot, entry, sub} = this.touchAt(y);
    const row = entry >= 0 && this.index ? this.index.rowFor(entry, sub) : MIN;
    if (slot === this.pressedSlot && entry === this.pressedIndex && row === this.pressedRow) return;
    this.pressedSlot = slot;
    this.pressedIndex = entry;
    this.pressedRow = row;
    this.invalidate();
    const list = this.list;
    if (slot === -1) { list?.scrollToIndex?.(0, true); this.showPopup(null, this.azTop + this.cell / 2); return; }
    if (!this.index) return;
    list?.scrollToSection?.(entry, sub);
    this.showPopup(this.index.touchBubble(entry, row), this.azTop + (slot + (this.scrollUp ? 1 : 0)) * this.cell + this.cell / 2);
  }

  dragThumb(y) {
    const list = this.list;
    if (!list) return;
    const range = this.height - this.thumbH - this.paddingTop - this.paddingBottom;
    const frac = range > 0 ? Math.max(0, Math.min(1, (y - this.grab - this.paddingTop) / range)) : 0;
    list.scrollTo?.(frac * list.maxScroll());
    this.syncThumb();
    const ch = this.mode === 3 ? list.sectionAtTop?.() : null;
    this.showPopup(ch, this.thumbPos + this.thumbH / 2);
  }

  /** The bubble follows the touched cell / thumb (indexerPopupMode moveWithThumb), kept in its parent. */
  showPopup(text, anchorY) {
    const pop = this.popup();
    if (!pop) return;
    if (text !== null) this.fitPopup(pop, text);
    const myTop = this.getLocationIn(pop.parent).y;
    const ph = pop.height, parentH = pop.parent?.height ?? 0;
    let ty = myTop + anchorY - ph / 2 - pop.top;
    ty = Math.max(-pop.top, Math.min(parentH - pop.top - ph, ty));
    pop.translationY = Math.round(ty);
    pop.invalidate();
  }

  /** The bubble's text, smaller than its style's size when it is too wide for it (a year, "Nov 24"). */
  fitPopup(pop, text) {
    pop.baseTextSize ??= pop.textSize;
    const base = pop.baseTextSize, mult = this.ctx.textSizeMultiplier ?? 1;
    const room = (pop.width - (pop.paddingLeft ?? 0) - (pop.paddingRight ?? 0)) * 0.84;
    const w = pop.font ? measureText(text, pop.font, Math.max(1, Math.round(base * mult))) : 0;
    const size = room > 0 && w > room ? Math.max(1, Math.floor((base * room) / w)) : base;
    if (size !== pop.textSize) {
      pop.textSize = size;
      pop.updateFont?.();
      pop._textKey = null;
      pop.requestLayout();
    }
    pop.setText(text);
  }

  draw() {
    super.draw();
    const px = this.ctx.px, w = this.width, h = this.height;
    // Scrollbar: track and thumb.
    const ops = [];
    if (this.thumbAlpha > 0 && (this.mode === 1 || this.mode === 3)) {
      const tx = w - this.minScrollW() + this.paddingLeft;
      this.track?.ops(w - this.paddingRight - tx, h - this.paddingBottom - this.paddingTop, this.state, ops, tx, this.paddingTop);
      this.thumb?.ops(this.thumbW, this.thumbH, this.state, ops, w - this.thumbW - this.paddingRight, Math.round(this.thumbPos));
    }
    renderOps(this.scrollEl, ops, px);
    this.scrollEl.style.opacity = String(this.thumbAlpha);
    this.drawAZ(px);
  }

  minScrollW() {
    return Math.max(this.minWidth, this.thumbW + this.paddingLeft + this.paddingRight);
  }

  drawAZ(px) {
    const el = this.azEl;
    el.style.opacity = String(this.textAlpha);
    if (this.textAlpha <= 0 || !this.cell) { el.replaceChildren(); this._azKey = null; return; }
    const W = this.width - this.azPadL - this.azPadR;
    const key = [W, this.azTop, this.cell, this.azTextSize, this.pressedSlot, this.labels.join('\u0001'), this.state.enabled].join('|');
    if (key === this._azKey) return;
    this._azKey = key;
    el.replaceChildren();
    const ops = [];
    const ox = this.azPadL, oy = this.azTop, f = this.cell;
    this.azBg?.ops(W, this.azH, this.state, ops, ox, oy);
    let y = 0;
    if (this.scrollUp) {
      if (this.pressedSlot === -1 && this.azTouched) this.azTouched.ops(W, Math.round(f), this.state, ops, ox, oy);
      const s = Math.min(W, Math.round(f));
      this.scrollUp.ops(s, s, this.state, ops, ox + Math.trunc((W - s) / 2), oy + Math.trunc((Math.round(f) - s) / 2));
      y += f;
    }
    const sepCss = this.sepColor ? colorToCss(this.sepColor) : null;
    const labels = this.labels;
    for (let i = 0; i < labels.length; i++) {
      if (i === this.pressedSlot && this.azTouched) this.azTouched.ops(W, Math.round(y + f) - Math.round(y), this.state, ops, ox, oy + Math.round(y));
      if ((i > 0 || this.scrollUp) && sepCss) ops.push({x: ox, y: oy + Math.round(y), w: W, h: 1, bg: sepCss});
      y += f;
    }
    const opsEl = document.createElement('div');
    opsEl.className = 'ops';
    renderOps(opsEl, ops, px);
    const txt = document.createElement('div');
    txt.className = 'txt';
    const st = txt.style;
    st.font = `${this.font.weight} ${px(this.azTextSize)}px ${cssFontFamily(this.font)}`;
    const normal = colorToCss(colorForState(this.textColor, {enabled: true}) ?? 0xffffffff);
    const pressed = colorToCss(colorForState(this.textColor, {enabled: true, pressed: true, activated: true, selected: true}) ?? 0xffffffff);
    const asc = (this.font.yMax / this.font.upm) * this.azTextSize;
    y = this.scrollUp ? f : 0;
    for (let i = 0; i < labels.length; i++) {
      const ln = document.createElement('div');
      ln.className = 'ln';
      ln.textContent = labels[i];
      ln.style.width = px(W) + 'px';
      ln.style.textAlign = 'center';
      ln.style.lineHeight = px(this.azTextSize * (this.font.yMax - this.font.yMin) / this.font.upm) + 'px';
      ln.style.transform = `translate(${px(ox)}px,${px(oy + y + this.baseOff - asc)}px)`;
      ln.style.color = i === this.pressedSlot ? pressed : normal;
      txt.appendChild(ln);
      y += f;
    }
    el.append(opsEl, txt);
  }
}

register(['ListScrollerView'], ListScrollerView);
