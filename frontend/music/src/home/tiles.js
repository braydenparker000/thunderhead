// Home's recent tiles, two a row: each a tile of the app's dark backing of buttons over art (a list
// header's, with its pressed ripple: row-view.js tileBacking) at the corner radius of the list's small
// covers, its cover flush with its left edge at its full height (clipped by the tile's corners) and
// the name in the list rows' title type (?ItemTrackTitle_Text), two lines at most, then an ellipsis.
import {GONE, VISIBLE} from '../res/values.js';
import {RowView, tileBacking, coverView, bindCover, smallRadius} from './row-view.js';

// The name's size: the rows' small one-line title (18 dp at the small scene's 0.85), two lines in a 56 dp tile.
const NAME_DP = 14;

export class Tile extends RowView {
  constructor(ctx) {
    super(ctx);
    const r = smallRadius(ctx);
    this.background = tileBacking(ctx, r);
    this.radius = r;
    this.el.style.overflow = 'hidden';
    this.el.style.borderRadius = ctx.px(r) + 'px';
    this.clickable = true;
    this.onClick = () => this.item?.open?.();
    this.cover = coverView(ctx);
    this.addView(this.cover);
    this.name = ctx.inflater.create('TextView', ctx.inflater.styledAttributes({
      'android:textAppearance': '?ItemTrackTitle_Text', 'android:textColor': '?android:textColorPrimary',
      'android:textSize': `${NAME_DP}dp`, 'android:maxLines': '2', 'android:ellipsize': 'end', 'android:gravity': 'center_vertical',
    }), null);
    this.addView(this.name);
  }

  bindItem(item) {
    this.item = item;
    this.name.setText(item?.record.title ?? '');
    this.contentDescription = item?.record.title ?? null;
    bindCover(this.ctx, this.cover, item?.record.cover, () => this.visibility === VISIBLE && this.parent?.visibility === VISIBLE);
    this.requestLayout();
  }

  place(w, h) {
    this.put(this.cover, 0, 0, h, h);
    const gap = this.dp(10), right = this.dp(10);
    this.put(this.name, h + gap, 0, Math.max(0, w - h - gap - right), h);
  }
}

export class TilesRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.cells = [0, 1].map(() => { const t = new Tile(ctx); this.addView(t); return t; });
  }

  bindRow(row) {
    this.row = row;
    this.cells.forEach((c, k) => {
      const it = row.items[k];
      c.visibility = it ? VISIBLE : GONE;
      if (it) c.bindItem(it);
    });
    this.requestLayout();
  }

  place(w, h) {
    const side = this.row?.side ?? this.dp(8), gap = this.dp(8), vgap = this.dp(4);
    const cw = Math.floor((w - side * 2 - gap) / 2);
    this.cells.forEach((c, k) => this.put(c, side + k * (cw + gap), vgap, cw, h - vgap * 2));
  }
}
