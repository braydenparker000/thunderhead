// The Undo bar (owner, 2026-11-25): a short bar above the mini-player with a message and an Undo
// action, gone after about 5 seconds. It is the lower toast's own frame (?TopToastFrame_scene_expanded:
// toast_bg, its paddings and its place 60 dp above the bottom) with the toast's icon and title, and
// an Undo button where the upper toast has its close button. It slides up into place and back down
// as the toast's scenes move it, over the toast's times (300 / 250 ms, the Animations setting
// applied). One at a time: a new one takes the place of the one showing (whose undo then lapses),
// and so does any other toast. It stands above an open dialog (Up next, History), so its undo can
// be reached there too.
//
// API (installed at startup as ctx.undoBar):
//   ctx.undoBar.show(message, onUndo, {ms = 5000, icon = null, action = 'Undo'} = {})
//     Shows the bar; onUndo() runs once if Undo is tapped before the bar goes. icon: a drawable
//     value such as '?toast_queue'. Returns {hide()} for this bar (no effect once another shows).
//   ctx.undoBar.hide()            Hides the bar now (its undo lapses).
//   ctx.undoBar.queued(entries, next)
//     "Playing next" / "Added to queue" for Queue entries just added (Player.enqueue returns
//     them); Undo takes out those of them still waiting.
import {GONE, VISIBLE} from '../res/values.js';
import {accelDecel, animClock} from '../gesture.js';
import {FastLayout} from '../view/fast-layout.js';
import {animTime} from './topnav.js';

export const UNDO_MS = 5000;
const IN_S = 0.3, OUT_S = 0.25;

/** The bar's views, as a layout of the reference's toast parts (inflated by the app's inflater). */
const BAR = ['FastLayout', {'android:id': '@id/undo_bar', style: '?TopToastFrame_scene_expanded', 'android:importantForAccessibility': 'no'}, [
  ['FastTextView', {'android:id': '@id/icon', style: '?TopToastIcon'}],
  // The text keeps clear of the button (ACTION_DIP).
  ['FastTextView', {'android:id': '@id/title', style: '?TopToastTitle', 'android:layout_marginRight': '64.0dip', 'android:maxLines': '1', 'android:ellipsize': 'end'}],
  ['TextView', {'android:id': '@id/line2', style: '?TopToastLine2', 'android:layout_marginRight': '64.0dip'}],
  // Where the upper toast has its close button (?TopUpperToastCloseButton), level with the text as
  // the icon is; the bar's whole right end takes its tap (UndoBar.build).
  ['FastButton', {
    'android:id': '@id/undo_action', 'android:textAppearance': '?TopToastTitle_Text', 'android:gravity': 'center',
    'android:background': '@drawable/ripple_rounded_mini', 'android:clickable': 'true', 'android:paddingLeft': '14.0dip', 'android:paddingRight': '14.0dip',
    'android:layout_width': 'wrap_content', 'android:layout_height': 'wrap_content', 'android:layout_marginRight': '-8.0dip',
    'layout_attachRight': 'parent', 'layout_attachTopToTop': '@id/title', 'layout_attachBottomToBottom': '@id/line2',
  }],
]];
const ACTION_DP = 80;

