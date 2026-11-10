// @ts-nocheck
// One grading wheel, in the panel: the tint of the range the row has chosen (shadows, midtones, highlights or the
// whole), with its brightness on a slider beside it and the other ranges small underneath, a tap away. The puck
// moves with the finger from where it is (it does not jump to the touch), so small moves are small; two taps put
// it back in the middle. With a photo open (app/session.js) it is the photo's grading; without one, a sample.
// Props: `zone`, `onzone(name)`.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';

const ZONES = ['Shadows', 'Midtones', 'Highlights', 'Global'], D = 176, MINI = 38;
export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { pucks: { Shadows: [215, 14, 0], Midtones: [40, 6, 0], Highlights: [48, 18, 0], Global: [0, 0, 0] } };
    this.drag = null; this.lum = null; this.tapped = -1e9;
  }
  renderVals() {
    const zone = ZONES.includes(this.props.zone) ? this.props.zone : 'Shadows', real = photo.current();
    const of = (z) => (real ? [photo.value(`Grade ${z} Hue`), photo.value(`Grade ${z} Sat`), photo.value(`Grade ${z} Lum`)] : this.state.pucks[z]);
    const [hue, sat, lum] = of(zone), rad = (hue * Math.PI) / 180;
    const at = (h, s, d) => { const a = (h * Math.PI) / 180, r = (s / 100) * (d / 2); return [d / 2 + r * Math.cos(a), d / 2 - r * Math.sin(a)]; };
    const setTint = (x, y) => {   // a place on the wheel (from its middle, y up) as hue and saturation
      const h = Math.round((((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360), s = Math.round(Math.min(100, (Math.hypot(x, y) / (D / 2)) * 100));
      if (real) photo.setValues({ [`Grade ${zone} Hue`]: s ? h : 0, [`Grade ${zone} Sat`]: s }, `Grade ${zone}`, `Grading · ${zone}`, `${h}° ${s}`);
      else this.setState({ pucks: { ...this.state.pucks, [zone]: [h, s, lum] } });
    };
    const setLum = (v) => { const l = Math.round(Math.max(-100, Math.min(100, v))); if (real) photo.turn(`Grade ${zone} Lum`, l / 20); else this.setState({ pucks: { ...this.state.pucks, [zone]: [hue, sat, l] } }); };
    const twice = (e) => { const yes = e.timeStamp - this.tapped < 360; this.tapped = yes ? -1e9 : e.timeStamp; return yes; };
    const [px, py] = at(hue, sat, D), f = lum / 100;
    return {
      zone, zoneUp: zone.toUpperCase(), hue, sat, tint: sat ? `${hue}° · ${sat}` : 'NO TINT', px: px.toFixed(1), py: py.toFixed(1), puck: `hsl(${hue} ${Math.round(sat * 0.8)}% 50%)`,
      lumText: (lum > 0 ? '+' : lum < 0 ? '−' : '') + Math.abs(lum), lumNow: lum, fillL: (80 + Math.min(0, f) * 72).toFixed(1), fillW: (Math.abs(f) * 72).toFixed(1), knobX: (80 + f * 72).toFixed(1),
      down: (e) => { const k = e.currentTarget.getBoundingClientRect().width / D || 1; this.drag = { x: e.clientX, y: e.clientY, k, px: px - D / 2, py: D / 2 - py, far: 0, t: e.timeStamp }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      move: (e) => { const d = this.drag; if (!d) return; const dx = (e.clientX - d.x) / d.k, dy = (e.clientY - d.y) / d.k; d.far = Math.max(d.far, Math.hypot(dx, dy)); if (d.far > 2) setTint(d.px + dx, d.py - dy); },
      up: (e) => { const d = this.drag; this.drag = null; if (d && d.far < 4 && e.timeStamp - d.t < 320 && twice(e)) setTint(0, 0); },
      lDown: (e) => { const k = e.currentTarget.getBoundingClientRect().width / 160 || 1; this.lum = { x: e.clientX, k, v: lum, far: 0, t: e.timeStamp }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      lMove: (e) => { const d = this.lum; if (!d) return; const dx = (e.clientX - d.x) / d.k; d.far = Math.max(d.far, Math.abs(dx)); if (d.far > 2) setLum(d.v + (dx / 72) * 100); },
      lUp: (e) => { const d = this.lum; this.lum = null; if (d && d.far < 4 && e.timeStamp - d.t < 320 && twice(e)) setLum(0); },
      minis: ZONES.filter((z) => z !== zone).map((z) => { const [h, s] = of(z), [x, y] = at(h, s, MINI); return { name: z, label: z.toUpperCase().slice(0, 4), x: x.toFixed(1), y: y.toFixed(1), puck: `hsl(${h} ${Math.round(s * 0.8)}% 50%)`, pick: () => this.props.onzone?.(z) }; }),
    };
  }
}
