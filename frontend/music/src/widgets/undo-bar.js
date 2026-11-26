// The Undo bar (owner, 2026-11-25): a short bar above the mini-player with a message and an Undo
// action, gone after about 5 seconds. It is the lower toast's own frame (?TopToastFrame_scene_expanded:
// toast_bg, its paddings and its place 60 dp above the bottom) with the toast's icon and title, and
// an Undo button where the upper toast has its close button. It slides up into place and back down
// as the toast's scenes move it, over the toast's times (300 / 250 ms, the Animations setting
// applied). One at a time: a new one takes the place of the one showing (whose undo then lapses),
// and so does any other toast. It stands above an open dialog (Up Next, History), so its undo can
// be reached there too: at the window's inner bottom edge, the window's list given that much more
// room at its end so its last rows scroll clear of the bar. It follows the screen while it shows: a
// change of screen, of the window's size, or a window opening or closing places it again (follow).
// Its icon takes the title's colour, as the toast's own (tinted) icons do. It never covers an open menu
// (a popup's, the cover's or a header's item menu, the navbar sheet: each a GUI modal while open) and
// never takes a tap meant for one. When one opens, a line that only says something and has been up
// READ_MS goes at once; a line with Undo, and a line just shown (a download's "Saved to Downloads" may
// come as the owner opens a menu), moves clear of the menu's box, above it or else below it. With no
// room on either side it waits out of sight, and shows again for the rest of its time (READ_MS at
// least) once the menus close: no line is lost before it could be read.
//
// API (installed at startup as ctx.undoBar):
//   ctx.undoBar.show(message, onUndo, {ms = 5000, icon = null, action = 'Undo'} = {})
//     Shows the bar; onUndo() runs once if Undo is tapped before the bar goes. icon: a drawable
//     value such as '?toast_queue'. Returns {hide()} for this bar (no effect once another shows).
//   ctx.undoBar.hide()            Hides the bar now (its undo lapses).
//   ctx.undoBar.follow()          Places the bar again until its place holds (dialog.js calls it).
//   ctx.undoBar.queued(entries, next)
//     "Playing next" / "Added to queue" for Queue entries just added (Player.enqueue returns
//     them); Undo takes out those of them still waiting.
import {GONE, VISIBLE} from '../res/values.js';
import {accelDecel, animClock} from '../gesture.js';
import {FastLayout} from '../view/fast-layout.js';
import {animTime} from './topnav.js';

export const UNDO_MS = 5000;
/** A line that only says something and has been up this long may go when a menu opens: it has been read. */
export const READ_MS = 1000;
const IN_S = 0.3, OUT_S = 0.25;
// Following a change: at least this long (a screen's or a window's scene), and until the place has held
// for STILL_FRAMES frames; never longer than FOLLOW_MAX_MS.
const FOLLOW_MIN_MS = 400, FOLLOW_MAX_MS = 2000, STILL_FRAMES = 3;
// The gap (dp) between a window's last row and the bar over it, and between the bar and an open menu.
const ROW_GAP_DP = 8;
// The GUI modals that are menus (popup.js, list-widget.js openItemMenu, navbar.js setSheet).
const MENU_MODALS = new Set(['popup_menu', 'popup_menu_item', 'navbar']);

