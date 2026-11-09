// @ts-nocheck
// The HealPlate board, as designed (docs/design/editor/boards/HealPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { tool: 'Heal', ctl: 'Size', vals: { Size: 30, Feather: 50, Opacity: 100 }, spots: [{ x: 300, y: 52, sx: 262, sy: 40, s: 26, tool: 'Heal' }], sel: 0, viz: false, spin: 0 };
    this.drag = null; this.tap = null;
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), V = S.vals;
    const size = 8 + (V.Size / 100) * 72;
    const tools = ['Heal', 'Clone', 'Remove'];
    const spots = S.spots;
    const patches = spots.map((p) => ({ x: p.x, y: p.y, s: p.s, m: -p.s / 2, il: -p.sx + p.s / 2, it: -p.sy + p.s / 2,
      hard: p.tool === 'Clone' ? 60 : Math.round(60 - (V.Feather / 100) * 40), o: (V.Opacity / 100) * (p.tool === 'Heal' ? 0.92 : 1) }));
    const rings = spots.map((p, i) => ({ x: p.x, y: p.y, sx: p.sx, sy: p.sy, r: p.s / 2, ink: i === S.sel ? '#e8202a' : '#f2efe8', w: i === S.sel ? 2 : 1.2, a: i === S.sel ? 0.9 : 0.45 }));
    const rows = { Heal: ['Size', 'Feather', 'Opacity'], Clone: ['Size', 'Feather', 'Opacity'], Remove: ['Size', 'Opacity'] };
    const ctl = rows[S.tool].includes(S.ctl) ? S.ctl : 'Size', val = V[ctl];
    const gi = tools.indexOf(S.tool), secX = 14 + (384 / 3) * (gi + 0.5);
    let cx = 14;
    const items = rows[S.tool].map((a) => ({ a, value: String(Math.round(V[a])) })).concat([{ a: 'Visualize', value: S.viz ? 'ON' : 'OFF', t: true }]);
    const chips = items.map((o, i) => {
      const w = 16 + o.a.length * 7.6, x = cx + w / 2; cx += w + 4; const on = o.t ? S.viz : o.a === ctl;
      return { name: o.a.toUpperCase(), value: o.value, on: String(on), aria: o.a, pad: 8, size: 10, ink: on ? '#f2efe8' : '#80848a', valueInk: on ? '#e8202a' : '#6a6e73', bar: on ? '#e8202a' : 'transparent',
        dx: (secX - x).toFixed(0), delay: i * 32, anim: 'fly' + gi, pick: () => (o.t ? set({ viz: !S.viz }) : set({ ctl: o.a })) };
    });
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const pickSource = (x, y, s) => { const cands = [[-1.6, -0.6], [1.6, -0.6], [-1.6, 0.8], [1.6, 0.8]].map(([a, b]) => [x + a * s, y + b * s]).filter(([u, v]) => u > s / 2 && u < 372 - s / 2 && v > s / 2 && v < 248 - s / 2); return cands[0] || [x, y - s * 1.6]; };
    return {
      toolVerb: S.tool.toLowerCase(), viz: S.viz ? 'grayscale(1) contrast(3.2) brightness(1.1)' : 'none', patches, rings,
      status: S.viz ? 'Visualize · dust and spots stand out' : `${spots.length} spot${spots.length === 1 ? '' : 's'} · tap to ${S.tool.toLowerCase()} · drag a dashed circle to move its source`,
      pDown: (e) => {
        const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
        const hit = spots.findIndex((p) => Math.hypot(p.sx - x, p.sy - y) < p.s / 2 + 8);
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
        if (hit >= 0) { this.drag = { i: hit, b }; set({ sel: hit }); return; }
        const near = spots.findIndex((p) => Math.hypot(p.x - x, p.y - y) < p.s / 2);
        if (near >= 0) return set({ sel: near });
        const [sx, sy] = pickSource(x, y, size);
        set({ spots: spots.concat([{ x, y, sx, sy, s: size, tool: S.tool }]), sel: spots.length });
      },
      pMove: (e) => { const d = this.drag; if (!d) return; const x = e.clientX - d.b.left, y = e.clientY - d.b.top; this.setState({ spots: this.state.spots.map((p, i) => (i === d.i ? { ...p, sx: x, sy: y } : p)) }); },
      pUp: () => { this.drag = null; },
      ctl, ctlUp: `${S.tool.toUpperCase()} · ${ctl.toUpperCase()}`, unit: ctl === 'Size' ? 'px' : '%', valText: String(Math.round(ctl === 'Size' ? size : val)), valNow: String(Math.round(val)), vmin: 0, vmax: 100,
      fillL: 22, fillW: ((val / 100) * 328).toFixed(1), numX: Math.max(34, Math.min(338, 22 + (val / 100) * 328)).toFixed(1), spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.dd = { x: e.clientX, s: S.spin, v: val }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => {
        const d = this.dd; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI), v = Math.max(1, Math.min(100, d.v + deg * (100 / 180)));
        const sz = 8 + (v / 100) * 72, st = this.state;
        this.setState({ spin: d.s + deg, vals: { ...st.vals, [ctl]: v }, spots: ctl === 'Size' ? st.spots.map((p, i) => (i === st.sel ? { ...p, s: sz } : p)) : st.spots });
      },
      dUp: () => { this.dd = null; }, dKey: () => {},
      group: S.tool, chips,
      groups: tools.map((g) => ({ label: g.toUpperCase(), current: String(g === S.tool), ink: g === S.tool ? '#f2efe8' : '#7d8187', dot: g === S.tool ? '#e8202a' : 'transparent', pick: () => set({ tool: g }) })),
      auto: () => set({ spots: spots.slice(0, -1), sel: Math.max(0, spots.length - 2) }),
      reset: () => set({ spots: [], sel: 0 }),
    };
  }
}
