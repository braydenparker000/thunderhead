// The v2 Home's and Library's row views (power-list.js ROW_VIEWS) share this: a row laid out by
// place(w, h) at the size the list gives it, and the app's own pieces its rows are made of.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {StyledAttributes} from '../res/resources.js';
import {withView} from '../view/inflater.js';
import {VISIBLE} from '../res/values.js';
import {AAImageView} from '../list/list-widget.js';

export const EXACT = n => MeasureSpec.make(Math.max(0, Math.round(n)), MeasureSpec.EXACTLY);

/** A theme style's attributes (a `?Style` name or a plain one), with extra attributes over it. */
export const styled = (ctx, name, extra = {}) => new StyledAttributes(ctx.res, ctx.theme, extra, null, ctx.theme.styleName?.('?' + name) ?? name);

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

  /** A child's ask for a layout while the row places its children itself (placing) stops here. */
  requestLayout() {
    if (this._placing) return;
    super.requestLayout();
  }
}

/** A copy of an icon drawable that draws another of the app's glyphs (icons.js names). */
export function glyph(d, name) {
  if (!d) return d;
  return Object.assign(Object.create(Object.getPrototypeOf(d)), d, {name});
}

/** A copy of a background drawable with its shapes' corners at r px (its colours, states and ripple kept). */
export function withRadius(d, r) {
  if (!d) return d;
  const w = Object.assign(Object.create(Object.getPrototypeOf(d)), d);
  w.ops = (W, H, state, out, x = 0, y = 0) => {
    const from = out.length;
    d.ops(W, H, state, out, x, y);
    for (let i = from; i < out.length; i++) { delete out[i].radius; out[i].radii = [r, r, r, r]; }
  };
  if (d.rippleMask) w.rippleMask = withRadius(d.rippleMask, r);
  return w;
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

/** The record an item binds for a tile: {title, line2, art from a song, meta}; `cover` the song it comes from. */
export function tileRecord(id, title, line2, tracks, meta = '') {
  const first = tracks?.find(t => t.art || t.thumb || t.artId) ?? tracks?.[0];
  return {id, group: true, title, artist: line2, meta, metaIcon: null, art: first?.art, thumb: first?.thumb, artId: first?.artId, cover: first ?? null};
}

/**
 * The app's dark backing of a button over art (a list header's buttons in its art scene:
 * ?ListHeaderButton_scene_header_background, with its pressed ripple) at r px corners: Home's tiles and cards.
 */
export function tileBacking(ctx, r) {
  return withRadius(ctx.drawables.fromValue('?ListHeaderButton_scene_header_background', ctx.theme), r);
}

/** A bare cover (the list's AAImageView), centre-cropped, without corners of its own. */
export function coverView(ctx) {
  const v = new AAImageView(ctx, ctx.inflater.styledAttributes({'android:scaleType': 'centerCrop'}));
  v.radii = [0, 0, 0];
  return v;
}

/** Binds a song's cover to a cover view: its cached thumbnail, fetched while `shown()` (as list rows do). */
export function bindCover(ctx, v, t, shown = () => v.visibility === VISIBLE) {
  v.coverOf = t ?? null;
  const have = t?.thumb ?? t?.art ?? null;
  v.setArt(have);
  const lib = ctx.library;
  if (!t || have || !lib || !(t.artId || lib.customArt?.size)) return;
  lib.thumbFor(t, () => v.coverOf === t && shown()).then(art => { if (art && v.coverOf === t) { t.thumb = art; v.setArt(art); } });
}

/** The corner radius of the list's small covers (item_track in scene_small), in px; measured once. */
export function smallRadius(ctx) {
  if (ctx.homeSmallRadius !== undefined) return ctx.homeSmallRadius;
  let r = Math.round(8 * ctx.dpr);
  try {
    const v = ctx.inflater.inflate('item_track', null)[0];
    v.setItemScene?.('scene_small', Math.round(360 * ctx.dpr), Math.round(56 * ctx.dpr));
    const img = v.findViewById('aa_image');
    const k = img?.radii?.[img.radiusIndex ?? 0];
    if (k > 0) r = k;
  } catch { /* the default */ }
  return (ctx.homeSmallRadius = r);
}