/** The bar's views, as a layout of the reference's toast parts (inflated by the app's inflater). */
const BAR = ['FastLayout', {'android:id': '@id/undo_bar', style: '?TopToastFrame_scene_expanded', 'android:importantForAccessibility': 'no'}, [
  ['FastTextView', {'android:id': '@id/icon', style: '?TopToastIcon'}],
  // The text keeps clear of the button (ACTION_DIP).
  ['FastTextView', {'android:id': '@id/title', style: '?TopToastTitle', 'android:layout_marginRight': '64.0dip', 'android:maxLines': '2', 'android:ellipsize': 'end'}],
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
    // The menus open now, as the views whose boxes the bar keeps clear of.
    this.menus = [];
    // Any other toast takes the bar's place; a change of screen moves it; a menu opening sends it away.
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'cmd_gui_show_toast' && this.current) this.hide();
      else if (msg === 'msg_nav_changed') this.follow();
      else if ((msg === 'cmd_gui_set_modal' || msg === 'cmd_gui_unset_modal') && MENU_MODALS.has(d?.arg1)) this.menuModal(msg === 'cmd_gui_set_modal', src);
    });
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.follow());
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
    // The icon in the title's colour (the toast's icons are tinted ones; the menus' glyphs are not).
    const iv = this.frame.findViewById('icon'), title = this.frame.findViewById('title');
    if (iv && title?.textColor) iv.drawableTint = title.textColor;
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
    const now = performance.now(), bar = this.current = {message, onUndo, undone: false, shownAt: now, ends: now + ms};
    const handle = {hide: () => { if (this.current === bar) this.hide(); }};
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.current === bar) this.hide(); }, ms);
    this.parked = false;
    const was = f.visibility === VISIBLE;
    // With a menu open the bar is placed at its new size (unseen until then: alpha 0 takes no tap).
    if (this.menus.length) {
      if (!was) { f.alpha = 0; f.visibility = VISIBLE; }
      f.forceLayoutTree?.();
      ctx.layoutRoot();
    }
    // No room clear of an open menu: the line waits out of sight until the menus close (place, park).
    if (this.place() === null) { this.follow(); return handle; }
    f.visibility = VISIBLE;
    f.forceLayoutTree?.();
    f.requestLayout();
    ctx.scheduleLayout();
    // Slides up from where the toast's default scene keeps it (its 60 dp lower), fading in.
    if (!was) { f.alpha = 0; f.translationY = this.travel(); }
    this.move(0, 1, animTime(ctx, IN_S));
    // Once it has its size (the room it makes in a window), and while a screen it came with settles.
    this.follow();
    f.el?.setAttribute('role', 'status');
    return handle;
  }

  /** A menu opened or closed (src: the PopupLayout, the ListWidget showing its item menu, the Navbar). */
  menuModal(open, src) {
    const at = this.menus.indexOf(src);
    if (!open) { if (at >= 0) this.menus.splice(at, 1); this.follow(); return; }
    if (at < 0) this.menus.push(src);
    // A line that only says something and has been read goes; any other moves clear (place).
    const c = this.current;
    if (c && !c.onUndo && !this.parked && performance.now() - c.shownAt >= READ_MS) this.hide(true);
    else this.follow();
  }

  /** The boxes (root coordinates) of the menus open now. */
  menuBoxes() {
    const out = [];
    for (const src of this.menus) {
      const v = src.menuItem?.v ?? (typeof src.sheet === 'boolean' ? src.ext : src);
      if (!v?.el || v.visibility !== VISIBLE || !v.width || !v.height) continue;
      const {x, y} = v.getLocationIn(null);
      out.push({x, y, w: v.width, h: v.height});
    }
    return out;
  }

  /**
   * The bottom margin `want` moved so the bar keeps clear of every open menu: above the menu, else
   * below it; null when neither has room. Where the bar is drawn counts: the margin takes up its slide
   * (translationY), so it stands still clear of the menu while it slides in.
   */
  clearOfMenus(want, inset) {
    const root = this.ctx.root, f = this.frame, h = f.height, gap = Math.round(ROW_GAP_DP * this.ctx.dpr);
    const top = this.host.getInsets?.().top ?? 0, fx = f.getLocationIn(null).x, ty = f.translationY || 0;
    for (let tries = 0, moved = true; moved && tries < 4; tries++) {
      moved = false;
      for (const m of this.menuBoxes()) {
        const barTop = root.height - inset - want - h + ty;
        if (barTop >= m.y + m.h || barTop + h <= m.y || fx >= m.x + m.w || fx + f.width <= m.x) continue;
        if (m.y - gap - h >= top) want = root.height - inset - (m.y - gap) + ty;
        else if (m.y + m.h + gap + h <= root.height - inset) want = root.height - inset - (m.y + m.h + gap + h) + ty;
        else return null;
        moved = true;
      }
    }
    return want;
  }

  /**
   * Above everything shown now (a window opened since included): over an open window of rows (Up
   * Next, History) at its inner bottom edge, else above the mini-player where it shows (the library),
   * else where the toast is (above the tabs; a dialog with buttons keeps them clear so). Returns the
   * bottom margin it takes.
   */
  place() {
    const f = this.frame, lp = f.lp, ctx = this.ctx, root = ctx.root;
    if (root.children.at(-1) !== this.host) { root.removeView(this.host); root.addView(this.host); }
    this.baseBottom ??= lp.bottomMargin;
    const inset = this.host.getInsets?.().bottom ?? 0;
    const top = ctx.dialogs?.at(-1), win = top?.list ? top.find('dialog_frame') : null;
    let want;
    if (win) want = Math.max(0, root.height - inset - (win.getLocationIn(null).y + win.height - win.paddingBottom));
    else {
      const nb = root.findViewById('navbar');
      const top = nb && nb.visibility === VISIBLE ? nb.getLocationIn(null).y : null;
      want = top === null ? this.baseBottom : Math.max(this.baseBottom, root.height - inset - top);
    }
    if (this.menus.length && this.current) {
      // (A bar out of sight keeps the size it last had; one never laid out is placed once it has one.)
      if (f.height) want = this.clearOfMenus(want, inset);
      else if (this.parked) want = null;
      if (want === null) { this.park(); return null; }
    }
    if (this.parked) this.unpark();
    if (lp.bottomMargin !== want) { lp.bottomMargin = want; f.requestLayout(); ctx.scheduleLayout(); }
    this.makeRoom(win ? top : null, want);
    return want;
  }

  /**
   * The open window's list (Up Next, History) gets the bar's height and a gap more room at its end
   * while the bar covers its bottom, so its last rows scroll clear of the bar; the room goes with the
   * bar or the window.
   */
  makeRoom(dialog, bottom) {
    const list = this.current && dialog ? dialog.list ?? null : null;
    const was = this.roomList;
    if (was && was !== list) {
      was.paddingBottom = was._undoPad0;
      // A window on its way out keeps its size (it lays out afresh when it opens again).
      if (!this.roomDialog?.closed) { was.requestLayout(); was.parent?.requestLayout(); }
      this.roomList = this.roomDialog = null;
    }
    if (!list) return;
    list._undoPad0 ??= list.paddingBottom;
    const root = this.ctx.root, inset = this.host.getInsets?.().bottom ?? 0;
    const barTop = root.height - inset - bottom - this.frame.height;
    const covered = list.getLocationIn(null).y + list.height > barTop;
    const pad = list._undoPad0 + (covered ? this.frame.height + Math.round(ROW_GAP_DP * this.ctx.dpr) : 0);
    this.roomList = list;
    this.roomDialog = dialog;
    if (list.paddingBottom !== pad) { list.paddingBottom = pad; list.requestLayout(); list.parent?.requestLayout(); }
  }

  /** Places the bar again each frame while what is under it moves (a screen, a window), until it holds. */
  follow() {
    if (!this.current || !this.frame) return;
    const t0 = performance.now();
    let last = null, still = 0;
    this.stopFollow?.();
    this.stopFollow = this.ctx.onFrame(now => {
      if (!this.current) { this.stopFollow = null; return false; }
      const at = this.place();
      still = at === last ? still + 1 : 0;
      last = at;
      const ms = now - t0;
      // While a menu is open the bar keeps clear of it however it moves.
      if (this.menus.length || (ms < FOLLOW_MAX_MS && (ms < FOLLOW_MIN_MS || still < STILL_FRAMES))) return true;
      this.stopFollow = null;
      return false;
    });
  }

  /**
   * No room clear of the open menus: the bar is out of sight at once (it takes no tap) and its line
   * waits, its time stopped, to show again once there is room (unpark).
   */
  park() {
    if (this.parked) return;
    this.parked = true;
    clearTimeout(this.timer);
    const c = this.current;
    c.left = Math.max(READ_MS, c.ends - performance.now());
    this.makeRoom(null, 0);
    this.anim?.();
    this.anim = null;
    this.frame.visibility = GONE;
    this.frame.invalidate();
    this.ctx.scheduleLayout();
  }

  /** Room again: the waiting line slides in for the rest of its time, as read from now. */
  unpark() {
    this.parked = false;
    const c = this.current, f = this.frame, now = performance.now();
    c.shownAt = now;
    c.ends = now + c.left;
    this.timer = setTimeout(() => { if (this.current === c) this.hide(); }, c.left);
    f.visibility = VISIBLE;
    f.alpha = 0;
    f.translationY = this.travel();
    f.forceLayoutTree?.();
    f.requestLayout();
    this.ctx.scheduleLayout();
    this.move(0, 1, animTime(this.ctx, IN_S));
  }

  /** Hides the bar: sliding down, or at once (now) when it must not stand over a menu even while it goes. */
  hide(now = false) {
    // Over an open menu it never slides down across it.
    if (this.menus.length) now = true;
    clearTimeout(this.timer);
    this.current = null;
    this.parked = false;
    this.stopFollow?.();
    this.stopFollow = null;
    this.makeRoom(null, 0);
    if (!this.frame || this.frame.visibility !== VISIBLE) return;
    if (now) {
      this.anim?.();
      this.anim = null;
      this.frame.visibility = GONE;
      this.frame.invalidate();
      this.ctx.scheduleLayout();
      return;
    }
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
