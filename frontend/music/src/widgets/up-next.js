// Up Next and History (owner, 2026-11-25): two windows over the player, opened from the playing
// song's menu (the cover held, or its three dots), where four items join the reference's
// (queueMenuItems): Play Next, Add to Queue, Up Next, History. No other button anywhere.
//
// Each window is the app's list dialog (dialog_AlertDialogActivity_list, a bottom sheet: it enters
// and leaves with the dialogs' scenes, a drag down or a tap outside closes it) with its rows as
// the library's: track rows (item_track at scene_small, the cover thumb by thumbFor) under the
// search's subheads (item_separator_button). Android Back closes it too (dialog.js closeOnBack).
//
// Up Next, top to bottom:
// - Now playing: one row, marked as the playing row is (its PlayingMark activated).
// - Queued: the songs the owner queued and not played yet, in their order, each with its drag
//   handle (list/reorder.js); Clear in the subhead's button empties it at once. Nothing queued:
//   one quiet line in the empty list's style.
// - Then, from <the list>: what follows from the playing list in its real order (its order, its
//   shuffle or the DJ's plan; Player.ahead), 30 rows, 30 more as the end comes into view.
// A tap plays a row now (an entry plays the Queue from it; a "Then" song plays in the list). A
// swipe left takes a Queued row out, or passes over a "Then" song this time round. Clear, a
// swipe and Play Next / Add to Queue show the Undo bar (widgets/undo-bar.js).
//
// History: the songs heard (player/play-history.js), newest first, each with when; a tap plays it.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {GONE, VISIBLE} from '../res/values.js';
import {PowerList, EMPTY_ROW} from '../list/power-list.js';
import {ListReorder} from '../list/reorder.js';
import {accelDecel, animClock, VelocityTracker, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';
import {openDialog} from './dialog.js';
import {animTime} from './topnav.js';
import {heardWhen} from '../player/play-history.js';
import {prewarmWindows} from './queue-prewarm.js';

export const WORDS = {
  upNext: 'Up Next', history: 'History', playNext: 'Play Next', addToQueue: 'Add to Queue',
  nowPlaying: 'Now playing', nextUp: 'Queued', then: 'Then', thenFrom: 'Then, from %s', clear: 'Clear',
  nothingQueued: 'Nothing queued. Select songs and choose Play Next.', nothingHeard: 'Nothing heard yet.',
  cleared: 'Queue cleared', removed: 'Removed from the queue', skipped: 'Skipped this time',
  queueEmpty: 'Nothing queued.', // the Queue list with nothing in it (list/sources.js)
};
const PAGE = 30;
// The window's rows move to their new places over this (the reorder's settle time, list/reorder.js).
const SETTLE_S = 0.25;
// A swipe takes a row out past this share of its width, or flung left.
const SWIPE_COMMIT = 0.4;

/**
 * The window's list: the library's list (PowerList) with a swipe left on a row (when the source
 * says the row can go: canSwipe) and rows that slide to their new places when the list changes.
 */
export class QueueList extends PowerList {
  constructor(ctx) {
    super(ctx, null, null);
    this.selectable = false;
    this.noScroller = true;
    this.swipe = null;
    this.moves = null;
  }

  /** The quiet line's row is made here (it has no layout of its own in the reference). */
  create(type, role) {
    if (type !== 'queueEmpty') return super.create(type, role);
    const v = this.ctx.inflater.inflateNode(EMPTY_ROW, null)[0];
    v.listItemType = type;
    v.poolKey = type;
    // It lays out at its size (it has no item scenes).
    v.setItemScene = (scene, w, h) => {
      v.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
      v.layout(v.left, v.top, v.left + w, v.top + h);
    };
    return v;
  }

  onInterceptStart(start, now) {
    const dx = now.rootX - start.rootX, dy = now.rootY - start.rootY;
    const v = start.target, i = v?.parent === this ? v.listIndex : -1;
    if (Math.abs(dx) > Math.abs(dy) && dx < 0 && i >= 0 && this.source?.canSwipe?.(i)) {
      this.stopFling();
      const vt = new VelocityTracker();
      vt.add(start.time, start.rootX, start.rootY);
      this.swipe = {v, i, x0: start.rootX, dx: 0, vt};
      return true;
    }
    return super.onInterceptStart(start, now);
  }

  onPointerMove(e) {
    const s = this.swipe;
    if (!s) { super.onPointerMove(e); return; }
    s.vt.add(e.time, e.rootX, e.rootY);
    s.dx = Math.min(0, e.rootX - s.x0);
    this.placeItems();
  }

  onPointerUp(e) {
    const s = this.swipe;
    if (!s) { super.onPointerUp(e); return; }
    s.vt.up(e?.time ?? performance.now());
    const vx = s.vt.compute(MAX_FLING_DP * this.ctx.dpr).vx;
    const w = s.v.width || this.width || 1;
    const go = !e?.cancelled && (s.dx < -w * SWIPE_COMMIT || (vx < -MIN_FLING_DP * this.ctx.dpr * 4 && s.dx < -w * 0.1));
    this.animateSwipe(s, go ? -w : 0, () => {
      this.swipe = null;
      if (go) this.source.onSwipe(s.i);
      else this.placeItems();
    });
  }

  /** The swiped row on to `to` (its width out, or 0 back), on the reorder's settle curve. */
  animateSwipe(s, to, done) {
    const from = s.dx, clock = animClock(), ms = Math.max(1, animTime(this.ctx, SETTLE_S) * 1000 * (this.ctx.animScale ?? 1));
    this.ctx.onFrame(now => {
      const t = Math.min(1, clock(now) / ms);
      s.dx = from + (to - from) * accelDecel(t);
      this.placeItems();
      if (t < 1) return true;
      done();
      return false;
    });
  }

  /**
   * The source's rows again (the same source, so the scroll stays): rows that were shown slide from
   * where they were to their new places, new ones fade in (animate), or all settle at once.
   */
  refresh(animate = true) {
    const s = this.source;
    if (!s) return;
    // Where each shown row is (by its key: an entry, a list place, a section), before the change.
    const was = new Map();
    for (const [i, v] of this.active) {
      if (v._key != null) was.set(v._key, v.translationY);
      v._key = null;
      this.recycle(i, v);
    }
    this.active.clear();
    this.moves = null;
    this.placeItems();
    if (!animate) return;
    // A row that was not shown moves with the row before it (rows coming up from below), or fades in
    // where it is (a row put back).
    const moves = new Map();
    let prev = 0;
    for (const [i, v] of [...this.active].sort((a, b) => a[0] - b[0])) {
      if (i < 0) continue;
      const old = was.get(v._key);
      const dy = old === undefined ? prev : old - v.translationY;
      const fade = old === undefined && !dy && was.size > 0;
      if (dy || fade) moves.set(i, {dy, fade});
      prev = dy;
    }
    if (!moves.size) return;
    const clock = animClock(), ms = Math.max(1, animTime(this.ctx, SETTLE_S) * 1000 * (this.ctx.animScale ?? 1));
    const run = this.moves = {map: moves, e: 0};
    this.placeItems();
    this.ctx.onFrame(now => {
      if (this.moves !== run) return false;
      const t = Math.min(1, clock(now) / ms);
      run.e = accelDecel(t);
      this.placeItems();
      if (t < 1) return true;
      this.moves = null;
      return false;
    });
  }

  placeItems() {
    super.placeItems();
    if (this.reorder || !this.source) return;
    for (const [i, v] of this.active) {
      if (i < 0) continue;
      v._key = this.source.keyAt?.(i) ?? null;
      const m = this.moves?.map.get(i);
      if (m) {
        v.translationY += m.dy * (1 - this.moves.e);
        if (m.fade) v.alpha = this.moves.e;
      }
      if (this.swipe?.i === i) {
        v.translationX += this.swipe.dx;
        v.alpha = Math.max(0, 1 + this.swipe.dx / (v.width || 1));
      }
      v.invalidate();
    }
    // The end of "Then" in view: more of it.
    const s = this.source;
    if (s.more && !this._moreQueued && this.active.has(s.count - 1)) {
      this._moreQueued = true;
      queueMicrotask(() => { this._moreQueued = false; s.more(); });
    }
  }

  /** A drag of Next up ended (list/reorder.js): the source applies the order; the rows are bound again. */
  applyOrder(map) {
    if (map.some((item, slot) => item !== slot)) this.source?.applyOrder?.(map);
    this.refresh(false);
  }
}

/** The window's content: the list, as tall as its rows up to the dialog's height (as Add to Playlist's). */
class QueueWindowLayout extends FastLayout {
  constructor(ctx) {
    super(ctx, null);
    this.list = new QueueList(ctx);
    this.list.lp = this.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'fill_parent'}));
    this.addView(this.list);
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec);
    const want = this.paddingTop + this.paddingBottom + (this.list.source ? this.list.contentHeight() : 0);
    const mode = MeasureSpec.getMode(hSpec), size = MeasureSpec.getSize(hSpec);
    const h = mode === MeasureSpec.EXACTLY ? size : mode === MeasureSpec.AT_MOST ? Math.min(size, want) : want;
    this.setMeasuredDimension(w, h);
    this.list.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(Math.max(0, h - this.paddingTop - this.paddingBottom), MeasureSpec.EXACTLY));
  }

  onLayout() {
    this.list.layout(0, this.paddingTop, this.width, this.height - this.paddingBottom);
  }
}

