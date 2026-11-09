// @ts-nocheck
// The GradeTrio board, as designed (docs/design/editor/boards/GradeTrio.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { pucks: { Shadows: [215, 14], Midtones: [40, 6], Highlights: [48, 18], Global: [0, 0] } };
    this.drag = null;
  }
  renderVals() {
    const zone = this.props.zone ?? 'Shadows';
    // three equal wheels side by side so the split can be judged at a glance; global smaller at the end
    const layout = [['Shadows', 10, 12, 92], ['Midtones', 110, 12, 92], ['Highlights', 210, 12, 92], ['Global', 314, 26, 64]];
    const set = (name, h, s) => this.setState({ pucks: { ...this.state.pucks, [name]: [Math.round(((h % 360) + 360) % 360), Math.round(Math.max(0, Math.min(100, s)))] } });
    const wheels = layout.map(([name, x, y, d]) => {
      const [hue, sat] = this.state.pucks[name];
      const rad = (hue * Math.PI) / 180, r = (sat / 100) * (d / 2), on = name === zone;
      const fromEvent = (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - b.left - d / 2, dy = b.top + d / 2 - e.clientY;
        set(name, (Math.atan2(dy, dx) * 180) / Math.PI, (Math.hypot(dx, dy) / (d / 2)) * 100);
      };
      return {
        name, x, y, d, hue, sat, label: name.toUpperCase(),
        px: (d / 2 + r * Math.cos(rad)).toFixed(1), py: (d / 2 - r * Math.sin(rad)).toFixed(1),
        puck: `hsl(${hue} ${Math.round(sat * 0.8)}% 50%)`,
        ring: on ? '#e8202a' : 'transparent', ringW: on ? 2 : 0, ink: on ? '#f2efe8' : '#8b95a1', dim: on ? 1 : 0.8,
        down: (e) => { this.drag = name; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); fromEvent(e); },
        move: (e) => { if (this.drag === name) fromEvent(e); },
        up: () => { this.drag = null; },
      };
    });
    return { wheels };
  }
}
