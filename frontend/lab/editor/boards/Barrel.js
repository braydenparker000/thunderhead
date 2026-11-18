// @ts-nocheck
// A board's sections, turned by swiping its panel (the owner, 2026-11-18): swiped up or down, the panel rolls like a
// barrel about a tenth of a turn a section, up bringing the next one up from below and down the one before; it is
// round, so past the last section comes the first, as on the drum it replaced. A swipe past a third of a section goes
// on to it, a flick carries on a section or two, and each section clicking past ticks under the finger
// (app/haptic.js). A swipe sideways stays the panel's own (its dial, its row, its tiles), and so does any drag on what a
// finger moves every way (the curve, a grading wheel: marked `data-drag`). While it rolls, the section going away is a
// still copy of the panel laid over it and the panel itself is already the one coming: both turn on the one barrel, as
// in the design. The drum stood at the row's left end; the row starts there now. For a keyboard and a screen reader
// the sections are still a list (role listbox: the arrow keys roll it, an option chosen rolls to it). Props: `faces` [{ label, count }], `at` (the
// one showing), `onpick(i)`. Which section shows is told to the tool dial (boards/ToolDial.js) as `editor:section`.
import { DCLogic } from '../dc.js';
import { tick } from '../app/haptic.js';

const STEP = 34, PX = 110, LOCK = 8;   // the barrel's turn a section (degrees); a swipe a section, and how far a finger goes before its way is known (design px)
const mod = (i, n) => ((i % n) + n) % n;