/** Row sizes of the library's lists (the list widget's substyle): a small track row and a subhead. */
function sizes(ctx) {
  const sub = ctx.listWidget?.substyle;
  const item = sub?.dim('itemSizeSmall', 0) || Math.round(56 * ctx.dpr);
  return {item, sep: sub?.dim('separatorSize', 0) || Math.round(32 * ctx.dpr)};
}

/** Shows a row's drag handle (Next up) or not, and lets a press on it start the drag. */
function dragHandle(v, on) {
  const h = v.findViewById('drag_handler');
  if (!h) return;
  if (!h._queueDrag) {
    h._queueDrag = true;
    h.performClick = () => false;
    h.onPointerDown = e => {
      const list = v.parent;
      const r = list ? ListReorder.start(list, v, v.listIndex) : null;
      if (!r) return false;
      h.setPressed(true);
      h.reorder = r;
      h.last = {x: e.rootX, y: e.rootY};
      return true;
    };
    h.onPointerMove = e => {
      if (!h.reorder) return;
      h.reorder.move(e.rootX - h.last.x, e.rootY - h.last.y);
      h.last = {x: e.rootX, y: e.rootY};
    };
    h.onPointerUp = () => { h.setPressed(false); h.reorder?.drop(); h.reorder = null; };
    h.onPointerCancel = () => h.onPointerUp();
  }
  const vis = on ? VISIBLE : GONE;
  if (h.visibility !== vis) {
    h.setVisibility(vis);
    v.forceLayoutTree?.();
    v.requestLayout();
  }
}

