// The v2 Home's and Library's own rows (power-list.js ROW_VIEWS), made of the app's own views:
// - chips: FastButtons in the search's category chip style (?TopSearchCatButton, in the padding of
//   ?TopSearchCatsLayout), a sideways scroll when they pass the width, as the search's chips do;
// - tiles: two compact tiles, each the chip's pill under an item_track row in its one-line small scene
//   (a small cover and the name);
// - head: a shelf's title and "See all" (item_separator_button, its title and its button);
// - shelf: a sideways strip of item_track covers in the album grid's scene (scene_grid; artists in the
//   human grid's scene_grid_1_alt), covers bound only for the tiles in view (and one each side);
// - tonight: Music's "tonight" card (th/music/tonight.js) taken into the list, in place of the card that
//   floats over today's library home.
// Each row lays itself out in setItemScene(scene, w, h) and is bound by its source (bindItem).
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {FastButton} from '../view/text.js';
import {StyledAttributes} from '../res/resources.js';
import {withView} from '../view/inflater.js';
import {GONE, VISIBLE} from '../res/values.js';
import {VelocityTracker, Fling, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';
import {ROW_VIEWS} from '../list/power-list.js';

const EXACT = n => MeasureSpec.make(Math.max(0, Math.round(n)), MeasureSpec.EXACTLY);

/** A row view: its size is the list's, its children placed by place(w, h). */
export class RowView extends FastLayout {
  constructor(ctx) {
    super(ctx, null);
    this.itemScene = null;
    this.row = null;
  }

  dp(n) { return Math.round(n * this.ctx.dpr); }

  setItemScene(scene, w, h) {
    this.measure(EXACT(w), EXACT(h));
    this.layout(this.left, this.top, this.left + w, this.top + h);
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  onLayout() {
    if (this.width && this.height) this.place(this.width, this.height);
  }

  place() {}

  /** A child at (x, y) in a w × h box (an item view takes its scene there). */
  put(v, x, y, w, h, scene = null) {
    v.left = 0; v.top = 0;
    if (scene && v.setItemScene) v.setItemScene(scene, w, h);
    else { v.measure(EXACT(w), EXACT(h)); v.layout(0, 0, Math.round(w), Math.round(h)); }
    v.translationX = Math.round(x);
    v.translationY = Math.round(y);
    v.invalidate();
  }

  bindRow(row) {
    this.row = row;
    this.requestLayout();
  }
}

/** A copy of an icon drawable that draws another of the app's glyphs (icons.js names). */
export function glyph(d, name) {
  if (!d) return d;
  return Object.assign(Object.create(Object.getPrototypeOf(d)), d, {name});
}

/** An item_track view as a tile: list rows' cached thumbnails, its whole face a tap. */
export function tileItem(ctx, onClick) {
  const v = ctx.inflater.inflate('item_track', null)[0];
  v.useThumb = true;
  v.clickable = true;
  v.onClick = () => onClick(v);
  withView(v, 'line2', l2 => { l2.onClick = () => v.onClick(); });
  withView(v, 'meta', m => { m.clickable = false; });
  return v;
}

/** The record an item binds for a tile: {title, line2, art from a song, meta}. */
export function tileRecord(id, title, line2, tracks, meta = '') {
  const first = tracks?.find(t => t.art || t.thumb || t.artId) ?? tracks?.[0];
  return {id, group: true, title, artist: line2, meta, metaIcon: null, art: first?.art, thumb: first?.thumb, artId: first?.artId};
}

/** Chips (the search's category chips): one checked; a tap picks another; sideways scroll past the width. */
export class ChipRow extends RowView {
  constructor(ctx) {
    super(ctx);
    const res = ctx.res, theme = ctx.theme;
    const layoutStyle = theme.styleName?.('?TopSearchCatsLayout') ?? 'TopSearchCatsLayout';
    const la = new StyledAttributes(res, theme, {}, null, layoutStyle);
    this.padL = la.dim?.('android:paddingLeft', this.dp(8)) ?? this.dp(8);
    this.padR = la.dim?.('android:paddingRight', this.dp(12)) ?? this.dp(12);
    this.chipStyle = theme.styleName?.('?TopSearchCatButton') ?? 'TopSearchCatButton';
    this.buttons = [];
    this.scrollX = 0;
  }

  bindRow(row) {
    const same = this.row?.chips === row.chips;
    this.row = row;
    if (!same) {
      for (const b of this.buttons) this.removeView(b);
      this.buttons = row.chips.map(c => {
        const sa = new StyledAttributes(this.ctx.res, this.ctx.theme, {}, null, this.chipStyle);
        const b = new FastButton(this.ctx, sa);
        b._attrs = sa;
        b.lp = this.generateLayoutParams(sa);
        b.setText(c.title);
        b.chip = c;
        b.onClick = () => this.row?.pick?.(c.id);
        this.addView(b);
        return b;
      });
      this.scrollX = 0;
    }
    for (const b of this.buttons) { const on = b.chip.id === row.active; b.setChecked(on); b.setActivated(on); }
    this.requestLayout();
  }

  place(w, h) {
    let x = this.padL;
    const gap = this.buttons[0]?.lp?.rightMargin || this.dp(6);
    for (const b of this.buttons) {
      b.measure(MeasureSpec.make(w, MeasureSpec.AT_MOST), MeasureSpec.make(h, MeasureSpec.AT_MOST));
      const bw = b.measuredWidth, bh = b.measuredHeight;
      b.left = 0; b.top = 0;
      b.layout(0, 0, bw, bh);
      b.translationX = x - this.scrollX;
      b.translationY = Math.round((h - bh) / 2);
      b.invalidate();
      x += bw + gap;
    }
    this.extent = x - gap + this.padR;
  }

  get maxScrollX() { return Math.max(0, (this.extent ?? 0) - this.width); }

  setScrollX(x) {
    const v = Math.max(0, Math.min(this.maxScrollX, x));
    if (v === this.scrollX) return false;
    this.scrollX = v;
    this.place(this.width, this.height);
    return true;
  }

  onInterceptStart(start, now) { return sideways(this, start, now); }
  onPointerMove(e) { sidewaysMove(this, e); }
  onPointerUp(e) { sidewaysUp(this, e); }
}

// A sideways drag of a row that scrolls (chips, shelves): the search chips' own handling (search.js).
function sideways(v, start, now) {
  if (!v.maxScrollX || Math.abs(now.rootX - start.rootX) <= Math.abs(now.rootY - start.rootY)) return false;
  v._fling?.();
  v._fling = null;
  const vt = new VelocityTracker();
  vt.add(start.time, start.rootX, start.rootY);
  v.hScroll = {x: start.rootX + Math.sign(now.rootX - start.rootX) * TOUCH_SLOP_DP * v.ctx.dpr, scroll: v.scrollX ?? 0, vt};
  return true;
}
function sidewaysMove(v, e) {
  const h = v.hScroll;
  if (!h) return;
  h.vt.add(e.time, e.rootX, e.rootY);
  v.setScrollX(h.scroll - (e.rootX - h.x));
}
function sidewaysUp(v, e) {
  const h = v.hScroll;
  v.hScroll = null;
  if (!h || e?.cancelled) return;
  h.vt.up(e.time);
  const vx = -h.vt.compute(MAX_FLING_DP * v.ctx.dpr).vx;
  if (Math.abs(vx) < MIN_FLING_DP * v.ctx.dpr) return;
  const f = new Fling(vx);
  let last = performance.now();
  v._fling = v.ctx.onFrame(now => {
    const dt = Math.min(0.048, (now - last) / 1000);
    last = now;
    const moved = v.setScrollX((v.scrollX ?? 0) + f.step(dt));
    return moved && !f.done;
  });
}

/**
 * Two compact tiles: each a chip's pill (the search's category chip, checked) with the name in the
 * chip's own text, and over it a small cover (an item_track in its one-line small scene, its labels
 * left empty), the item taking the tap.
 */
export class TilesRow extends RowView {
  constructor(ctx) {
    super(ctx);
    const style = ctx.theme.styleName?.('?TopSearchCatButton') ?? 'TopSearchCatButton';
    this.cells = [0, 1].map(k => {
      const pill = new FastButton(ctx, new StyledAttributes(ctx.res, ctx.theme, {'android:ellipsize': 'end', 'android:maxLines': '1'}, null, style));
      pill.lp = this.generateLayoutParams(null);
      pill.gravity = 16 | 3; // centre_vertical | left
      pill.touchable = false;
      pill.setChecked(true);
      pill.setActivated(true);
      const item = tileItem(ctx, () => this.row?.items?.[k]?.open?.());
      this.addView(pill);
      this.addView(item);
      return {pill, item};
    });
  }

  bindRow(row) {
    this.row = row;
    row.items.forEach((it, k) => {
      const c = this.cells[k];
      if (!c) return;
      c.item.bind({...it.record, title: '', artist: '', meta: ''});
      c.pill.setText(it.record.title);
    });
    this.cells.forEach((c, k) => { const vis = row.items[k] ? VISIBLE : GONE; c.pill.visibility = vis; c.item.visibility = vis; });
    this.requestLayout();
  }

  place(w, h) {
    const side = this.dp(8), gap = this.dp(8), vgap = this.dp(4);
    const cw = Math.floor((w - side * 2 - gap) / 2), ch = h - vgap * 2;
    this.cells.forEach((c, k) => {
      const x = side + k * (cw + gap);
      this.put(c.item, x, vgap, cw, ch, 'scene_1_small');
      const img = c.item.image;
      c.pill.paddingLeft = (img && img.width ? img.left + img.width : ch) + this.dp(10);
      c.pill.paddingRight = this.dp(12);
      c.pill.requestLayout();
      this.put(c.pill, x, vgap, cw, ch);
    });
  }
}

/** A shelf's header: item_separator_button's title and its button ("See all"). */
export class HeadRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.sep = ctx.inflater.inflate('item_separator_button', null)[0];
    this.addView(this.sep);
    this.title = this.sep.findViewById('title');
    this.button = this.sep.findViewById('line2');
    if (this.button) { this.button.clickable = true; this.button.onClick = () => this.row?.seeAll?.(); }
  }

  bindRow(row) {
    this.row = row;
    this.title?.setText(row.title);
    this.button?.setText(row.seeAll ? row.button : '');
    this.button?.setVisibility(row.seeAll ? VISIBLE : GONE);
    this.requestLayout();
  }

  place(w, h) {
    this.put(this.sep, 0, 0, w, h);
  }
}

