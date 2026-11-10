// @ts-nocheck
// The MaskPlate board, as designed (docs/design/editor/boards/MaskPlate.dc.html.dc.html). With a photo open
// (app/session.js) the masks are the photo's own (app/masks.js, engine/local.js): linear and radial gradients laid
// on the picture with a finger, and ranges of colour or brightness picked with a tap; the dial turns the chosen
// mask's own adjustments and the engine lays the mask over the picture in red. Without one it plays the design's
// sample. A brush mask is painted on the photo (Size, Feather and Flow are the brush's, Erase rubs out). Not built
// yet, so not offered with a photo: detection (Subject, Sky …), Sharpness and Noise.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as mk from '../app/masks.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      masks: [{ kind: 'Sky', n: 1, vals: { Exposure: -0.4, Highlights: -35, Dehaze: 12, Amount: 100 }, invert: false, erase: false, dots: [] },
        { kind: 'Subject', n: 1, vals: { Exposure: 0.25, Clarity: 10, Amount: 100 }, invert: false, erase: false, dots: [] }],
      sel: 0, group: 'Light', adj: 'Exposure', adding: false, detecting: null, overlay: true, spin: 0, turning: false,
    };
    this.drag = null; this.painting = false; this.grab = null;
    if (photo.current()) Object.assign(this.state, { sel: 0, adding: !mk.list().length });
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
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
    const real = photo.current(), eng = real && photo.eng;
    const masks = real ? mk.list() : S.masks, sel = Math.max(0, Math.min(S.sel, masks.length - 1)), has = masks.length > 0;
    const m = masks[sel] || { kind: 'Linear', n: 1, vals: {}, invert: false };   // none yet: the plate shows an empty one
    if (real) mk.show(S.overlay && has && !S.turning ? sel : -1);   // the red comes off while the dial turns, so the change itself shows
    const ai = ['Subject', 'Sky', 'Background', 'People', 'Object'];
    const rows = {
      Light: ['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks'],
      Color: ['Temp', 'Tint', 'Hue', 'Saturation'],
      Effects: real ? ['Texture', 'Clarity', 'Dehaze'] : ['Texture', 'Clarity', 'Dehaze', 'Sharpness', 'Noise'],
      Mask: (m.kind === 'Brush' ? ['Size', 'Feather', 'Flow', 'Erase'] : ['Linear', 'Radial'].includes(m.kind) ? ['Feather'] : real ? ['Range', 'Feather'] : []).concat(['Amount', 'Invert', 'Delete']),
    };
    const toggles = { Erase: real ? !!S.erase : m.erase, Invert: m.invert };
    const tool = real && m.kind === 'Brush' ? ['Size', 'Feather', 'Flow'] : [];   // the brush's own settings: the board's, not the edit's
    const uni = { Size: 40, Feather: 50, Flow: 60, Amount: 100, ...(real ? mk.UNI : {}) };      // 0..100 settings and their defaults
    const valOf = (a) => (tool.includes(a) ? S.brush?.[a] : m.vals[a]) ?? uni[a] ?? 0;
    const spec = (a) => a === 'Exposure' ? [-4, 4, 'EV', 4 / 180] : uni[a] !== undefined ? [0, 100, '', 100 / 180] : [-100, 100, '', 100 / 180];
    const fmt = (a, x) => a === 'Exposure' ? (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + Math.abs(x).toFixed(2) : uni[a] !== undefined ? String(Math.round(x)) : (x > 0.5 ? '+' : x < -0.5 ? '−' : '') + Math.abs(Math.round(x));
    const adj = rows[S.group].includes(S.adj) && !toggles.hasOwnProperty(S.adj) && S.adj !== 'Delete' ? S.adj : rows[S.group].find((a) => !(a in toggles) && a !== 'Delete') || 'Amount';
    const [lo, hi, unit, perDeg] = spec(adj), val = valOf(adj);
    const setMask = (patch) => set({ masks: masks.map((x, i) => (i === S.sel ? { ...x, ...patch } : x)) });
    const setVal = (a, x) => { const v = Math.max(spec(a)[0], Math.min(spec(a)[1], x)), r = a === 'Exposure' ? Math.round(v * 100) / 100 : Math.round(v); if (tool.includes(a)) set({ brush: { ...S.brush, [a]: r } }); else if (real) { if (has) mk.setVal(sel, a, r, fmt(a, r)); } else setMask({ vals: { ...m.vals, [a]: v } }); };
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
          if (real && (a === 'Invert' || a === 'Delete')) { if (has) { if (a === 'Invert') mk.invert(sel); else { mk.remove(sel); set({ sel: 0, group: 'Light', adj: 'Exposure', adding: mk.list().length === 0 }); } } return; }
          if (a === 'Erase') return real ? set({ erase: !S.erase }) : setMask({ erase: !m.erase });
          if (a === 'Invert') return setMask({ invert: !m.invert });
          if (a === 'Delete') return set({ masks: masks.length > 1 ? masks.filter((_, k) => k !== S.sel) : masks, sel: 0, group: 'Light', adj: 'Exposure' });
          set({ adj: a });
        } };
    });
    const label = (x) => real ? mk.label(x) : (ai.includes(x.kind) || x.kind === 'Brush' || x.kind === 'Color' || x.kind === 'Luminance' ? x.kind : `${x.kind} gradient`) + (x.n > 1 ? ` ${x.n}` : '');
    const edits = (x) => Object.entries(x.vals).filter(([k, v]) => !(k in uni) && Math.abs(v) > 0.004).length;
    const add = (kind) => {
      if (real) { const i = mk.add(kind); if (i < 0) set({ adding: false }); else set({ sel: i, adding: false, erase: false, group: mk.RANGE.includes(kind) || kind === 'Brush' ? 'Mask' : 'Light', adj: kind === 'Brush' ? 'Size' : mk.RANGE.includes(kind) ? 'Range' : 'Exposure' }); return; }
      const n = masks.filter((x) => x.kind === kind).length + 1;
      const next = [...masks, { kind, n, vals: {}, invert: false, erase: false, dots: [] }];
      set({ masks: next, sel: next.length - 1, adding: false, group: kind === 'Brush' ? 'Mask' : 'Light', adj: kind === 'Brush' ? 'Size' : 'Exposure', detecting: ai.includes(kind) ? kind : null });
      if (ai.includes(kind)) setTimeout(() => this.setState({ detecting: null }), 1100);
    };
    const groupsAdd = real ? [['DRAW', mk.DRAW], ['RANGE', mk.RANGE]] : [['DETECT', ['Subject', 'Sky', 'Background', 'People', 'Object']], ['DRAW', ['Brush', 'Linear', 'Radial']], ['RANGE', ['Color', 'Luminance']]];
    const shape = shapes[m.kind];
    const isRange = m.kind === 'Color' || m.kind === 'Luminance';
    const brushS = (valOf('Size') / 100) * 60 + 8;
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    // where the photo sits in its room, and the gradient's guides over it (a mask's place is in mask units: the engine turns them to and from the picture as shown)
    let box = [20, 146, 372, 248], lines = m.kind === 'Linear' ? [40, 74, 108].map((y, i) => ({ x: 186, y, w: 452, ml: -226, rot: -10, style: i === 1 ? 'dashed' : 'solid' })) : [], rad = { l: '30%', t: '18%', w: '30%', h: '62%', rot: 0 }, note = S.detecting ? `Detecting ${S.detecting.toLowerCase()}…` : '';
    if (real) {
      const [w, h] = photo.shape(), room = 540 - (parseFloat(getComputedStyle(document.getElementById('frame') || document.body).getPropertyValue('--cut')) || 0), k = Math.min(412 / w, room / h);
      box = [(412 - w * k) / 2, (room - h * k) / 2, w * k, h * k];
      const px = (x, y) => { const [u, v] = eng ? eng.shownPoint(x, y) : [0, 0]; return [u * box[2], v * box[3]]; }, a = has && eng ? m.a : null;
      lines = [];
      if (a && m.kind === 'Linear') { const A = px(a[0], a[1]), B = px(a[2], a[3]), rot = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI + 90, wide = 2 * Math.hypot(box[2], box[3]);
        lines = [[A, 'solid'], [[(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], 'dashed'], [B, 'solid']].map(([q, style]) => ({ x: q[0], y: q[1], w: wide, ml: -wide / 2, rot, style })); }
      if (a && m.kind === 'Radial') { const C = px(a[0], a[1]), X = px(a[0] + a[2], a[1]), Y = px(a[0], a[1] + a[3]), rx = Math.hypot(X[0] - C[0], X[1] - C[1]), ry = Math.hypot(Y[0] - C[0], Y[1] - C[1]);
        rad = { l: `${C[0] - rx}px`, t: `${C[1] - ry}px`, w: `${2 * rx}px`, h: `${2 * ry}px`, rot: (Math.atan2(X[1] - C[1], X[0] - C[0]) * 180) / Math.PI }; }
      note = !has ? 'Add a mask to change part of the photo' : S.adding && masks.length >= 8 ? 'A photo can have eight masks' : m.kind === 'Brush' && !m.strokes?.length ? 'Paint on the photo' : mk.RANGE.includes(m.kind) && !m.pick ? `Tap the photo to pick a ${m.kind === 'Color' ? 'colour' : 'brightness'}` : '';
    }
    return {
      real: !!real, demo: !real, pL: box[0], pT: box[1], pW: box[2], pH: box[3], rad, hasNote: !!note, note, noteT: real ? Math.max(60, box[1] + box[3] - 46) : 410,
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      overlay: real ? 'none' : shape[m.invert ? 1 : 0], lumMask: isRange && !real ? 'url(/lab/editor/assets/sample.jpg)' : 'none',
      overlayO: real ? 0 : S.overlay && !S.detecting ? (valOf('Amount') / 100) * 0.9 + 0.1 : 0,
      dots: m.kind === 'Brush' && !real ? m.dots.map((d) => ({ x: d[0], y: d[1], s: d[2], m: -d[2] / 2 })) : [],
      guides: ['Linear', 'Radial'].includes(m.kind) && S.overlay && (!real || (has && !!m.a)), isRadial: m.kind === 'Radial',
      guideLines: lines,
      detecting: !!S.detecting, detectName: (S.detecting || '').toLowerCase(),
      photoAria: m.kind === 'Brush' ? `Paint the brush mask, ${(real ? S.erase : m.erase) ? 'erasing' : 'adding'}` : 'Photo',
      photoTouch: m.kind === 'Brush' || real ? 'none' : 'auto', photoCursor: m.kind === 'Brush' || (real && mk.RANGE.includes(m.kind)) ? 'crosshair' : 'default',
      pDown: (e) => { if (real) return this.down(e, m, sel, has, { size: brushS / box[2], feather: valOf('Feather') / 100, flow: valOf('Flow') / 100, erase: !!S.erase }); if (m.kind !== 'Brush') return; this.painting = true; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); this.paint(e, brushS); },
      pMove: (e) => { if (real) return this.move(e, sel); if (this.painting) this.paint(e, brushS); },
      pUp: () => { this.painting = false; this.grab = null; },
      list: masks.map((x, i) => ({ name: label(x), on: String(i === sel), weight: i === sel ? 600 : 500, bg: i === sel ? 'rgba(255,255,255,0.16)' : 'transparent',
        thumb: shapes[x.kind][2], count: edits(x) ? String(edits(x)) : '', countInk: i === sel ? '#e8202a' : '#a6b0bc',
        pick: () => set({ sel: i, adding: false, group: S.group === 'Mask' && x.kind !== m.kind ? 'Light' : S.group }) })),
      adding: S.adding, openAdd: () => set({ adding: !S.adding }),
      addGroups: groupsAdd.map(([title, kinds]) => ({ title, items: kinds.map((k) => ({ name: k, thumb: shapes[k][2], pick: () => add(k) })) })),
      ctl: adj, ctlUp: `${label(m).toUpperCase()} · ${adj.toUpperCase()}`, unit, valText: fmt(adj, val), valNow: String(val), vmin: lo, vmax: hi,
      fillL: fillL.toFixed(1), fillW: Math.max(0, fillW).toFixed(1), numX: Math.max(34, Math.min(338, numX)).toFixed(1),
      spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, v: val, s: S.spin, a: adj }; set({ turning: true }); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => { const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI); const cur = this.state.masks[this.state.sel];
        if (real) { this.setState({ spin: d.s + deg }); return setVal(d.a, d.v + deg * perDeg); }
        this.setState({ spin: d.s + deg, masks: this.state.masks.map((x, i) => (i === this.state.sel ? { ...x, vals: { ...cur.vals, [d.a]: Math.max(lo, Math.min(hi, d.v + deg * perDeg)) } } : x)) }); },
      dUp: () => { this.drag = null; set({ turning: false }); },
      dKey: (e) => { const st = adj === 'Exposure' ? 0.05 : 1; if (e.key === 'ArrowRight') setVal(adj, val + st); if (e.key === 'ArrowLeft') setVal(adj, val - st); },
      group: S.group, chips,
      groups: groups.map((g) => ({ label: g.toUpperCase(), current: String(g === S.group), ink: g === S.group ? '#f2efe8' : '#7d8187', dot: g === S.group ? '#e8202a' : 'transparent',
        pick: () => set({ group: g, adj: rows[g].find((a) => !(a in toggles) && a !== 'Delete') || 'Amount' }) })),
      actions: [{ name: 'OVERLAY', dot: S.overlay, pick: () => set({ overlay: !S.overlay }), pressed: String(S.overlay) }, { name: 'RESET MASK', dot: false, pick: () => (real ? has && mk.reset(sel) : setMask({ vals: {}, dots: [], invert: false })), pressed: 'false' }],
    };
  }
  /** A finger on the photo, with a photo open: a range mask picks what is under it; a gradient is taken hold of — a
   * linear one by an end (near either line) or whole, a radial one by its middle (to move) or its rim (to size, along
   * one axis when held near that axis's end). */
  down(e, m, sel, has, brush) {
    const eng = photo.eng; if (!has || !eng) return;
    const b = e.currentTarget.getBoundingClientRect(), u = (e.clientX - b.left) / b.width, v = (e.clientY - b.top) / b.height;
    if (mk.RANGE.includes(m.kind)) return mk.pick(sel, u, v);
    if (!m.a && m.kind !== 'Brush') return;
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const q = eng.maskPoint(u, v), a = m.a; let hold;
    if (m.kind === 'Brush') {   // the brush's size on the photo, in mask units where the finger is
      const e2 = eng.maskPoint(u + brush.size / 2, v), tip = { r: Math.hypot(e2[0] - q[0], e2[1] - q[1]), feather: brush.feather, flow: brush.flow, erase: brush.erase };
      this.grab = { kind: 'Brush', tip }; return mk.dab(sel, q, tip, true);
    }
    if (m.kind === 'Linear') { const dx = a[2] - a[0], dy = a[3] - a[1], t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / Math.max(1e-9, dx * dx + dy * dy); hold = t < 0.25 ? 'a' : t > 0.75 ? 'b' : 'both'; }
    else { const x = (q[0] - a[0]) / a[2], y = (q[1] - a[1]) / a[3]; hold = Math.hypot(x, y) < 0.7 ? 'move' : Math.abs(x) > 2.4 * Math.abs(y) ? 'x' : Math.abs(y) > 2.4 * Math.abs(x) ? 'y' : 'xy'; }
    this.grab = { hold, q, a: [...a], kind: m.kind };
  }
  move(e, sel) {
    const g = this.grab, eng = photo.eng; if (!g || !eng) return;
    const b = e.currentTarget.getBoundingClientRect(), q = eng.maskPoint((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
    if (g.kind === 'Brush') return mk.dab(sel, q, g.tip, false);
    const dx = q[0] - g.q[0], dy = q[1] - g.q[1], a = [...g.a];
    if (g.kind === 'Linear') { if (g.hold !== 'b') { a[0] += dx; a[1] += dy; } if (g.hold !== 'a') { a[2] += dx; a[3] += dy; } }
    else if (g.hold === 'move') { a[0] += dx; a[1] += dy; }
    else { const r = (p) => Math.hypot((p[0] - a[0]) / a[2], (p[1] - a[1]) / a[3]), k = Math.max(0.05, r(q) / Math.max(0.05, r(g.q))); if (g.hold !== 'y') a[2] = Math.max(0.01, a[2] * k); if (g.hold !== 'x') a[3] = Math.max(0.01, a[3] * k); }
    mk.lay(sel, a);
  }
  paint(e, size) {
    const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const S = this.state, m = S.masks[S.sel];
    const dots = m.erase ? m.dots.filter((d) => Math.hypot(d[0] - x, d[1] - y) > size / 2) : m.dots.concat([[x, y, size]]).slice(-400);
    this.setState({ masks: S.masks.map((q, i) => (i === S.sel ? { ...q, dots } : q)) });
  }
}