/** A track row: the library row's labels and thumb, the playing mark, and the drag handle where it moves. */
function bindTrack(v, track, {playing = false, handle = false, labels = null} = {}) {
  v.bind(track, false, false, labels);
  v.findViewById('select_box')?.setVisibility(GONE);
  dragHandle(v, handle);
  v.findViewById('playing_mark')?.setActivated(playing);
  v.setActivated?.(false);
}

/** A subhead row (the search's section rows): its title, and its button when it has one. */
function bindSubhead(v, title, button = null) {
  v.findViewById('title')?.setText(title);
  const b = v.findViewById('line2');
  if (!b) return;
  if (button) {
    b.setVisibility(VISIBLE);
    b.setText(button.label);
    b.onClick = button.onClick;
  } else b.setVisibility(GONE);
}

/** The quiet line of an empty section (the empty list's text). */
function bindEmpty(v, text) {
  v.findViewById('item_empty_list_text')?.setText(text);
}

/** A list source of rows ({sep}, {empty}, or a row with a track), with the list's sizes. */
function rowsSource(ctx, rows) {
  const {item, sep} = sizes(ctx);
  const src = {
    rows, itemType: 'track', itemScene: 'scene_small', columns: 1, itemHeight: item, header: null,
    separatorHeight: sep, separators: [],
    get count() { return this.rows.length; },
    typeAt: i => (src.rows[i]?.sep != null ? 'separator' : src.rows[i]?.empty != null ? 'queueEmpty' : undefined),
    isSeparator: i => src.rows[i]?.sep != null || src.rows[i]?.empty != null,
    tracksAt: i => (src.rows[i]?.track ? [src.rows[i].track] : []),
    keyAt: i => src.rows[i]?.key ?? null,
    // Subheads and the quiet line take the subhead's height.
    setRows(next) { src.rows = next; src.separators = next.flatMap((r, i) => (r.sep != null || r.empty != null ? [i] : [])); },
  };
  src.setRows(rows);
  return src;
}