export default class Component extends DCLogic {
  constructor(props) { super(props); this.g = null; this.P = 0; this.goal = null; this.raf = 0; this.face = { live: 0, copy: -1 }; this.copy = null; this.quiet = 0; this.ticked = null; }
  renderVals() {
    const faces = this.props.faces || [], at = Math.max(0, Math.min(faces.length - 1, this.props.at ?? 0));
    if (!this.g && !this.raf && !this.copy) { this.face.live = at; this.P = at; }
    queueMicrotask(() => this.attach());
    const now = faces[at]?.label || '';
    if (now !== this.told) { this.told = now; document.dispatchEvent(new CustomEvent('editor:section', { detail: { label: now, faces: faces.map((f) => f.label) } })); }
    return {
      now, faces: faces.map((f, i) => ({ label: String(f.label || '').toUpperCase(), count: f.count ? String(f.count) : '', on: String(i === at), pick: () => this.go(i) })),
      key: (e) => { const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!d) return; e.preventDefault(); this.roll(d); },
    };
  }
  n() { return (this.props.faces || []).length; }
  /** Takes the panel it stands in (once; again if the board drew a new one): its swipes, seen before its own controls. */
  attach() {
    const plate = this._host?.el?.closest?.('.plate');
    if (!plate || plate === this.plate) return;
    this.plate = plate; this.stage = plate.closest('#stage') || plate.parentElement;
    plate.classList.add('barrel');
    const o = { capture: true };
    plate.addEventListener('pointerdown', (e) => this.down(e), o);
    plate.addEventListener('pointermove', (e) => this.move(e), o);
    plate.addEventListener('pointerup', (e) => this.up(e), o);
    plate.addEventListener('pointercancel', (e) => this.up(e), o);
    plate.addEventListener('click', (e) => { if (performance.now() - this.quiet < 400) { e.stopPropagation(); e.preventDefault(); } }, o);   // a swipe's end is no tap
  }
  down(e) {
    if (this.g || (e.button ?? 0) > 0 || this.n() < 2 || e.target.closest?.('[data-drag]')) return;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }   // caught while it settles: it goes on from where it is
    this.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, k: this.stage.getBoundingClientRect().width / 412 || 1, way: '', from: this.P, trail: [], target: e.target };
  }
  move(e) {
    const g = this.g; if (!g || e.pointerId !== g.id || this.sending) return;
    const dx = (e.clientX - g.x0) / g.k, dy = (e.clientY - g.y0) / g.k;
    if (!g.way) {
      if (Math.hypot(dx, dy) < LOCK) { e.stopPropagation(); return; }   // held back from the panel's controls until it is known which way the finger goes
      if (Math.abs(dy) < Math.abs(dx) * 1.2) { this.g = null; if (this.P !== Math.round(this.P)) this.settle(Math.round(this.P)); return; }   // sideways: the panel's own
      g.way = 'v'; this.grab(e); g.y0 = e.clientY; g.from = this.P;
    }
    e.stopPropagation(); if (e.cancelable) e.preventDefault();
    g.trail.push([e.timeStamp, e.clientY]); while (g.trail.length > 2 && e.timeStamp - g.trail[0][0] > 100) g.trail.shift();   // the last tenth of a second, for a flick's speed
    this.place(g.from - (e.clientY - g.y0) / g.k / PX);
  }
  up(e) {
    const g = this.g; if (!g || e.pointerId !== g.id || this.sending) return;
    this.g = null;
    if (g.way !== 'v') { if (this.P !== Math.round(this.P)) this.settle(Math.round(this.P)); return; }
    e.stopPropagation(); this.quiet = performance.now();
    const [a, b] = [g.trail[0], g.trail.at(-1)], span = b && a ? b[0] - a[0] : 0;
    const fresh = e.type === 'pointerup' && span > 20 && e.timeStamp - b[0] < 90 ? (-(b[1] - a[1]) / g.k / PX) * (1000 / span) : 0;   // sections a second, as it left: a flick carries on a section or two
    const from = Math.round(g.from), d = this.P - from + Math.max(-2, Math.min(2, fresh * 0.12));   // past a third of a section, on to it (the curve leaves a short row to swipe on)
    this.settle(from + (d > 0 ? Math.floor(d + 0.7) : Math.ceil(d - 0.7)));
  }
  /** The swipe is the barrel's: the control it began on lets go of it (a cancel, so it takes no tap), the panel holds it. */
  grab(e) {
    const t = this.g.target;
    if (t && t !== this.plate) { this.sending = true; try { t.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType, bubbles: true })); } finally { this.sending = false; } }
    try { this.plate.setPointerCapture(e.pointerId); } catch { /* still followed while it stays over the panel */ }
    this.stage.classList.add('rolling'); this.ticked = Math.round(this.P);
  }
  /** One section on or back (the arrow keys), from where a roll already under way is going. @param {number} d */
  roll(d) {
    if (this.g || this.n() < 2) return;
    this.stage.classList.add('rolling');
    this.settle((this.raf && this.goal !== null ? this.goal : Math.round(this.P)) + d, true);
  }
  /** Straight to section `i` (an option chosen from the list, as a screen reader does), the short way round. */
  go(i) {
    const n = this.n(); if (this.g || n < 2) return;
    const from = this.raf && this.goal !== null ? this.goal : Math.round(this.P), d = mod(i - from, n);
    if (!d) return;
    this.stage.classList.add('rolling'); this.settle(from + (d > n / 2 ? d - n : d), true);
  }
  /** The barrel stands at `P` (sections round it, fractional while it turns): the one or two sections it shows are on
   * the panel and its copy, turned to where they stand. Settling, it shows none past the one it settles on (`lo`..`up`):
   * a spring's overshoot is not a section passed. */
  place(P, lo = -Infinity, up = Infinity) {
    const n = this.n(), r = Math.round(P);
    if (r !== this.ticked) { this.ticked = r; tick('detent'); }
    this.P = P;
    const m = Math.floor(P);
    this.ensure([...new Set([m, m + 1].filter((q) => q >= lo && q <= up && Math.abs(P - q) < 1).map((q) => mod(q, n)))]);
    this.draw();
  }
  /** The sections wanted on show are the panel's and the copy's: the panel copied before it is shown another. */
  ensure(need) {
    if (this.pending) return;   // the board has not yet drawn the last one asked of it
    const { live, copy } = this.face, missing = need.filter((i) => i !== live && i !== copy);
    if (!missing.length) return;
    if (need.includes(live)) { this.snap(); this.face.copy = live; }
    else if (!need.includes(copy)) this.drop();
    this.pick(missing[0]);
  }
  pick(i) {
    this.face.live = i; this.pending = true;
    this.props.onpick?.(i);
    queueMicrotask(() => { this.pending = false; if (this.plate) this.draw(); });   // after the board's own draw, queued by its setState
  }
  /** A still copy of the panel as it shows now, laid where it is, outside the board (which redraws its own). */
  snap() {
    this.drop();
    const c = this.plate.cloneNode(true);
    c.setAttribute('aria-hidden', 'true'); c.inert = true;
    for (const el of c.querySelectorAll('[id]')) el.removeAttribute('id');
    Object.assign(c.style, { top: `${this.plate.offsetTop}px`, transition: 'none', animation: 'none', pointerEvents: 'none' });
    this.layer().appendChild(c); this.copy = c; this.copyH = this.vis(this.plate);
  }
  drop() { this.copy?.remove(); this.copy = null; this.face.copy = -1; }
  layer() {
    if (this.lay?.isConnected) return this.lay;
    const l = document.createElement('div'), framed = this.stage.parentElement?.id === 'frame';
    l.setAttribute('aria-hidden', 'true');
    l.style.cssText = `position:absolute;left:0;top:0;width:412px;height:${this.stage.clientHeight}px;pointer-events:none;overflow:clip;z-index:1`;
    if (!framed) Object.assign(l.style, { transformOrigin: '0 0', transform: this.stage.style.transform });   // a screen of the design on its own: the stage is what is fitted to the screen
    this.stage.after(l); this.lay = l; return l;
  }
  vis(el) { return Math.max(60, Math.min(340, this.stage.clientHeight - el.offsetTop)); }
  /** Where section `i` stands round the barrel now: the turn nearest the front. */
  at(i) { const n = this.n(); return i + n * Math.round((this.P - i) / n); }
  draw() {
    const st = this.stage.style;
    const turn = (i, h) => { const a = (this.P - this.at(i)) * STEP, rb = h / 2 / Math.tan(((STEP / 2) * Math.PI) / 180); return [`perspective(1100px) translateZ(${(-rb).toFixed(1)}px) rotateX(${a.toFixed(2)}deg) translateZ(${rb.toFixed(1)}px)`, Math.min(0.6, (Math.abs(a) / STEP) * 0.55).toFixed(3)]; };
    const h = this.vis(this.plate), [t, d] = turn(this.face.live, h);
    st.setProperty('--roll', t); st.setProperty('--roll-y', `${(h / 2).toFixed(1)}px`); st.setProperty('--dim', d);
    if (this.copy) { const [t2, d2] = turn(this.face.copy, this.copyH); Object.assign(this.copy.style, { transform: t2, transformOrigin: `50% ${(this.copyH / 2).toFixed(1)}px` }); this.copy.style.setProperty('--dim', d2); }
  }
  /** Springs to `to` (a key's step quicker) and comes to rest on it: the panel shows it, the copy goes, the turn is cleared. */
  settle(to, quick = false) {
    cancelAnimationFrame(this.raf); this.goal = to;
    if (this.ticked === null) this.ticked = Math.round(this.P);
    let pos = this.P, v = 0, last = performance.now();
    const lo = Math.min(Math.floor(pos), to), up = Math.max(Math.ceil(pos), to), [k, c] = quick ? [700, 46] : [300, 22];
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      for (let i = 0; i < 4; i++) { v += (-k * (pos - to) - c * v) * (dt / 4); pos += v * (dt / 4); }
      if (Math.abs(pos - to) < 0.003 && Math.abs(v) < 0.02) { this.raf = 0; this.place(to, lo, up); this.rest(to); return; }
      this.place(pos, lo, up); this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  rest(to) {
    const i = mod(to, this.n());
    const done = () => {
      if (this.g || this.raf) return;   // a finger took it again meanwhile
      this.P = i; this.goal = null; this.ticked = null;
      this.drop(); this.lay?.remove(); this.lay = null;
      const st = this.stage.style; st.removeProperty('--roll'); st.removeProperty('--roll-y'); st.removeProperty('--dim');
      this.stage.classList.remove('rolling');
    };
    if (this.face.live !== i) { this.pick(i); queueMicrotask(() => queueMicrotask(done)); } else done();
  }
}
