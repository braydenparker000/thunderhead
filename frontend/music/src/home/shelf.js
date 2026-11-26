// A shelf of Home: a sideways strip of item_track covers in the album grid's own scene and labels
// (scene_grid; artists in the human grid's scene_grid_1_alt), one cell the width of a two-column grid
// tile, the first cover at the list's cover inset. Only the covers in view are bound (the list's
// 256 px thumbnails, fetched while they stay in view); the strip scrolls with the list's physics
// (side-scroll.js). Where it is scrolled to is kept on its row, so a rebuilt Home shows it there.
import {GONE, VISIBLE} from '../res/values.js';
import {RowView, tileItem} from './row-view.js';
import {sideScroll} from './side-scroll.js';

export class ShelfRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.scrollX = 0;
    this.shown = new Map(); // index -> item
    this.spare = [];
    sideScroll(this);
  }

  bindRow(row) {
    if (this.row !== row) {
      if (this.row?.key !== row.key || this.row?.items !== row.items) this.scrollX = row.scrollX ?? 0;
      for (const v of this.shown.values()) { v.visibility = GONE; this.spare.push(v); }
      this.shown.clear();
    }
    this.row = row;
    this.requestLayout();
  }

  get cell() { return this.row?.cell ?? this.dp(150); }

  get maxScrollX() {
    return Math.max(0, (this.row?.items.length ?? 0) * this.cell + 2 * (this.row?.pad ?? 0) - this.width);
  }

  setScrollX(x) {
    const v = Math.max(0, Math.min(this.maxScrollX, Math.round(x)));
    if (v === this.scrollX) return false;
    this.scrollX = v;
    if (this.row) { this.row.scrollX = v; (this.ctx.homeShelfX ??= new Map()).set(this.row.key, v); }
    this.place(this.width, this.height);
    return true;
  }

  place(w, h) {
    const row = this.row;
    if (!row) return;
    const cell = this.cell, n = row.items.length, pad = row.pad ?? 0;
    // The covers in view: none bound beyond the row's edges.
    const first = Math.max(0, Math.floor((this.scrollX - pad) / cell));
    const last = Math.min(n - 1, Math.floor((this.scrollX + w - 1 - pad) / cell));
    for (const [i, v] of this.shown) {
      if (i >= first && i <= last) continue;
      v.visibility = GONE;
      this.shown.delete(i);
      this.spare.push(v);
    }
    for (let i = first; i <= last; i++) {
      let v = this.shown.get(i);
      const fresh = !v || v.at !== i || v.record !== row.items[i].record;
      if (!v) {
        v = this.spare.pop() ?? this.makeItem();
        v.visibility = VISIBLE;
        this.shown.set(i, v);
      }
      v.at = i;
      if (fresh) { v.record = row.items[i].record; v.bind(v.record); this.put(v, 0, 0, cell, h, row.scene ?? 'scene_grid'); }
      v.translationX = pad + i * cell - this.scrollX;
      v.translationY = 0;
      v.invalidate();
    }
  }

  makeItem() {
    const v = this.ctx.homeCovers?.pop() ?? coverItem(this.ctx);
    v.shelf = this;
    v.visibility = VISIBLE;
    this.addView(v);
    return v;
  }

  tap(v) {
    if (performance.now() - (this.stoppedAt ?? -1e9) < 600) return;
    this.row?.items?.[v.at]?.open?.();
  }

  // A touch on a moving shelf stops it, without opening what it lands on (as the list does).
  press() {
    if (this._fling) this.stoppedAt = performance.now();
    this.stopSide();
  }
}

/** A shelf's cover item (its shelf set when it takes it). */
function coverItem(ctx) {
  const v = tileItem(ctx, it => it.shelf?.tap(it));
  v.onPress = () => v.shelf?.press();
  return v;
}

/**
 * Cover items made ahead, one a step (Home's data steps, data.js), laid out once in the shelf's scene:
 * the shelves that come with the data take them instead of inflating in the frame that shows them.
 */
export function* prewarmCovers(ctx, n = 9) {
  const pool = ctx.homeCovers ??= [];
  const cell = Math.round(150 * ctx.dpr), h = cell + Math.round(4 * ctx.dpr);
  while (pool.length < n) {
    const v = coverItem(ctx);
    v.setItemScene?.('scene_grid', cell, h);
    v.visibility = GONE;
    pool.push(v);
    yield;
  }
}
