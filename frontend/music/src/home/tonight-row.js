// Music's "tonight" mix (th/music/tonight.js) as a row of Home, made of the app's own pieces: the
// tiles' backing (row-view.js tileBacking, at the small covers' radius), its label in
// the rows' second-line type, its name in the rows' title type and its detail in their meta type; Play
// as the list header's play button, Why and Dismiss as its text buttons; Why opens the reason under
// them in the second-line type. The card the shell made (th/ported/arrangement.js) stays the source:
// its words are read from it and each button here presses its own (so the senses, the play and the
// dismissal are the card's), and it is never shown while Home is on (app.css hides it). Hidden, the
// shell's card never comes on screen to report itself seen; this one does instead (watchSeen), as the
// shell's would: once most of it has been on screen, the library shown (ctx.tonightSeen, tonight.js).
import {MeasureSpec} from '../view/view.js';
import {whenStill} from '../view/motion.js';
import {FastButton} from '../view/text.js';
import {GONE, VISIBLE} from '../res/values.js';
import {RowView, styled, tileBacking, smallRadius} from './row-view.js';

const AT_MOST = n => MeasureSpec.make(Math.max(0, Math.round(n)), MeasureSpec.AT_MOST);
const ANY = MeasureSpec.make(0, MeasureSpec.UNSPECIFIED);
const text = (card, sel) => card?.querySelector(sel)?.textContent?.trim() ?? '';

/** The card's words: {label, title, detail, why}. */
export function tonightWords(card) {
  return {label: text(card, '.th-arr-text small'), title: text(card, '.th-arr-text strong'), detail: text(card, '.th-arr-text span'), why: text(card, '.th-arr-why')};
}

export class TonightCard extends RowView {
  constructor(ctx) {
    super(ctx);
    const r = smallRadius(ctx);
    this.background = tileBacking(ctx, r);
    const tv = (look, color, extra = {}) => {
      const v = ctx.inflater.create('TextView', ctx.inflater.styledAttributes({'android:textAppearance': look, 'android:textColor': color, ...extra}), null);
      this.addView(v);
      return v;
    };
    this.label = tv('?ItemTrackLine2_Text', '?android:textColorPrimary', {'android:maxLines': '1', 'android:ellipsize': 'end'});
    this.title = tv('?ItemTrackTitle_Text', '?android:textColorPrimary', {'android:maxLines': '2', 'android:ellipsize': 'end'});
    this.detail = tv('?ItemTrackMeta_Text', '?colorTrackMeta', {'android:maxLines': '1', 'android:ellipsize': 'end'});
    this.why = tv('?ItemTrackLine2_Text', '?android:textColorPrimary', {'android:maxLines': '6', 'android:ellipsize': 'end'});
    const button = (style, word) => {
      const b = new FastButton(ctx, styled(ctx, style));
      b.lp = this.generateLayoutParams(null);
      b.visibility = VISIBLE;
      b.scaleX = b.scaleY = 1;
      if (word) b.setText(word);
      this.addView(b);
      return b;
    };
    this.play = button('ItemTextHeaderPlayButton');
    this.play.contentDescription = 'Play';
    this.whyButton = button('ItemTextHeaderSelectButton', 'Why');
    this.dismiss = button('ItemTextHeaderSelectButton', 'Dismiss');
    const press = sel => () => this.card?.querySelector(sel)?.click();
    this.play.onClick = press('.th-arr-go');
    this.whyButton.onClick = () => { this.ctx.tonightWhy = !this.ctx.tonightWhy; this.ctx.homeRefresh?.(); };
    this.dismiss.onClick = () => { press('.th-arr-x')(); this.ctx.tonightWhy = false; this.ctx.homeRefresh?.(); };
    // The library coming on screen (once its transition has ended): looked at again.
    ctx.bus?.subscribe('bus_gui', msg => {
      if (msg === 'msg_nav_changed' && this.card) requestAnimationFrame(() => whenStill(ctx, () => this.watchSeen(), this));
    });
  }