/** The Up next rows of the player as it is now: Now playing, Next up, Then. */
function upNextRows(ctx, p, aheadN, clear) {
  const rows = [], t = p.track;
  if (t) {
    rows.push({sep: WORDS.nowPlaying, key: 's:now'});
    rows.push({now: true, track: t, key: 'now'});
  }
  const up = p.nextUp();
  rows.push({sep: WORDS.nextUp, key: 's:up', button: up.length ? {label: WORDS.clear, onClick: clear} : null});
  if (up.length) for (const e of up) rows.push({entry: e, track: e.track, key: e});
  else rows.push({empty: WORDS.nothingQueued, key: 'empty'});
  const ahead = p.ahead(aheadN);
  if (ahead.length) {
    const name = p.listName();
    rows.push({sep: name ? WORDS.thenFrom.replace('%s', name) : WORDS.then, key: 's:then'});
    for (const a of ahead) rows.push({then: a.index, track: a.track, key: 'then:' + a.index});
  }
  return {rows, more: ahead.length >= aheadN};
}

/** Opens a window of rows (Up next, History): the dialog, its list, and its life (Back closes it). */
function openWindow(ctx, title, build) {
  let content = null, unsub = [];
  const dialog = openDialog(ctx, {
    style: 'dialog_AlertDialogActivity_list', title, back: true,
    onClosed: () => unsub.forEach(u => u()),
    setup: d => {
      const host = d.find('content');
      if (!host) return;
      // One content per window, kept (windowContent; made ahead: queue-prewarm.js): its rows listen while they live.
      content = windowContent(ctx, title);
      content.parent?.removeView(content);
      content.list.swipe = null;
      content.list.moves = null;
      content.lp = host.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content'}));
      host.addView(content);
      unsub = build(content.list, d) ?? [];
    },
  });
  dialog.list = content?.list ?? null;
  return dialog;
}

const windowContent = (ctx, title) => (ctx.queueWindows ??= new Map()).get(title) ?? ctx.queueWindows.set(title, new QueueWindowLayout(ctx)).get(title);
/** Up next (B). */
export function openUpNext(ctx) {
  const p = ctx.player;
  if (!p) return null;
  return openWindow(ctx, WORDS.upNext, list => {
    let aheadN = PAGE, queued = false;
    const clear = () => {
      const gone = p.clearNextUp();
      if (gone.length) ctx.undoBar?.show(WORDS.cleared, () => p.putBack(gone), {icon: '?toast_queue'});
    };
    const src = rowsSource(ctx, []);
    const fill = () => {
      const {rows, more} = upNextRows(ctx, p, aheadN, clear);
      src.setRows(rows);
      src.more = more ? () => { aheadN += PAGE; fill(); list.refresh(false); } : null;
      const first = rows.findIndex(r => r.entry), last = rows.findLastIndex(r => r.entry);
      // Next up's rows move among themselves (two or more).
      src.reorderable = last > first;
      src.reorderRange = last > first ? [first, last] : null;
    };
    Object.assign(src, {
      reorderAlways: true,
      bindItem(v, i) {
        const r = src.rows[i];
        if (r.sep != null) bindSubhead(v, r.sep, r.button);
        else if (r.empty != null) bindEmpty(v, r.empty);
        else bindTrack(v, r.track, {playing: !!r.now, handle: !!r.entry && src.reorderable});
      },
      onItemClick(i) {
        const r = src.rows[i];
        if (r?.entry) p.playEntry(r.entry);
        else if (r?.then != null) p.playListAt(r.then);
      },
      canSwipe: i => !!(src.rows[i]?.entry || src.rows[i]?.then != null),
      onSwipe(i) {
        const r = src.rows[i];
        if (r?.entry) {
          const gone = p.takeOut([r.entry]);
          if (gone.length) ctx.undoBar?.show(WORDS.removed, () => p.putBack(gone), {icon: '?toast_queue'});
        } else if (r?.then != null) {
          const at = r.then;
          p.skipOnce(at, true);
          ctx.undoBar?.show(WORDS.skipped, () => p.skipOnce(at, false), {icon: '?toast_queue'});
        }
      },
      applyOrder(map) {
        const [lo, hi] = src.reorderRange ?? [0, -1];
        const sub = map.slice(lo, hi + 1).map(k => src.rows[k]?.entry).filter(Boolean);
        if (sub.length === hi - lo + 1) p.reorderNextUp(sub);
        fill();
      },
    });
    fill();
    list.setSource(src);
    // The player changes (a song ends, a song is queued elsewhere, an undo): the rows follow.
    const update = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (list.reorder || list.swipe) { setTimeout(update, 100); return; }
        fill();
        list.refresh(true);
        list.requestLayout();
        list.parent?.requestLayout();
        ctx.scheduleLayout();
      });
    };
    return [ctx.bus.subscribe('bus_player', (msg, s, d) => {
      if (msg === 'msg_player_track_changed' ? !d?.meta : /^msg_player_(queue_changed|category_changed|shuffle_mode_changed|repeat_mode_changed)$/.test(msg)) update();
    })];
  });
}

