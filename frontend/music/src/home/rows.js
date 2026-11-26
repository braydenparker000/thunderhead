// The v2 Home's and Library's own rows (power-list.js ROW_VIEWS), made of the app's own views:
// - chips: FastButtons in the search's category chip style (?TopSearchCatButton, in the padding of
//   ?TopSearchCatsLayout), a sideways scroll when they pass the width, as the search's chips do;
// - tiles (tiles.js): what was played last, two a row;
// - head: a shelf's title and "See all" (item_separator_button's title and its button), the title's
//   text starting where the shelf's first cover does;
// - shelf (shelf.js): a sideways strip of covers in the album grid's look;
// - tonight (tonight-row.js): Music's "tonight" mix as a card of the app's pieces.
// Each row lays itself out in setItemScene(scene, w, h) and is bound by its source (bindItem).
import {MeasureSpec} from '../view/view.js';
import {FastButton} from '../view/text.js';
import {StyledAttributes} from '../res/resources.js';
import {GONE, VISIBLE} from '../res/values.js';
import {ROW_VIEWS} from '../list/power-list.js';
import {RowView} from './row-view.js';
import {sideScroll} from './side-scroll.js';
import {TilesRow} from './tiles.js';
import {ShelfRow} from './shelf.js';
import {TonightRow} from './tonight-row.js';

export {RowView, glyph, tileItem, tileRecord} from './row-view.js';

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
    sideScroll(this);
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
}

/** A shelf's header: item_separator_button's title and its button ("See all"), the title at the covers' inset. */
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
    // The separator lays out its title in its own pass: its text moved to the covers' left inset.
    const t = this.title, inset = this.row?.inset;
    if (!t || inset == null) return;
    const shift = inset - (t.left + (t.paddingLeft ?? 0));
    if (t.translationX !== shift) { t.translationX = shift; t.invalidate(); }
  }
}

ROW_VIEWS.set('homeChips', ctx => new ChipRow(ctx));
ROW_VIEWS.set('homeTiles', ctx => new TilesRow(ctx));
ROW_VIEWS.set('homeHead', ctx => new HeadRow(ctx));
ROW_VIEWS.set('homeShelf', ctx => new ShelfRow(ctx));
ROW_VIEWS.set('homeTonight', ctx => new TonightRow(ctx));