  /** Whether the card is on the library's screen: the library shown, the card and every view above it shown. */
  shown() {
    const {ctx} = this;
    if (ctx.listWidget?.mode !== 'list' || ctx.topNav?.nav !== 'nav_lib') return false;
    for (let p = this; p; p = p.parent) { if (p.visibility !== VISIBLE) return false; if (p === ctx.root) return this.width > 0; }
    return false;
  }

  /**
   * "Seen", once a day (th/ported/arrangement.js seen), when 60 % of the card has been on screen with the
   * library shown (the shell's card's own rule, its watch). Armed again on each bind and each trip to the
   * library until it has been reported for this card.
   */
  watchSeen() {
    const {ctx, card} = this, report = ctx.tonightSeen;
    this.seenWatch?.disconnect();
    this.seenWatch = null;
    // (The measuring card, ctx.tonightMeasure, is never in the page: nothing to watch.)
    if (this === ctx.tonightMeasure || !card || !report || ctx.tonightSeenFor === card || typeof IntersectionObserver === 'undefined' || !this.el) return;
    const io = this.seenWatch = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting) || !this.shown()) return;
      io.disconnect();
      if (this.seenWatch === io) this.seenWatch = null;
      if (ctx.tonightSeenFor === card) return;
      ctx.tonightSeenFor = card;
      report(card);
    }, {threshold: 0.6});
    io.observe(this.el);
  }

  bindCard(card, open) {
    this.card = card;
    const w = tonightWords(card);
    this.label.setText(w.label);
    this.title.setText(w.title);
    this.detail.setText(w.detail);
    this.detail.visibility = w.detail ? VISIBLE : GONE;
    this.why.setText(w.why);
    this.why.visibility = open && w.why ? VISIBLE : GONE;
    this.whyButton.setActivated?.(!!open);
    this.requestLayout();
    this.watchSeen();
  }

  /** Each piece's box for a width: {height, boxes: [[view, x, y, w, h]]}. */
  arrange(w) {
    const pad = this.dp(16), inner = Math.max(0, w - 2 * pad), boxes = [];
    let y = pad;
    const line = v => {
      if (v.visibility === GONE) return;
      v.measure(AT_MOST(inner), ANY);
      boxes.push([v, pad, y, inner, v.measuredHeight]);
      y += v.measuredHeight;
    };
    line(this.label); line(this.title); line(this.detail);
    y += this.dp(8);
    for (const b of [this.play, this.whyButton, this.dismiss]) b.measure(AT_MOST(inner), ANY);
    const bh = Math.max(this.play.measuredHeight, this.whyButton.measuredHeight);
    const gap = this.dp(8);
    boxes.push([this.play, pad, y, this.play.measuredWidth, this.play.measuredHeight]);
    boxes.push([this.whyButton, pad + this.play.measuredWidth + gap, y, this.whyButton.measuredWidth, this.whyButton.measuredHeight]);
    boxes.push([this.dismiss, w - pad - this.dismiss.measuredWidth, y, this.dismiss.measuredWidth, this.dismiss.measuredHeight]);
    y += bh;
    if (this.why.visibility !== GONE) { y += this.dp(8); line(this.why); }
    return {height: y + pad, boxes};
  }

  place(w) {
    for (const [v, x, y, bw, bh] of this.arrange(w).boxes) this.put(v, x, y, bw, bh);
  }
}

/** The row: the card inset as the tiles are. */
export class TonightRow extends RowView {
  constructor(ctx) {
    super(ctx);
    this.card = new TonightCard(ctx);
    this.addView(this.card);
  }

  bindRow(row) {
    this.row = row;
    this.card.bindCard(row.card, row.open);
    this.requestLayout();
  }

  place(w, h) {
    const side = this.row?.side ?? this.dp(8), v = this.dp(4);
    this.put(this.card, side, v, w - 2 * side, h - 2 * v);
  }
}

/** The row's height for the list's width (measured on a card made once for it). */
export function tonightRowHeight(ctx, w, card, open, side) {
  const m = ctx.tonightMeasure ??= new TonightCard(ctx);
  m.bindCard(card, open);
  return m.arrange(w - 2 * side).height + Math.round(8 * ctx.dpr);
}