export class UndoBar {
  constructor(ctx) {
    this.ctx = ctx;
    this.host = null;
    this.frame = null;
    this.current = null;
    this.timer = 0;
    this.anim = null;
    // Any other toast takes the bar's place.
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'cmd_gui_show_toast' && this.current) this.hide(); });
  }

  /** The host over the whole window (touches pass through it) and the bar in it, made once. */
  build() {
    if (this.host) return;
    const ctx = this.ctx, decor = ctx.root;
    const host = this.host = new FastLayout(ctx, null);
    host.id = 'undo_bar_host';
    host.lp = decor.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'fill_parent'}));
    decor.addView(host);
    this.frame = ctx.inflater.inflateNode(BAR, host)[0];
    this.frame.clickable = true;
    this.button = this.frame.findViewById('undo_action');
    const undo = () => {
      const c = this.current;
      if (!c) return;
      this.hide();
      if (c.onUndo && !c.undone) { c.undone = true; c.onUndo(); }
    };
    this.button.onClick = undo;
    // A tap on the bar's right end is Undo (the button's row is low for a finger); elsewhere it puts the bar away.
    this.frame.onClick = () => {
      const x = this.frame.hotspot?.x ?? 0;
      if (this.current?.onUndo && this.button.visibility === VISIBLE && x >= this.frame.width - ACTION_DP * this.ctx.dpr) undo();
      else this.hide();
    };
    this.frame.visibility = GONE;
  }

  show(message, onUndo, {ms = UNDO_MS, icon = null, action = 'Undo'} = {}) {
    const ctx = this.ctx;
    if (!ctx.root || !ctx.inflater) return {hide() {}};
    this.build();
    // Above everything shown now, a dialog opened since included.
    const decor = ctx.root;
    if (decor.children.at(-1) !== this.host) { decor.removeView(this.host); decor.addView(this.host); }
    // The toast showing goes (one at a time).
    ctx.bus.post('bus_gui', 'cmd_gui_close_toast', this);
    const f = this.frame, d = icon ? ctx.drawables.fromValue(icon, ctx.theme) : null;
    const iv = f.findViewById('icon');
    iv?.setDrawable?.(d);
    iv?.setVisibility(d ? VISIBLE : GONE);
    f.findViewById('title')?.setText(message);
    f.findViewById('line2')?.setText('');
    this.button.setText(action);
    this.button.setVisibility(onUndo ? VISIBLE : GONE);
    // With no action (a line that only says something: Music's downloads), the text takes the button's room too.
    for (const v of [f.findViewById('title'), f.findViewById('line2')]) if (v?.lp) { v._mr ??= v.lp.rightMargin; v.lp.rightMargin = onUndo ? v._mr : 0; }
    const bar = this.current = {message, onUndo, undone: false};
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.current === bar) this.hide(); }, ms);
    this.place();
    const was = f.visibility === VISIBLE;
    f.visibility = VISIBLE;
    f.forceLayoutTree?.();
    f.requestLayout();
    ctx.scheduleLayout();
    // Slides up from where the toast's default scene keeps it (its 60 dp lower), fading in.
    if (!was) { f.alpha = 0; f.translationY = this.travel(); }
    this.move(0, 1, animTime(ctx, IN_S));
    f.el?.setAttribute('role', 'status');
    return {hide: () => { if (this.current === bar) this.hide(); }};
  }

  /** Above the mini-player where it shows (the library), else where the toast is (above the tabs). */
  place() {
    const f = this.frame, lp = f.lp, root = this.ctx.root;
    this.baseBottom ??= lp.bottomMargin;
    const nb = root.findViewById('navbar');
    const inset = this.host.getInsets?.().bottom ?? 0;
    const top = nb && nb.visibility === VISIBLE ? nb.getLocationIn(null).y : null;
    const want = top === null ? this.baseBottom : Math.max(this.baseBottom, root.height - inset - top);
    if (lp.bottomMargin !== want) { lp.bottomMargin = want; f.requestLayout(); }
  }

  hide() {
    clearTimeout(this.timer);
    this.current = null;
    if (!this.frame || this.frame.visibility !== VISIBLE) return;
    this.move(this.travel(), 0, animTime(this.ctx, OUT_S), () => { this.frame.visibility = GONE; this.frame.invalidate(); });
  }

  /** How far the bar slides: the toast's lift from its default scene to scene_expanded. */
  travel() {
    return Math.round(this.baseBottom ?? 60 * this.ctx.dpr);
  }

  /** Moves the bar to translationY y and alpha a over seconds (accelerate-decelerate), then done. */
  move(y, a, seconds, done = null) {
    const f = this.frame, from = {y: f.translationY, a: f.alpha}, clock = animClock(), ms = Math.max(1, seconds * 1000 * (this.ctx.animScale ?? 1));
    this.anim?.();
    this.anim = this.ctx.onFrame(now => {
      const t = Math.min(1, clock(now) / ms), e = accelDecel(t);
      f.translationY = from.y + (y - from.y) * e;
      f.alpha = from.a + (a - from.a) * e;
      f.invalidate();
      if (t < 1) return true;
      this.anim = null;
      done?.();
      return false;
    });
  }

  /** The confirmation of songs just queued (Play next / Add to queue), with Undo taking them out again. */
  queued(entries, next) {
    if (!entries?.length) return null;
    const p = this.ctx.player;
    return this.show(next ? 'Playing next' : 'Added to queue', () => {
      p?.takeOut(entries.filter(e => !e.played && e !== (p.queueMode ? p.playingEntry : null)));
    }, {icon: '?toast_queue'});
  }
}

export function installUndoBar(ctx) {
  ctx.undoBar = new UndoBar(ctx);
  return ctx.undoBar;
}
