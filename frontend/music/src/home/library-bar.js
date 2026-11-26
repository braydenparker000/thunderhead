// The v2 Library's bar under its title (library-source.js): the kind chips (rows.js ChipRow, the
// search's category chips) and under them the sort line in the list header's own buttons: the sort as
// the header's text button (?ItemTextHeaderSelectButton, as Select) with the sort glyph, a tap taking the
// next of Recent, Name and Added and a hold opening List Options; at the right the list or grid
// toggle as the header's icon-only button (?ItemTextHeaderShuffleButton's look), showing the view it
// switches to.
import {MeasureSpec} from '../view/view.js';
import {FastButton} from '../view/text.js';
import {StyledAttributes} from '../res/resources.js';
import {ROW_VIEWS} from '../list/power-list.js';
import {VISIBLE} from '../res/values.js';
import {ChipRow, RowView, glyph} from './rows.js';

const styled = (ctx, attr) => new StyledAttributes(ctx.res, ctx.theme, {}, null, ctx.theme.styleName?.('?' + attr) ?? attr);

export class LibraryBar extends RowView {
  constructor(ctx) {
    super(ctx);
    this.chips = new ChipRow(ctx);
    this.addView(this.chips);
    this.sort = new FastButton(ctx, styled(ctx, 'ItemTextHeaderSelectButton'));
    this.toggle = new FastButton(ctx, styled(ctx, 'ItemTextHeaderShuffleButton'));
    for (const b of [this.sort, this.toggle]) { b.lp = this.generateLayoutParams(null); b.visibility = VISIBLE; b.scaleX = b.scaleY = 1; this.addView(b); }
    this.baseIcon = this.toggle.drawable;
    this.sort.setDrawable?.(glyph(this.baseIcon, 'sort_by'));
    this.sort.onClick = () => this.row?.nextSort?.();
    this.sort.longClickable = true;
    this.sort.onLongClick = () => { this.row?.options?.(); return true; };
    this.toggle.onClick = () => this.row?.toggleView?.();
  }

  bindRow(row) {
    this.row = row;
    this.chips.bindRow({chips: row.chips, active: row.active, pick: row.pick});
    this.sort.setText(row.sortTitle);
    // The view it switches to: the list's lines from a grid, the grid's squares from a list.
    this.toggle.setDrawable?.(glyph(this.baseIcon, row.grid ? 'playlists_12dp' : 'lists_rounded'));
    this.toggle.contentDescription = row.grid ? 'List' : 'Grid';
    this.requestLayout();
  }

  place(w, h) {
    const top = this.dp(52);
    this.put(this.chips, 0, 0, w, top);
    const line = h - top, side = this.dp(12);
    for (const b of [this.sort, this.toggle]) b.measure(MeasureSpec.make(w, MeasureSpec.AT_MOST), MeasureSpec.make(line, MeasureSpec.AT_MOST));
    const sh = this.sort.measuredHeight, th = this.toggle.measuredHeight, tw = this.toggle.measuredWidth;
    this.put(this.sort, side, top + Math.round((line - sh) / 2), this.sort.measuredWidth, sh);
    this.put(this.toggle, w - tw - side, top + Math.round((line - th) / 2), tw, th);
  }
}

ROW_VIEWS.set('libraryBar', ctx => new LibraryBar(ctx));
