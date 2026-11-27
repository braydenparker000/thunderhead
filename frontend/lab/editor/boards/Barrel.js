// @ts-nocheck
// A board's sections, changed by swiping its panel (the owner, 2026-11-18). Swiped up, the panel slides up under the
// finger, one for one, and the next section comes up from below it; down, the one before. Let go past 40 design px (or
// a quarter of the section, if less), or flicked, and it goes on to that section; short of that it slides back. Round:
// past the last section comes the first. Each section stands at its own height on the screen's foot, so a taller one
// (the curve, a grading wheel) rises over the photo's lower edge as it comes in, and the photo takes its new room once,
// as it lands; while the panel slides the photo's room is held as it was, to the fraction (whole pixels moved it on a
// phone, and the photo was fitted and made again at every swipe: 2026-11-18). What slides are still copies of the
// panel, one for each section in view, cut to its own height, inside a window cut to the panel's place; the panel
// itself stays where it is, unseen, and is shown again as it lands, on the section it landed on. The board is asked
// for the coming section a frame after the panel starts to move, so the panel answers the finger at once. The slide
// keeps time on a slow phone (240 ms a whole section). A swipe sideways stays the panel's own (its dial, its row, its
// tiles), and so does a drag on what a finger moves every way (the curve, a grading wheel: marked `data-drag`). The
// photo's own work waits while the panel moves (zoom.js `dial`). A tick as each section comes past half way
// (app/haptic.js), and how each swipe went is noted for the reports (app/moved.js: `swipe`). For a keyboard and a
// screen reader the sections are a list (role listbox: the arrow keys slide it, an option chosen slides to it).
// Props: `faces` [{ label, count }], `at`, `onpick(i)`. The section is told to the tool dial as `editor:section`, once landed.
import { DCLogic } from '../dc.js';
import { tick } from '../app/haptic.js';
import { moved } from '../app/moved.js';
import { counts, dial, info } from '../app/zoom.js';

const GO = 40, LOCK = 8, FLICK = 0.45, MS = 240;   // px past which a let-go goes on; px before a finger's way is known; px a ms that is a flick; ms a section
const SHADOW = '0 -10px 24px rgba(0,0,0,0.7)';   // the panel's own, over the photo's foot
const mod = (i, n) => ((i % n) + n) % n, ease = (t) => 1 - (1 - t) ** 3;
let told = '';   // the section last told the tool dial

