// @ts-nocheck
// The dial: a knurled wheel under a window that shows the value. Wired to a photo (app/session.js): `value` (the
// dial's −5..5 position) follows the photo when it changes from elsewhere, `text` is the value as the plate shows
// it, and `onturn` hears every turn. A drag turns it one for one with the finger; let go while moving and it runs
// on, slowing, until it stops or is touched; two quick taps ask for the value's start (`onreset`). `auto`, when
// given, is the name of a small key in the window's corner (`onauto`). `left`: the value runs from the window's
// left end, not out from its middle (a strength, 0 upwards). `span`: the position at the window's end (5 unless given: a
// choice of a few options spans less, so a short turn steps it). `slim`: no wheel, the window itself is dragged and the number stays under the finger. `onhold` hears true when a
// finger takes the dial and false once it has let go and the dial is still. `start`: the position where the value
// starts (0, the middle, unless given; a `left` dial has none unless given): turning past it, or into either end of the
// range, gives a small tick under the finger (app/haptic.js). How the page kept up while it was turned is noted with
// the timings (app/moved.js: frames drawn, the longest gap, and how far the photo was zoomed in).
import { DCLogic } from '../dc.js';
import { tick } from '../app/haptic.js';
import { moved } from '../app/moved.js';
import { info } from '../app/zoom.js';

export default class Component extends DCLogic {
  constructor(props) { super(props); this.state = { angle: 12.6, active: false }; this.drag = null; this.spin = 0; this.tapped = -1e9; }
  renderVals() {
    const PERIOD = 360 / 72, FRAMES = 12, FRAME_H = 150, R = 240;   // R = the dial's radius in the design's pixels, so the knurl tracks the finger
    const label = this.props.label ?? 'Exposure', unit = this.props.unit ?? 'EV';
    // a new adjustment, or a change made elsewhere (a preset, Undo): the dial goes to it; never under a finger or while it runs on
    if (typeof this.props.value === 'number' && (label !== this.seen || (!this.drag && !this.spin && Math.abs(this.props.value * 36 - this.state.angle) > 1))) {
      this.seen = label; this.state.angle = Math.max(-180, Math.min(180, this.props.value * 36));
    }
    const { angle } = this.state;
    const ev = unit === 'EV';
    const frac = ((((-angle) / PERIOD) % 1) + 1) % 1;
    const v = Math.max(-5, Math.min(5, angle / 36));
    const show = (t) => ev ? t : Math.round(t * 20);
    const sign = (x) => (x > 0.004 ? '+' : x < -0.004 ? '−' : '');
    const valueText = this.props.text ?? (ev ? sign(v) + Math.abs(v).toFixed(2) : sign(show(v)) + Math.abs(show(v)));
    // the window: a red fill runs from the middle to the value, the number riding at its end in a ringed box; the Auto key takes the right end
    const auto = this.props.auto || '', slim = !!this.props.slim, left = !!this.props.left, L = 22, Rt = auto ? 372 - 74 : 372 - 22, mid = (L + Rt) / 2, half = (Rt - L) / 2, f = Math.max(-1, Math.min(1, v / (this.props.span || 5))), end = mid + f * half;
    const at0 = typeof this.props.start === 'number' ? this.props.start * 36 : left ? null : 0, edge = Math.min(5, this.props.span || 5) * 36 - 0.01;
    const felt = (was, now) => {   // past the start, or into an end: a tick
      if (at0 !== null && was !== at0 && (now === at0 || (was - at0) * (now - at0) < 0)) tick('detent');
      else if (Math.abs(now) >= edge && Math.abs(was) < edge) tick('end');
    };
    const setAngle = (a) => { const c = Math.max(-180, Math.min(180, a)); felt(this.state.angle, c); this.setState({ angle: c }); this.props.onturn?.(c / 36); return c; };
    const stop = () => { cancelAnimationFrame(this.spin); this.spin = 0; };
    const run = (v0) => {   // degrees a millisecond, dying away
      let vel = v0, last = performance.now();
      const step = (now) => {
        const dt = Math.min(40, now - last); last = now;
        const a = setAngle(this.state.angle + vel * dt); vel *= Math.exp(-dt / 320);
        this.spin = Math.abs(vel) < 0.012 || Math.abs(a) >= 180 ? 0 : requestAnimationFrame(step);
        if (!this.spin) { this.setState({}); this.props.onhold?.(false); }
      };
      this.spin = requestAnimationFrame(step);
    };
    return {
      label, unit, labelUp: label.toUpperCase() + (unit ? ` · ${unit}` : ''),
      offset: -Math.floor(frac * FRAMES) * FRAME_H, valueText, valueNow: v.toFixed(2),
      trackL: L, trackW: Rt - L, midX: left ? L : mid, fillL: left ? L : (mid + Math.min(0, f) * half).toFixed(1), fillW: (left ? end - L : Math.abs(f) * half).toFixed(1),
      wheel: !slim, tall: slim ? 44 : 144, hitT: slim ? 2 : 46, hitW: slim ? (auto ? 320 : 412) : 412, hitH: slim ? 40 : 96,
      numX: Math.max(L + 12, Math.min(Rt - 6, end)).toFixed(1),
      hasAuto: !!auto, auto, pressAuto: () => this.props.onauto?.(),
      down: (e) => { stop(); this.props.onhold?.(true); moved(() => !!this.drag || !!this.spin, false, 'turn', { pct: info().pct }); const k = e.currentTarget.getBoundingClientRect().width / 412 || 1; this.drag = { x: e.clientX, a: this.state.angle, t: e.timeStamp, lx: e.clientX, lt: e.timeStamp, v: 0, far: 0, k }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be held still turns it */ } },
      move: (e) => {
        const d = this.drag; if (!d) return;
        const deg = (px) => (slim ? (px / d.k / (Rt - L)) * 360 : (px / d.k / R) * (180 / Math.PI)), dt = e.timeStamp - d.lt;   // slim: the number rides under the finger
        d.far = Math.max(d.far, Math.abs(e.clientX - d.x));
        if (dt > 0) { d.v = d.v * 0.55 + (deg(e.clientX - d.lx) / dt) * 0.45; d.lx = e.clientX; d.lt = e.timeStamp; }
        setAngle(d.a + deg(e.clientX - d.x));
      },
      up: (e) => {
        const d = this.drag; this.drag = null; if (!d) return;
        if (d.far < 5 && e.timeStamp - d.t < 320) {   // a tap: the second of two quick ones puts the value back where it starts
          if (e.timeStamp - this.tapped < 360) { this.tapped = -1e9; this.props.onreset?.(); } else this.tapped = e.timeStamp;
        } else if (!slim && e.type === 'pointerup' && e.timeStamp - d.lt < 80 && Math.abs(d.v) > 0.05) return run(d.v);
        this.props.onhold?.(false);
      },
      key: (e) => { if (e.key === 'ArrowRight') setAngle(this.state.angle + 3.6); if (e.key === 'ArrowLeft') setAngle(this.state.angle - 3.6); if (e.key === 'Home') this.props.onreset?.(); },
    };
  }
}
