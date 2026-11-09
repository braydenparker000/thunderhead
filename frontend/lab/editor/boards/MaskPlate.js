// @ts-nocheck
// The MaskPlate board, as designed (docs/design/editor/boards/MaskPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      masks: [{ kind: 'Sky', n: 1, vals: { Exposure: -0.4, Highlights: -35, Dehaze: 12, Amount: 100 }, invert: false, erase: false, dots: [] },
        { kind: 'Subject', n: 1, vals: { Exposure: 0.25, Clarity: 10, Amount: 100 }, invert: false, erase: false, dots: [] }],
      sel: 0, group: 'Light', adj: 'Exposure', adding: false, detecting: null, overlay: true, spin: 0, turning: false,
    };
    this.drag = null; this.painting = false;
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    const R = 'rgba(232,32,42,0.5)', T = 'rgba(232,32,42,0)', G = '#3a3c3f', C = '#e8202a';
    const shapes = {
      Sky: [`linear-gradient(180deg, ${R} 0, ${R} 36%, ${T} 52%)`, `linear-gradient(180deg, ${T} 36%, ${R} 52%)`, `linear-gradient(${C} 0 50%, ${G} 50%)`],
      Subject: [`radial-gradient(ellipse 16% 30% at 52% 62%, ${R} 70%, ${T} 100%)`, `radial-gradient(ellipse 16% 30% at 52% 62%, ${T} 70%, ${R} 100%)`, `radial-gradient(circle at 50% 60%, ${C} 0 35%, ${G} 40%)`],
      Background: [`radial-gradient(ellipse 16% 30% at 52% 62%, ${T} 70%, ${R} 100%)`, `radial-gradient(ellipse 16% 30% at 52% 62%, ${R} 70%, ${T} 100%)`, `radial-gradient(circle at 50% 60%, ${G} 0 35%, ${C} 40%)`],
      People: [`radial-gradient(ellipse 8% 26% at 70% 64%, ${R} 70%, ${T} 100%)`, `radial-gradient(ellipse 8% 26% at 70% 64%, ${T} 70%, ${R} 100%)`, `radial-gradient(circle at 50% 32%, ${C} 0 17%, transparent 19%), radial-gradient(ellipse at 50% 100%, ${C} 0 45%, ${G} 47%)`],
      Object: [`radial-gradient(ellipse 14% 12% at 30% 72%, ${R} 70%, ${T} 100%)`, `radial-gradient(ellipse 14% 12% at 30% 72%, ${T} 70%, ${R} 100%)`, `radial-gradient(${C} 0 32%, ${G} 34%)`],
      Brush: ['none', 'none', `radial-gradient(circle at 35% 40%, ${C} 0 24%, transparent 26%), radial-gradient(circle at 65% 62%, ${C} 0 24%, ${G} 26%)`],
      Linear: [`linear-gradient(170deg, ${R} 0, ${R} 30%, ${T} 55%)`, `linear-gradient(170deg, ${T} 30%, ${R} 55%)`, `linear-gradient(160deg, ${C} 0 30%, ${G} 70%)`],
      Radial: [`radial-gradient(ellipse 15% 31% at 45% 49%, ${R} 55%, ${T} 100%)`, `radial-gradient(ellipse 15% 31% at 45% 49%, ${T} 55%, ${R} 100%)`, `radial-gradient(circle, ${C} 0 30%, ${G} 60%)`],
      Color: [R, R, `conic-gradient(${C}, #f2b632, #46a758, #3e63dd, ${C})`],
      Luminance: [R, R, 'linear-gradient(90deg, #111, #eee)'],
    };
    const masks = S.masks, m = masks[Math.min(S.sel, masks.length - 1)];
    const ai = ['Subject', 'Sky', 'Background', 'People', 'Object'];
    const rows = {
      Light: ['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks'],
      Color: ['Temp', 'Tint', 'Hue', 'Saturation'],
      Effects: ['Texture', 'Clarity', 'Dehaze', 'Sharpness', 'Noise'],
      Mask: (m.kind === 'Brush' ? ['Size', 'Feather', 'Flow', 'Erase'] : ['Linear', 'Radial'].includes(m.kind) ? ['Feather'] : []).concat(['Amount', 'Invert', 'Delete']),
    };
    const toggles = { Erase: m.erase, Invert: m.invert };
    const uni = { Size: 40, Feather: 50, Flow: 60, Amount: 100 };      // 0..100 settings and their defaults
    const valOf = (a) => m.vals[a] ?? uni[a] ?? 0;
    const spec = (a) => a === 'Exposure' ? [-4, 4, 'EV', 4 / 180] : uni[a] !== undefined ? [0, 100, '', 100 / 180] : [-100, 100, '', 100 / 180];
    const fmt = (a, x) => a === 'Exposure' ? (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + Math.abs(x).toFixed(2) : uni[a] !== undefined ? String(Math.round(x)) : (x > 0.5 ? '+' : x < -0.5 ? '−' : '') + Math.abs(Math.round(x));
    const adj = rows[S.group].includes(S.adj) && !toggles.hasOwnProperty(S.adj) && S.adj !== 'Delete' ? S.adj : rows[S.group].find((a) => !(a in toggles) && a !== 'Delete') || 'Amount';
    const [lo, hi, unit, perDeg] = spec(adj), val = valOf(adj);
    const setMask = (patch) => set({ masks: masks.map((x, i) => (i === S.sel ? { ...x, ...patch } : x)) });
    const setVal = (a, x) => setMask({ vals: { ...m.vals, [a]: Math.max(spec(a)[0], Math.min(spec(a)[1], x)) } });
    // window: bipolar values fill from the centre, 0..100 settings fill from the left end
    const span = 328, f = lo < 0 ? val / hi : val / hi;
    const fillL = lo < 0 ? 186 + Math.min(0, f) * (span / 2) : 22, fillW = lo < 0 ? Math.abs(f) * (span / 2) : f * span;
    const numX = lo < 0 ? 186 + f * (span / 2) : 22 + f * span;
    const groups = Object.keys(rows), gi = groups.indexOf(S.group), secX = 14 + (384 / 4) * (gi + 0.5);
    let cx = 14;
    const chips = rows[S.group].map((a, i) => {
      const isT = a in toggles, isDel = a === 'Delete', on = isT ? toggles[a] : !isDel && a === adj;
      const value = isT ? (toggles[a] ? 'ON' : 'OFF') : isDel ? '' : fmt(a, valOf(a));
      const w = 16 + Math.max(a.length, value.length * 0.8) * 7.6, c = cx + w / 2; cx += w + 4;
      return { name: a.toUpperCase(), value, on: String(on), aria: a, pad: 8, size: 10,
        ink: isDel ? '#e8202a' : on ? '#f2efe8' : '#80848a', valueInk: on ? '#e8202a' : (value === '0' || value === 'OFF' ? '#4f5357' : '#6a6e73'), bar: on ? '#e8202a' : 'transparent',
        dx: (secX - c).toFixed(0), delay: i * 32, anim: 'fly' + (gi + (S.group === 'Mask' ? masks.length % 4 : 0)),
        pick: () => {
          if (a === 'Erase') return setMask({ erase: !m.erase });
          if (a === 'Invert') return setMask({ invert: !m.invert });
          if (a === 'Delete') return set({ masks: masks.length > 1 ? masks.filter((_, k) => k !== S.sel) : masks, sel: 0, group: 'Light', adj: 'Exposure' });
          set({ adj: a });
        } };
    });
    const label = (x) => (ai.includes(x.kind) || x.kind === 'Brush' || x.kind === 'Color' || x.kind === 'Luminance' ? x.kind : `${x.kind} gradient`) + (x.n > 1 ? ` ${x.n}` : '');
    const edits = (x) => Object.entries(x.vals).filter(([k, v]) => !(k in uni) && Math.abs(v) > 0.004).length;
    const add = (kind) => {
      const n = masks.filter((x) => x.kind === kind).length + 1;
      const next = [...masks, { kind, n, vals: {}, invert: false, erase: false, dots: [] }];
      set({ masks: next, sel: next.length - 1, adding: false, group: kind === 'Brush' ? 'Mask' : 'Light', adj: kind === 'Brush' ? 'Size' : 'Exposure', detecting: ai.includes(kind) ? kind : null });
      if (ai.includes(kind)) setTimeout(() => this.setState({ detecting: null }), 1100);
    };
    const groupsAdd = [['DETECT', ['Subject', 'Sky', 'Background', 'People', 'Object']], ['DRAW', ['Brush', 'Linear', 'Radial']], ['RANGE', ['Color', 'Luminance']]];
    const shape = shapes[m.kind];
    const isRange = m.kind === 'Color' || m.kind === 'Luminance';
    const brushS = (valOf('Size') / 100) * 60 + 8;
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    return {
      overlay: shape[m.invert ? 1 : 0], lumMask: isRange ? 'url(/lab/editor/assets/sample.jpg)' : 'none',
      overlayO: S.overlay && !S.detecting ? (valOf('Amount') / 100) * 0.9 + 0.1 : 0,
      dots: m.kind === 'Brush' ? m.dots.map((d) => ({ x: d[0], y: d[1], s: d[2], m: -d[2] / 2 })) : [],
      guides: ['Linear', 'Radial'].includes(m.kind) && S.overlay, isRadial: m.kind === 'Radial',
      guideLines: m.kind === 'Linear' ? [{ y: 40, style: 'solid' }, { y: 74, style: 'dashed' }, { y: 108, style: 'solid' }] : [],
      detecting: !!S.detecting, detectName: (S.detecting || '').toLowerCase(),
      photoAria: m.kind === 'Brush' ? `Paint the brush mask, ${m.erase ? 'erasing' : 'adding'}` : 'Photo',
      photoTouch: m.kind === 'Brush' ? 'none' : 'auto', photoCursor: m.kind === 'Brush' ? 'crosshair' : 'default',
      pDown: (e) => { if (m.kind !== 'Brush') return; this.painting = true; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); this.paint(e, brushS); },
      pMove: (e) => { if (this.painting) this.paint(e, brushS); },
      pUp: () => { this.painting = false; },
      list: masks.map((x, i) => ({ name: label(x), on: String(i === S.sel), weight: i === S.sel ? 600 : 500, bg: i === S.sel ? 'rgba(255,255,255,0.16)' : 'transparent',
        thumb: shapes[x.kind][2], count: edits(x) ? String(edits(x)) : '', countInk: i === S.sel ? '#e8202a' : '#a6b0bc',
        pick: () => set({ sel: i, adding: false, group: S.group === 'Mask' && x.kind !== m.kind ? 'Light' : S.group }) })),
      adding: S.adding, openAdd: () => set({ adding: !S.adding }),
      addGroups: groupsAdd.map(([title, kinds]) => ({ title, items: kinds.map((k) => ({ name: k, thumb: shapes[k][2], pick: () => add(k) })) })),
      ctl: adj, ctlUp: `${label(m).toUpperCase()} · ${adj.toUpperCase()}`, unit, valText: fmt(adj, val), valNow: String(val), vmin: lo, vmax: hi,
      fillL: fillL.toFixed(1), fillW: Math.max(0, fillW).toFixed(1), numX: Math.max(34, Math.min(338, numX)).toFixed(1),
      spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, v: val, s: S.spin, a: adj }; set({ turning: true }); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => { const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI); const cur = this.state.masks[this.state.sel];
        this.setState({ spin: d.s + deg, masks: this.state.masks.map((x, i) => (i === this.state.sel ? { ...x, vals: { ...cur.vals, [d.a]: Math.max(lo, Math.min(hi, d.v + deg * perDeg)) } } : x)) }); },
      dUp: () => { this.drag = null; set({ turning: false }); },
      dKey: (e) => { const st = adj === 'Exposure' ? 0.05 : 1; if (e.key === 'ArrowRight') setVal(adj, val + st); if (e.key === 'ArrowLeft') setVal(adj, val - st); },
      group: S.group, chips,
      groups: groups.map((g) => ({ label: g.toUpperCase(), current: String(g === S.group), ink: g === S.group ? '#f2efe8' : '#7d8187', dot: g === S.group ? '#e8202a' : 'transparent',
        pick: () => set({ group: g, adj: rows[g].find((a) => !(a in toggles) && a !== 'Delete') || 'Amount' }) })),
      actions: [{ name: 'OVERLAY', dot: S.overlay, pick: () => set({ overlay: !S.overlay }), pressed: String(S.overlay) }, { name: 'RESET MASK', dot: false, pick: () => setMask({ vals: {}, dots: [], invert: false }), pressed: 'false' }],
    };
  }
  paint(e, size) {
    const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const S = this.state, m = S.masks[S.sel];
    const dots = m.erase ? m.dots.filter((d) => Math.hypot(d[0] - x, d[1] - y) > size / 2) : m.dots.concat([[x, y, size]]).slice(-400);
    this.setState({ masks: S.masks.map((q, i) => (i === S.sel ? { ...q, dots } : q)) });
  }
}
