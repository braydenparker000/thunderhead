// @ts-nocheck
// The CurveOverlay board, as designed (docs/design/editor/boards/CurveOverlay.dc.html.dc.html). With a photo open the
// points are the photo's own point curve (app/session.js), which the engine draws through the same cubic, over the
// photo's own histogram (app/scope.js); the point last touched is the one the plate's dial turns.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import { scope } from '../app/scope.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const base = () => [[0, 0], [0.25, 0.21], [0.75, 0.80], [1, 1]];
    this.state = { curves: { RGB: base(), R: [[0, 0], [1, 1]], G: [[0, 0], [1, 1]], B: [[0, 0], [1, 1]] }, sel: 1 };
    this.drag = null;
  }
  renderVals() {
    const ch = this.props.channel ?? 'RGB';
    const real = photo.current(), held = real ? photo.curve() || {} : this.state.curves;
    const pts = held[ch] || [[0, 0], [1, 1]];
    const X = (u) => 14 + u * 272, Y = (v) => 286 - v * 272;
    // monotone cubic (Fritsch-Carlson) through the points, as Lightroom draws its curve
    const n = pts.length, m = [], dk = [];
    for (let i = 0; i < n - 1; i++) dk.push((pts[i + 1][1] - pts[i][1]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
    for (let i = 0; i < n; i++) m.push(i === 0 ? dk[0] : i === n - 1 ? dk[n - 2] : (dk[i - 1] * dk[i] <= 0 ? 0 : (dk[i - 1] + dk[i]) / 2));
    let path = `M${X(pts[0][0]).toFixed(1)} ${Y(pts[0][1]).toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
      path += ` C${X(x0 + h).toFixed(1)} ${Y(y0 + m[i] * h).toFixed(1)} ${X(x1 - h).toFixed(1)} ${Y(y1 - m[i + 1] * h).toFixed(1)} ${X(x1).toFixed(1)} ${Y(y1).toFixed(1)}`;
    }
    const ink = { RGB: '#eceff4', R: '#ff6b6b', G: '#5fd38d', B: '#6aa2ff' }[ch];
    const sel = Math.min(real ? photo.picked.i : this.state.sel, n - 1);
    const dots = pts.map(([u, v], i) => ({ x: X(u), y: Y(v), s: i === sel ? 14 : 10, m: i === sel ? -7 : -5, bg: i === sel ? ink : '#0b0c0e', ring: ink }));
    const setPts = (next, s) => { if (real) { photo.picked.i = s; photo.setCurve(ch, next); } else this.setState({ curves: { ...this.state.curves, [ch]: next }, sel: s }); };
    const local = (e) => { const r = e.currentTarget.getBoundingClientRect(), k = r.width / 300 || 1; return [Math.max(0, Math.min(1, ((e.clientX - r.left) / k - 14) / 272)), Math.max(0, Math.min(1, (286 - (e.clientY - r.top) / k) / 272))]; };   // the page is scaled to the screen (boot.js)
    return {
      hill: real ? scope(this.drag === null)?.hills[ch] || '' : 'M14 286 C40 280 52 230 74 236 S110 160 128 190 S170 120 190 150 S236 210 252 240 S280 270 286 286 Z',
      channel: ch, chanUp: ch === 'RGB' ? 'RGB · TONE CURVE' : `${ch} CHANNEL`, ink, path, dots,
      readout: `In ${Math.round(pts[sel][0] * 255)} · Out ${Math.round(pts[sel][1] * 255)}`,
      down: (e) => {
        const [u, v] = local(e);
        let best = -1, bd = 0.06;
        pts.forEach(([pu, pv], i) => { const d = Math.hypot(pu - u, pv - v); if (d < bd) { bd = d; best = i; } });
        if (best < 0) { const next = [...pts, [u, v]].sort((a, b) => a[0] - b[0]); best = next.findIndex((p) => p[0] === u); setPts(next, best); } else { photo.picked.i = best; this.setState({ sel: best }); }
        this.drag = best;
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
      },
      move: (e) => {
        if (this.drag === null) return;
        const [u, v] = local(e), i = this.drag, cur = pts;
        const lo = i === 0 ? 0 : cur[i - 1][0] + 0.02, hi = i === cur.length - 1 ? 1 : cur[i + 1][0] - 0.02;
        const next = cur.map((p, k) => (k === i ? [i === 0 || i === cur.length - 1 ? p[0] : Math.max(lo, Math.min(hi, u)), v] : p));
        setPts(next, i);
      },
      up: () => { this.drag = null; },
    };
  }
}
