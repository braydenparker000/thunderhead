// @ts-nocheck
// The Heal board. With a photo open (app/session.js) the spots are the photo's own (app/heal.js, engine/heal.js):
// a tap retouches a spot from a source the engine picks nearby, the dashed circle is that source and can be
// dragged, and the photo itself shows the result. The drum chooses the tool (Heal, Clone, Remove); the dial sets
// the chosen spot's size, feather and opacity (and the next one's). Without a photo it plays a sample.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as heal from '../app/heal.js';
import * as zoom from '../app/zoom.js';   // two fingers zoom and move the photo; one retouches

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { tool: 'Heal', ctl: 'Size', vals: { Size: 30, Feather: 50, Opacity: 100 }, spots: [{ x: 300, y: 52, sx: 262, sy: 40, s: 26, tool: 'Heal' }], sel: 0, viz: false };
    this.drag = null; this.tap = null;
    if (photo.current()) Object.assign(this.state, { sel: Math.max(0, heal.list().length - 1) });
    this.keep('Heal', ['tool', 'ctl', 'vals']);
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), V = S.vals;
    const size = 8 + (V.Size / 100) * 72;
    const tools = ['Heal', 'Clone', 'Remove'];
    // with a photo: where it sits in its room, and its spots as the board draws them (in the room's pixels)
    const real = photo.current(), eng = real && photo.eng;
    let box = [20, 200, 372, 248], spots = S.spots;
    if (real) {
      const [w, h] = photo.shape(), room = 649 - (parseFloat(getComputedStyle(document.getElementById('frame') || document.body).getPropertyValue('--cut')) || 0), k = Math.min(412 / w, room / h);
      box = [(412 - w * k) / 2, (room - h * k) / 2, w * k, h * k];
      const px = (x, y) => { const [u, v] = eng ? eng.shownPoint(x, y) : [0, 0]; return [u * box[2], v * box[3]]; };
      spots = heal.list().map((p) => { const c = px(p.x, p.y), e = px(p.x + p.r, p.y), q = px(p.sx, p.sy); return { x: c[0], y: c[1], sx: q[0], sy: q[1], s: 2 * Math.hypot(e[0] - c[0], e[1] - c[1]), tool: p.tool }; });
    }
    const sel = Math.max(0, Math.min(S.sel, spots.length - 1));
    const patches = (real ? [] : spots).map((p) => ({ x: p.x, y: p.y, s: p.s, m: -p.s / 2, il: -p.sx + p.s / 2, it: -p.sy + p.s / 2,
      hard: p.tool === 'Clone' ? 60 : Math.round(60 - (V.Feather / 100) * 40), o: (V.Opacity / 100) * (p.tool === 'Heal' ? 0.92 : 1) }));
    const fine = real ? 1 / zoom.mag() : 1;   // lines keep their weight on screen however far the photo is zoomed
    const rings = spots.map((p, i) => ({ x: p.x, y: p.y, sx: p.sx, sy: p.sy, r: p.s / 2, ink: i === sel ? '#e8202a' : '#f2efe8', w: (i === sel ? 2 : 1.2) * fine, thin: 1.2 * fine, d1: `${3 * fine} ${3 * fine}`, d2: `${4 * fine} ${3 * fine}`, a: i === sel ? 0.9 : 0.45 }));
    const rows = { Heal: ['Size', 'Feather', 'Opacity'], Clone: ['Size', 'Feather', 'Opacity'], Remove: ['Size', 'Opacity'] };
    const ctl = rows[S.tool].includes(S.ctl) ? S.ctl : 'Size', val = V[ctl];
    const START = { Size: 30, Feather: 50, Opacity: 100 };
    const undoSpot = () => { if (real) heal.undoSpot(); set({ spots: real ? S.spots : spots.slice(0, -1), sel: Math.max(0, spots.length - 2) }); };
    const chips = rows[S.tool].map((a) => ({ name: a, value: String(Math.round(V[a])), on: a === ctl, pick: () => set({ ctl: a }) }))
      .concat([{ name: 'Visualize', value: S.viz ? 'ON' : 'OFF', on: S.viz, pick: () => set({ viz: !S.viz }) }, { name: 'Undo spot', entry: true, pick: undoSpot },
        { name: 'Clear all', entry: true, hot: true, pick: () => { if (real) heal.clear(); set({ spots: real ? S.spots : [], sel: 0 }); } }]);
    // the dial set to `v` (1..100): the chosen spot takes it, and so does the next one made
    const setCtl = (v0) => {
      const v = Math.max(1, Math.min(100, v0)), sz = 8 + (v / 100) * 72, st = this.state;
      if (real && heal.list()[sel]) { if (ctl === 'Size') heal.resize(sel, sz / box[2] / zoom.mag(), String(Math.round(sz))); else heal.set(sel, { [ctl.toLowerCase()]: Math.round(v) / 100 }, ctl, `Spot ${ctl.toLowerCase()}`, String(Math.round(v))); }
      this.setState({ vals: { ...st.vals, [ctl]: v }, spots: ctl === 'Size' ? st.spots.map((p, i) => (i === st.sel ? { ...p, s: sz } : p)) : st.spots });
    };
    const pickSource = (x, y, s) => { const cands = [[-1.6, -0.6], [1.6, -0.6], [-1.6, 0.8], [1.6, 0.8]].map(([a, b]) => [x + a * s, y + b * s]).filter(([u, v]) => u > s / 2 && u < 372 - s / 2 && v > s / 2 && v < 248 - s / 2); return cands[0] || [x, y - s * 1.6]; };
    // a touch on the photo, in the board's own pixels whatever the page is scaled by
    const at = (e, b = e.currentTarget.getBoundingClientRect()) => [((e.clientX - b.left) / b.width) * box[2], ((e.clientY - b.top) / b.height) * box[3]];
    return {
      real: !!real, demo: !real, pL: box[0], pT: box[1], pW: box[2], pH: box[3], zoomT: real ? zoom.transform() : 'none',
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      toolVerb: S.tool.toLowerCase(), viz: S.viz ? 'grayscale(1) contrast(3.2) brightness(1.1)' : 'none', patches, rings,
      status: S.viz ? 'Visualize · dust and spots stand out' : `${spots.length} spot${spots.length === 1 ? '' : 's'} · tap to ${S.tool.toLowerCase()} · drag a dashed circle to move its source`,
      pDown: (e) => {
        const b = e.currentTarget.getBoundingClientRect(), [x, y] = at(e, b);
        const hit = spots.findIndex((p) => Math.hypot(p.sx - x, p.sy - y) < p.s / 2 + 8);
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
        if (hit >= 0) { this.drag = { i: hit, b }; set({ sel: hit }); return; }
        const near = spots.findIndex((p) => Math.hypot(p.x - x, p.y - y) < p.s / 2);
        if (near >= 0) return set({ sel: near });
        if (real) { this.tap = { x, y, cx: e.clientX, cy: e.clientY }; return; }   // the spot is made when the finger lifts where it landed: a second finger makes it a pinch (zoom.js)
        const [sx, sy] = pickSource(x, y, size);
        set({ spots: spots.concat([{ x, y, sx, sy, s: size, tool: S.tool }]), sel: spots.length });
      },
      pMove: (e) => {
        if (real && zoom.pinching()) { this.drag = this.tap = null; return; }
        if (this.tap && Math.hypot(e.clientX - this.tap.cx, e.clientY - this.tap.cy) > 10) this.tap = null;
        const d = this.drag; if (!d) return; const [x, y] = at(e, d.b); if (real) return heal.moveSource(d.i, x / box[2], y / box[3]); this.setState({ spots: this.state.spots.map((p, i) => (i === d.i ? { ...p, sx: x, sy: y } : p)) }); },
      pUp: (e) => {
        const t = this.tap; this.drag = this.tap = null;
        if (real && t && e?.type === 'pointerup' && !zoom.pinching()) { const i = heal.add(S.tool, t.x / box[2], t.y / box[3], size / box[2] / zoom.mag(), V.Feather / 100, V.Opacity / 100); if (i >= 0) set({ sel: i }); }
      },
      dialLabel: `${S.tool} · ${ctl}`, unit: ctl === 'Size' ? 'px' : '%', dialValue: val / 10 - 5, dialText: String(Math.round(ctl === 'Size' ? size : val)),
      dialTurn: (d) => setCtl((d + 5) * 10), dialReset: () => setCtl(START[ctl]),
      faces: tools.map((t) => ({ label: t, count: (real ? heal.list() : spots).filter((p) => p.tool === t).length })), faceAt: tools.indexOf(S.tool), pickFace: (i) => set({ tool: tools[i] }),
      chips, rowAria: `${S.tool} options`, dialLeft: true,
    };
  }
}