export default class Component extends DCLogic {
  constructor(props) { super(props); this.g = null; this.seg = null; this.anim = 0; this.ask = 0; this.faces = new Map(); this.live = 0; this.quiet = 0; this.near = -1; this.next = null; this.feel = {}; }
  renderVals() {
    const faces = this.props.faces || [], at = Math.max(0, Math.min(faces.length - 1, this.props.at ?? 0));
    if (!this.seg) { this.live = at; this.tell(faces, at); }
    queueMicrotask(() => this.attach());
    return {
      now: faces[at]?.label || '', faces: faces.map((f, i) => ({ label: String(f.label || '').toUpperCase(), count: f.count ? String(f.count) : '', on: String(i === at), pick: () => this.go(i) })),
      key: (e) => { const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!d) return; e.preventDefault(); this.go(mod(this.live + d, this.n()), d); },
    };
  }
  n() { return (this.props.faces || []).length; }
  busy() { return !!this.g || !!this.seg; }
  /** The section in view, to the tool dial (once it has landed: not the one a swipe is only trying). */
  tell(faces = this.props.faces || [], at = this.live) {
    const now = faces[at]?.label || '';
    if (now !== told) { told = now; document.dispatchEvent(new CustomEvent('editor:section', { detail: { label: now, faces: faces.map((f) => f.label) } })); }
  }
  /** Takes the panel it stands in: its swipes, seen before its own controls. One owner a panel, whose touches it hears
   * (a board that drew this list again, as a new one, on the same panel had two that both took a swipe: 2026-11-18);
   * a new one takes over once the one before has landed. */
  attach() {
    const plate = this._host?.el?.closest?.('.plate');
    if (!plate || plate === this.plate) return;
    this.plate = plate; this.stage = plate.closest('#stage') || plate.parentElement;
    const was = plate._barrel; if (was?.busy()) was.heir = this; else plate._barrel = this;
    if (plate._heard) return;
    plate._heard = true; plate.classList.add('barrel');
    const o = { capture: true }, to = (f) => (e) => plate._barrel?.[f](e);
    for (const [type, f] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'up'], ['click', 'tap']]) plate.addEventListener(type, to(f), o);
  }
  tap(e) { if (performance.now() - this.quiet < 60) { e.stopPropagation(); e.preventDefault(); } }   // the swipe's own end is no tap
  down(e) {
    if (this.g || (e.button ?? 0) > 0 || this.n() < 2) return;
    const seg = this.seg;
    if (seg && e.pointerType === 'mouse') { this.land(this.to === 1 && seg.dir ? seg.b : seg.a); return; }   // a click as it slides (after a key): it is there at once, and the click is the control's
    if (!seg && e.target.closest?.('[data-drag]')) return;   // (what a finger moves every way keeps its drags; while the panel slides, a finger on it catches the slide)
    this.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, k: this.stage.getBoundingClientRect().width / 412 || 1, way: seg ? 'v' : '', start: seg ? seg.base + seg.dir * seg.s : 0, trail: [], target: e.target, caught: !!seg };
    if (!seg) return;
    cancelAnimationFrame(this.anim); this.anim = 0; e.stopPropagation();   // caught while it slides: it goes on from where it is (or, let go still, on where it was going)
    try { this.plate.setPointerCapture(e.pointerId); } catch { /* followed while over the panel */ }
  }
  move(e) {
    const g = this.g; if (!g || e.pointerId !== g.id || this.sending) return;
    const dx = (e.clientX - g.x0) / g.k, dy = (e.clientY - g.y0) / g.k;
    if (!g.way) {
      if (Math.hypot(dx, dy) < LOCK) { e.stopPropagation(); return; }   // held back from the panel's controls until it is known which way the finger goes
      if (Math.abs(dy) < Math.abs(dx) * 1.2) { this.g = null; return; }   // sideways: the panel's own
      g.way = 'v'; this.grab(e);
    } else if (g.caught && !g.moved) {
      if (Math.hypot(dx, dy) < LOCK) { e.stopPropagation(); return; }
      g.moved = true;
    }
    e.stopPropagation(); if (e.cancelable) e.preventDefault();
    g.trail.push([e.timeStamp, e.clientY]); while (g.trail.length > 2 && e.timeStamp - g.trail[0][0] > 100) g.trail.shift();   // the last tenth of a second, for a flick
    this.follow(g.start - dy);
  }
  up(e) {
    const g = this.g; if (!g || e.pointerId !== g.id || this.sending) return;
    this.g = null;
    const seg = this.seg; if (!seg || g.way !== 'v') return;
    e.stopPropagation(); this.quiet = performance.now();
    if (g.caught && !g.moved) { this.slide(this.to); return; }   // a tap on it as it slides: it goes on as it was (a tap on what is still sliding is no tap)
    const [a, b] = [g.trail[0], g.trail.at(-1)], span = a && b ? b[0] - a[0] : 0;
    const v = (e.type === 'pointerup' && span > 20 && e.timeStamp - b[0] < 90 ? -(b[1] - a[1]) / g.k / span : 0) * (seg.dir || 1);   // design px a ms, the way it goes: how it was moving as it left
    const len = this.len(seg), on = seg.dir !== 0 && (seg.s >= Math.min(GO, len / 4) || v > FLICK) && !(v < -FLICK);   // far enough in, or flicked on; flicked back, back
    this.slide(on ? 1 : 0);
  }
  /** The swipe is the panel's: the control it began on lets go of it (a cancel, so it takes no tap), the panel holds it. */
  grab(e) {
    const t = this.g.target;
    if (t && t !== this.plate) { this.sending = true; try { t.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType, bubbles: true })); } finally { this.sending = false; } }
    try { this.plate.setPointerCapture(e.pointerId); } catch { /* still followed while it stays over the panel */ }
    this.begin();
  }
  /** A slide begins: the photo's room held to the fraction, the panel hidden behind a still copy of itself, the photo's work told to wait. */
  begin() {
    const room = this.plate.parentElement?.querySelector('[data-room]');
    if (room) this.stage.style.setProperty('--hold-room', `${parseFloat(getComputedStyle(room).height)}px`);
    this._foot = this.foot();
    this.stage.classList.add('rolling'); dial(true);   // (the panel's own easing stops where it was going, so what is copied is where it rests)
    this.seg = { a: this.live, b: -1, dir: 0, s: 0, base: 0 }; this.from = this.live; this.near = this.live;
    this.copy(this.live); this.draw();
    this.c0 = counts(); Object.assign(this.feel, { steps: 0, back: 0, refit: 0, rebuilt: 0, outcome: 'returned' });
    moved(() => this.busy(), info().making, 'swipe', this.feel);
  }
  /** The finger has gone `t` design px up from where the swipe began (down: less than 0): the sections it passes come in. */
  follow(t) {
    const seg = this.seg, n = this.n();
    for (let i = 0; i < 4; i++) {
      const rel = t - seg.base;
      if (rel && Math.sign(rel) !== seg.dir) { if (seg.dir) this.feel.back++; seg.dir = Math.sign(rel); seg.b = mod(seg.a + seg.dir, n); this.want(seg.b); }   // a way chosen, or turned back past where this section began
      seg.s = Math.abs(rel);
      const len = this.len(seg);
      if (seg.s < len || !this.faces.has(seg.b)) break;
      seg.base += seg.dir * len; seg.a = seg.b; seg.b = mod(seg.a + seg.dir, n); this.want(seg.b); this.feel.steps++;   // a whole section passed under the finger
    }
    this.draw();
  }
  /** How far the slide is from this section to the next, 0 to 1. */
  part(seg) { return Math.min(1, seg.s / (this.len(seg) || 1)); }
  /** The slide's length: the coming section's height going up, the going one's going down. */
  len(seg) { const ha = this.faces.get(seg.a)?.h || 210, hb = this.faces.get(seg.b)?.h || ha; return seg.dir < 0 ? ha : hb; }
  /** Asks the board for section `i`, a frame on (a key's or an option's: at once), unless its copy is in hand. */
  want(i, now = false) {
    if (this.faces.has(i)) return;
    this.wanted = i; cancelAnimationFrame(this.ask);
    const make = () => {
      this.ask = 0; const w = this.wanted; if (this.faces.has(w) || !this.seg) return;
      this.live = w; this.props.onpick?.(w);
      queueMicrotask(() => { if (this.seg && this.live === w) { this.copy(w); this.draw(); } });   // after the board's own drawing (queued by its setState), which draws the panel whole
    };
    if (now) make(); else this.ask = requestAnimationFrame(make);
  }
  /** A still copy of the panel as it shows section `i`, cut to that section's height, in the window. */
  copy(i) {
    const p = this.plate, top = parseFloat(getComputedStyle(p).top), c = p.cloneNode(true), foot = this._foot || this.foot();
    c.setAttribute('aria-hidden', 'true'); c.inert = true; c.classList.remove('barrel');
    for (const el of c.querySelectorAll('[id]')) el.removeAttribute('id');
    const h = Math.max(60, Math.min(340, foot - top));
    Object.assign(c.style, { top: `${foot - h}px`, height: `${h}px`, overflow: 'hidden', boxShadow: 'none', display: 'none' });
    this.window().appendChild(c); this.faces.get(i)?.el.remove(); this.faces.set(i, { el: c, h });
  }
  /** The foot of the board's screen, in design px (the top of the phone's own bar, where the panel is cut off). */
  foot() { const root = this.plate.parentElement; return parseFloat(getComputedStyle(root).height) || root.clientHeight || 915; }
  window() {
    if (this.win?.isConnected) return this.win;
    const w = document.createElement('div'), shade = document.createElement('div'), framed = this.stage.parentElement?.id === 'frame', foot = this._foot || this.foot();
    w.className = 'barrel-copies'; w.setAttribute('aria-hidden', 'true'); w.style.height = `${foot}px`;
    shade.className = 'barrel-shade'; shade.setAttribute('aria-hidden', 'true'); shade.style.boxShadow = SHADOW;
    for (const el of framed ? [] : [w, shade]) Object.assign(el.style, { transformOrigin: '0 0', transform: this.stage.style.transform });   // a screen of the design on its own: the stage is what is fitted to the screen
    this.stage.after(shade, w); this.win = w; this.shade = shade; this.clip = ''; return w;
  }
  /** The sections in view where they stand, each on the screen's foot at its own height; the window's top between theirs. */
  draw() {
    const seg = this.seg; if (!seg) return;
    if (!this.plate.isConnected) { this.end(); return; }   // its board went (another tool): nothing to land on
    const A = this.faces.get(seg.a), B = seg.dir ? this.faces.get(seg.b) : null; if (!A) return;
    const foot = this._foot || this.foot(), s = Math.min(seg.s, this.len(seg)), f = this.part(seg), up = seg.dir >= 0;
    for (const [i, face] of this.faces) if (i !== seg.a && (!B || i !== seg.b)) face.el.style.display = 'none';
    Object.assign(A.el.style, { display: 'block', zIndex: up ? '1' : '2', transform: `translateY(${(up ? -s : s).toFixed(2)}px)` });   // the lower of the two lies over the other (its shadow on it)
    if (B) Object.assign(B.el.style, { display: 'block', zIndex: up ? '2' : '1', transform: `translateY(${(up ? B.h - s : s - A.h).toFixed(2)}px)` });
    const top = foot - (A.h + ((B ? B.h : A.h) - A.h) * f), clip = `inset(${top.toFixed(2)}px 0 0 0)`;
    if (clip !== this.clip) { this.clip = clip; this.win.style.clipPath = clip; this.shade.style.transform = `${this.win.style.transform || ''} translateY(${top.toFixed(2)}px)`.trim(); }   // (the same height both ways, as most sections are: set once)
    const near = f >= 0.5 && B ? seg.b : seg.a;
    if (near !== this.near) { this.near = near; tick('detent'); }
  }
  /** Straight to section `i` (a key, or an option chosen from the list), the short way round, unless `d` says the way. */
  go(i, d = 0) {
    const n = this.n(); if (this.g || n < 2) return;
    if (this.seg) { this.next = [i, d]; return; }   // once this slide has landed
    const k = mod(i - this.live, n); if (!k) return;
    this.begin();
    const seg = this.seg; seg.dir = d || (k > n / 2 ? -1 : 1); seg.b = i; this.want(i, true);
    this.slide(1);
  }
  /** Slides to its end (1: on to the coming section) or back (0), in a time of its own however the frames come. */
  slide(to) {
    const seg = this.seg; if (!seg) return;
    cancelAnimationFrame(this.anim); this.to = to;
    const p0 = this.part(seg), t0 = performance.now(), ms = Math.max(90, MS * Math.abs(to - p0));
    const step = (now) => {
      if (this.seg !== seg) return;
      const t = Math.min(1, (now - t0) / ms), p = p0 + (to - p0) * ease(t);
      seg.s = p * this.len(seg); this.draw();
      if (this.seg !== seg) return;
      if (t < 1 || (to === 1 && seg.dir && !this.faces.has(seg.b))) { this.anim = requestAnimationFrame(step); return; }   // (it waits, at the end, for the coming section's copy)
      this.anim = 0; this.land(to === 1 && seg.dir ? seg.b : seg.a);
    };
    this.anim = requestAnimationFrame(step);
  }
  /** It has landed on section `i`: the panel, showing it, comes back in place of the copies; the photo takes its room. */
  land(i) {
    cancelAnimationFrame(this.anim); cancelAnimationFrame(this.ask); this.anim = this.ask = 0;
    if (i === this.seg.b && this.seg.dir) this.feel.steps++;
    this.feel.outcome = i === this.from ? 'returned' : 'landed';
    if (this.live === i) { this.end(); return; }
    this.live = i; this.props.onpick?.(i);
    queueMicrotask(() => this.end());   // once the board has drawn the panel on it
  }
  end() {
    if (!this.seg || this.g) return;   // (a finger took it again meanwhile: it goes on)
    this.win?.remove(); this.shade?.remove(); this.win = this.shade = null; this.faces.clear(); this.seg = null;
    // the photo's room takes the section's own at once, and the photo glides there once (zoom.js `follow`: as for another tool),
    // not as the room eases (the photo stood still a third of a second, then glided: 2026-11-18)
    const st = this.stage; st.classList.add('landing'); st.style.removeProperty('--hold-room'); st.classList.remove('rolling');
    requestAnimationFrame(() => requestAnimationFrame(() => st.classList.remove('landing')));
    dial(false);
    const c = counts(); Object.assign(this.feel, { refit: c.fits - this.c0.fits, rebuilt: c.hides - this.c0.hides });
    this.tell();
    if (this.heir) { this.plate._barrel = this.heir; this.heir = null; }
    const nx = this.next; this.next = null; if (nx) this.go(...nx);
  }
}