/** History (C). */
export function openHistory(ctx) {
  const p = ctx.player;
  if (!p) return null;
  return openWindow(ctx, WORDS.history, list => {
    const src = rowsSource(ctx, []);
    const fill = () => {
      const heard = p.history.entries(id => p.trackById(id));
      src.setRows(heard.length ? heard.map(({entry, track}) => ({entry, track, key: entry})) : [{empty: WORDS.nothingHeard, key: 'empty'}]);
    };
    Object.assign(src, {
      bindItem(v, i) {
        const r = src.rows[i];
        if (r.empty != null) bindEmpty(v, r.empty);
        else bindTrack(v, r.track, {labels: {meta: heardWhen(r.entry.at)}});
      },
      onItemClick(i) {
        const r = src.rows[i];
        if (!r?.track) return;
        // In the playing list it plays there; else it plays now and the list goes on after it.
        const at = p.indexNear(r.track);
        if (at >= 0) p.load(at, true);
        else p.interject(r.track, true);
      },
    });
    fill();
    list.setSource(src);
    return [p.history.onChange(() => {
      fill();
      list.refresh(true);
      list.parent?.requestLayout();
      ctx.scheduleLayout();
    })];
  });
}

/** Queues the playing song (Play next or Add to queue) and says so, with Undo. */
function queuePlaying(ctx, next) {
  const p = ctx.player, t = p?.track;
  if (!t) return;
  ctx.undoBar?.queued(p.enqueue([t], next), next);
}

// The playing song's menu: the four items in one row at its top, as the selection menu's buttons
// are (?SelectionListContextButton: a quarter of the width, the icon over its label), under the
// song and above Add to Playlist: two rows of the menu's own items would pass its height
// (ItemPopupMenu_scene_item_menu_maxHeight) and cut off Folder and Genre.
const MENU_ITEMS = [
  ['queue_play_next', WORDS.playNext, '@drawable/insert_top_24dp'],
  ['queue_add', WORDS.addToQueue, '?enqueue'],
  ['queue_up_next', WORDS.upNext, '@drawable/q_circle_24dp'],
  ['queue_history', WORDS.history, '@drawable/recently_played_12dp'],
];

/** Adds the items to the cover's menu items (list-widget.js openItemMenu, once per item view). */
export function queueMenuItems(ctx, items) {
  if (!items || items.findViewById('queue_up_next')) return;
  const top = items.findViewById('separator');
  const pos = {at: top ? items.children.indexOf(top) + 1 : 0};
  const node = (id, text, icon) => ['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/' + id, 'android:text': text, 'android:drawable': icon, 'w:busId': '@id/bus_gui', 'w:msgId': '@id/cmd_' + id,
    style: '?SelectionListContextButton', 'android:paddingLeft': '0.0dip', 'android:paddingTop': '6.0dip', 'android:paddingRight': '0.0dip', 'android:paddingBottom': '4.0dip',
  }];
  for (const [id, text, icon] of MENU_ITEMS) ctx.inflater.inflateNode(node(id, text, icon), items, null, pos);
  ctx.inflater.inflateNode(['com.maxmpz.widget.base.NonOverlappingView', {'android:id': '@id/queue_separator', style: '?ItemPopupMenuSeparator2'}], items, null, pos);
}

/** The menu items' commands. */
export function installUpNext(ctx) {
  prewarmWindows(ctx, [WORDS.upNext, WORDS.history].map(title => () => windowContent(ctx, title)));
  ctx.bus.subscribe('bus_gui', msg => {
    switch (msg) {
      case 'cmd_queue_play_next': queuePlaying(ctx, true); break;
      case 'cmd_queue_add': queuePlaying(ctx, false); break;
      case 'cmd_queue_up_next': openUpNext(ctx); break;
      case 'cmd_queue_history': openHistory(ctx); break;
    }
  });
}
