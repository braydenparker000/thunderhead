// @ts-nocheck
// A drum: a small cylinder standing in the panel that turns up and down, a name on each face. It chooses between a
// few pages (the Edit board's sections) in the room one of them takes. A finger turns it and it settles on a
// face; a flick carries it further; a tap above or below the middle steps one face.
// Props: `faces` [{ label, count }], `at` (the face showing), `onpick(i)`.
import { DCLogic } from '../dc.js';

const FACE = 26;   // a face's height in the design's pixels
export default class Component extends DCLogic {
  constructor(props) { super(props); this.state = { angle: 0, ease: false }; this.drag = null; this.seen = -1; }
  renderVals() {
    const faces = this.props.faces || [], n = faces.length || 1, reps = Math.ceil(8 / n), slots = n * reps, step = 360 / slots;
    const r = FACE / 2 / Math.tan((step * Math.PI) / 360), at = Math.max(0, Math.min(n - 1, this.props.at ?? 0));
    const face = (a) => ((Math.round(a / step) % n) + n) % n;
    // told from outside to show another face (or at first): turn the shortest way to it; never while a finger holds it
    if (!this.drag && face(this.state.angle) !== at) {
      const here = Math.round(this.state.angle / step), d = ((at - face(this.state.angle) + n + Math.floor(n / 2)) % n) - Math.floor(n / 2);
      this.state.angle = (here + d) * step; this.state.ease = this.seen >= 0;
    }
    this.seen = at;
    const settle = (a) => { const to = Math.round(a / step) * step; this.setState({ angle: to, ease: true }); if (face(to) !== at) this.props.onpick?.(face(to)); };
    return {
      r: r.toFixed(2), fh: FACE, half: FACE / 2, angle: this.state.angle.toFixed(2), ease: this.state.ease ? 'transform 280ms cubic-bezier(0.2, 0.85, 0.25, 1.1)' : 'none',
      faces: Array.from({ length: slots }, (_, i) => { const f = faces[i % n] || {}, on = i % n === at; return { label: String(f.label || '').toUpperCase(), count: f.count ? String(f.count) : '', a: (-i * step).toFixed(2), on: String(on), ink: on ? '#f2efe8' : '#8b8f95', countInk: on ? '#e8202a' : '#5d6166' }; }),
      now: faces[at]?.label || '',
      down: (e) => { const b = e.currentTarget.getBoundingClientRect(); this.drag = { y: e.clientY, y0: e.clientY, a: this.state.angle, t: e.timeStamp, lt: e.timeStamp, ly: e.clientY, v: 0, far: 0, k: b.height / 52 || 1, mid: b.top + b.height / 2 }; this.setState({ ease: false }); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      move: (e) => {
        const d = this.drag; if (!d) return;
        const turn = (px) => (-(px / d.k) / r) * (180 / Math.PI), dt = e.timeStamp - d.lt;
        d.far = Math.max(d.far, Math.abs(e.clientY - d.y0));
        if (dt > 0) { d.v = d.v * 0.5 + (turn(e.clientY - d.ly) / dt) * 0.5; d.ly = e.clientY; d.lt = e.timeStamp; }
        this.setState({ angle: d.a + turn(e.clientY - d.y), ease: false });
      },
      up: (e) => {
        const d = this.drag; this.drag = null; if (!d) return;
        if (d.far < 5) return settle(d.a + (e.clientY < d.mid ? -step : step));   // a tap: one face up or down
        settle(this.state.angle + (e.type === 'pointerup' && e.timeStamp - d.lt < 90 ? Math.max(-2.5 * step, Math.min(2.5 * step, d.v * 160)) : 0));   // a flick carries it on, a few faces at most
      },
      key: (e) => { if (e.key === 'ArrowDown') settle(this.state.angle + step); if (e.key === 'ArrowUp') settle(this.state.angle - step); },
    };
  }
}