/** A sideways strip of covers in the grid's scene; only the covers in view (and one each side) are bound. */
export class ShelfRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.scrollX = 0;
    this.shown = new Map(); // index -> item
    this.spare = [];
  }

  bindRow(row) {
    if (this.row !== row) {
      if (this.row?.key !== row.key) this.scrollX = row.scrollX ?? 0;
      for (const v of this.shown.values()) { v.visibility = GONE; this.spare.push(v); }
      this.shown.clear();
    }
    this.row = row;
    this.requestLayout();
  }

  geometry(w) {
    const side = 0, cell = this.row?.cell ?? this.dp(150);
    return {side, cell, n: this.row?.items.length ?? 0};
  }

  get maxScrollX() {
    const g = this.geometry(this.width);
    return Math.max(0, g.side * 2 + g.n * g.cell - this.width);
  }

  setScrollX(x) {
    const v = Math.max(0, Math.min(this.maxScrollX, x));
    if (v === this.scrollX) return false;
    this.scrollX = v;
    if (this.row) this.row.scrollX = v;
    this.place(this.width, this.height);
    return true;
  }

  place(w, h) {
    const row = this.row;
    if (!row) return;
    const g = this.geometry(w);
    const first = Math.max(0, Math.floor((this.scrollX - g.side) / g.cell) - 1);
    const last = Math.min(g.n - 1, Math.floor((this.scrollX + w - g.side) / g.cell) + 1);
    for (const [i, v] of this.shown) {
      if (i >= first && i <= last) continue;
      v.visibility = GONE;
      this.shown.delete(i);
      this.spare.push(v);
    }
    for (let i = first; i <= last; i++) {
      let v = this.shown.get(i);
      if (!v) {
        v = this.spare.pop() ?? this.makeItem();
        v.visibility = VISIBLE;
        this.shown.set(i, v);
      }
      v.at = i;
      v.bind(row.items[i].record);
      this.put(v, g.side + i * g.cell - this.scrollX, 0, g.cell, h, row.scene ?? 'scene_grid');
    }
  }

  makeItem() {
    const v = tileItem(this.ctx, it => this.row?.items?.[it.at]?.open?.());
    this.addView(v);
    return v;
  }

  onInterceptStart(start, now) { return sideways(this, start, now); }
  onPointerMove(e) { sidewaysMove(this, e); }
  onPointerUp(e) { sidewaysUp(this, e); }
}

