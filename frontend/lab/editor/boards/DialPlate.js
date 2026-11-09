// @ts-nocheck
// The DialPlate board, as designed (docs/design/editor/boards/DialPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) { super(props); this.state = { angle: 12.6, active: false }; this.drag = null; }
  renderVals() {
    const PERIOD = 360 / 72, FRAMES = 12, FRAME_H = 150, R = 240;   // R = the dial's radius in css px, so the knurl tracks the finger
    const { angle, active } = this.state;
    const label = this.props.label ?? 'Exposure', unit = this.props.unit ?? 'EV';
    const ev = unit === 'EV';
    const frac = ((((-angle) / PERIOD) % 1) + 1) % 1;
    const v = Math.max(-5, Math.min(5, angle / 36));
    const show = (t) => ev ? t : Math.round(t * 20);
    const sign = (x) => (x > 0.004 ? '+' : x < -0.004 ? '−' : '');
    const valueText = ev ? sign(v) + Math.abs(v).toFixed(2) : sign(show(v)) + Math.abs(show(v));
    // the window: a red fill always runs from 0 to the value, the number riding at its end in a ringed box
    const half = (372 - 44) / 2, f = v / 5, end = 186 + f * half;
    const setAngle = (a) => this.setState({ angle: Math.max(-180, Math.min(180, a)) });
    return {
      label, unit, labelUp: label.toUpperCase(),
      offset: -Math.floor(frac * FRAMES) * FRAME_H, valueText, valueNow: v.toFixed(2),
      trackO: 1, fillL: (186 + Math.min(0, f) * half).toFixed(1), fillW: (Math.abs(f) * half).toFixed(1),
      numX: Math.max(34, Math.min(338, end)).toFixed(1), numY: 30, numPad: 8, numSize: 12, numBg: '#0b0c0d',
      numRing: '0 0 0 1.5px #e8202a, 0 2px 6px rgba(0,0,0,0.8)',
      down: (e) => { this.drag = { x: e.clientX, a: this.state.angle }; this.setState({ active: true }); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      move: (e) => { if (!this.drag) return; setAngle(this.drag.a + ((e.clientX - this.drag.x) / R) * (180 / Math.PI)); },
      up: () => { this.drag = null; },
      key: (e) => { if (e.key === 'ArrowRight') setAngle(this.state.angle + 3.6); if (e.key === 'ArrowLeft') setAngle(this.state.angle - 3.6); },
    };
  }
}