/** Music's "tonight" card, taken into the list at this row (its own DOM and styles). */
export class TonightRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.el.classList.add('cp-home-card');
  }

  bindRow(row) {
    this.row = row;
    const card = row.card;
    if (card && card.parentNode !== this.el) this.el.appendChild(card);
    this.requestLayout();
  }

  place(w) {
    const c = this.row?.card;
    if (!c) return;
    const k = this.ctx.dpr;
    c.style.left = `${Math.round(this.dp(12) / k)}px`;
    c.style.width = `${Math.round((w - this.dp(24)) / k)}px`;
    // Its height as laid out (its styles may load after it is made): the row follows it.
    (this.watch ??= new ResizeObserver(() => {
      const want = Math.round(c.offsetHeight * k) + this.dp(12);
      if (c.offsetHeight && want !== this.row?.h) { this.ctx.tonightHeight = want; this.ctx.homeRefresh?.(); }
    })).observe(c);
  }
}

ROW_VIEWS.set('homeChips', ctx => new ChipRow(ctx));
ROW_VIEWS.set('homeTiles', ctx => new TilesRow(ctx));
ROW_VIEWS.set('homeHead', ctx => new HeadRow(ctx));
ROW_VIEWS.set('homeShelf', ctx => new ShelfRow(ctx));
ROW_VIEWS.set('homeTonight', ctx => new TonightRow(ctx));
