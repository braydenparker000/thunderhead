// @ts-nocheck
// The Masks board. With a photo open (app/session.js) the masks are the photo's own (app/masks.js,
// engine/local.js): linear and radial gradients laid on the picture with a finger, ranges of colour or brightness
// picked with a tap, and brush masks painted on it (Size, Feather and Flow are the brush's, Erase rubs out). The
// panel holds the masks in a row along its top, the dial that turns the chosen mask's own adjustments, and the drum
// with its row (Mask, Light, Color, Effects); the engine lays the mask over the picture in red. Without a photo it
// plays a sample. Not built yet, so not offered with a photo: detection (Subject, Sky …), and Noise for a mask.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as mk from '../app/masks.js';
import * as zoom from '../app/zoom.js';   // two fingers zoom and move the photo; one is the mask's

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      masks: [{ kind: 'Sky', n: 1, vals: { Exposure: -0.4, Highlights: -35, Dehaze: 12, Amount: 100 }, invert: false, erase: false, dots: [] },
        { kind: 'Subject', n: 1, vals: { Exposure: 0.25, Clarity: 10, Amount: 100 }, invert: false, erase: false, dots: [] }],
      sel: 0, group: 'Light', adj: 'Exposure', adding: false, detecting: null, overlay: true, turning: false,
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
      Effects: real ? ['Texture', 'Clarity', 'Dehaze', 'Sharpness'] : ['Texture', 'Clarity', 'Dehaze', 'Sharpness', 'Noise'],
      Mask: (m.kind === 'Brush' ? ['Size', 'Feather', 'Flow', 'Erase'] : ['Linear', 'Radial'].includes(m.kind) ? ['Feather'] : real ? ['Range', 'Feather'] : []).concat(['Amount', 'Invert', 'Reset', 'Delete']),
    };
    const toggles = { Erase: real ? !!S.erase : m.erase, Invert: m.invert };
    const tool = real && m.kind === 'Brush' ? ['Size', 'Feather', 'Flow'] : [];   // the brush's own settings: the board's, not the edit's
    const uni = { Size: 40, Feather: 50, Flow: 60, Amount: 100, ...(real ? mk.UNI : {}) };      // 0..100 settings and their defaults
    const valOf = (a) => (tool.includes(a) ? S.brush?.[a] : m.vals[a]) ?? uni[a] ?? 0;
    const spec = (a) => a === 'Exposure' ? [-4, 4, 'EV'] : uni[a] !== undefined ? [0, 100, ''] : [-100, 100, ''];
    const fmt = (a, x) => a === 'Exposure' ? (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + Math.abs(x).toFixed(2) : uni[a] !== undefined ? String(Math.round(x)) : (x > 0.5 ? '+' : x < -0.5 ? '−' : '') + Math.abs(Math.round(x));
    const keys = ['Reset', 'Delete'], turns = (a) => !(a in toggles) && !keys.includes(a);   // what the dial can turn
    const adj = rows[S.group].includes(S.adj) && turns(S.adj) ? S.adj : rows[S.group].find(turns) || 'Amount';
    const [lo, , unit] = spec(adj), val = valOf(adj);
    const setMask = (patch) => set({ masks: masks.map((x, i) => (i === S.sel ? { ...x, ...patch } : x)) });
    const setVal = (a, x) => { const v = Math.max(spec(a)[0], Math.min(spec(a)[1], x)), r = a === 'Exposure' ? Math.round(v * 100) / 100 : Math.round(v); if (tool.includes(a)) set({ brush: { ...S.brush, [a]: r } }); else if (real) { if (has) mk.setVal(sel, a, r, fmt(a, r)); } else setMask({ vals: { ...m.vals, [a]: v } }); };
    // the dial's window runs −5..5: exposure in stops, the others −100..100, the 0..100 settings from its left end
    const toDial = adj === 'Exposure' ? val : lo < 0 ? val / 20 : val / 10 - 5, fromDial = (d) => (adj === 'Exposure' ? d : lo < 0 ? d * 20 : (d + 5) * 10);
    const groups = ['Mask', 'Light', 'Color', 'Effects'], gi = groups.indexOf(S.group);
    const resetMask = () => (real ? has && mk.reset(sel) : setMask({ vals: {}, dots: [], invert: false }));
    const chips = rows[S.group].map((a) => {
      const isT = a in toggles, key = keys.includes(a), on = isT ? toggles[a] : !key && a === adj;
      return { name: a, value: isT ? (toggles[a] ? 'ON' : 'OFF') : key ? '' : fmt(a, valOf(a)), on, entry: key, hot: a === 'Delete', aria: a === 'Reset' ? 'Reset mask' : a,
        pick: () => {
          if (a === 'Reset') return resetMask();
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
    // where the photo sits in its room, and the gradient's guides over it (a mask's place is in mask units: the engine turns them to and from the picture as shown)
    let box = [20, 182, 372, 248], lines = m.kind === 'Linear' ? [40, 74, 108].map((y, i) => ({ x: 186, y, w: 452, ml: -226, rot: -10, t: 1.5, style: i === 1 ? 'dashed' : 'solid' })) : [], rad = { l: '30%', t: '18%', w: '30%', h: '62%', rot: 0, b: 1.5 }, note = S.detecting ? `Detecting ${S.detecting.toLowerCase()}…` : '';
    if (real) {
      const [w, h] = photo.shape(), room = 613 - (parseFloat(getComputedStyle(document.getElementById('frame') || document.body).getPropertyValue('--cut')) || 0), k = Math.min(412 / w, room / h);
      box = [(412 - w * k) / 2, (room - h * k) / 2, w * k, h * k];
      const px = (x, y) => { const [u, v] = eng ? eng.shownPoint(x, y) : [0, 0]; return [u * box[2], v * box[3]]; }, a = has && eng ? m.a : null, t = 1.5 / zoom.mag();   // lines keep their weight on screen
      lines = []; rad.b = t;
      if (a && m.kind === 'Linear') { const A = px(a[0], a[1]), B = px(a[2], a[3]), rot = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI + 90, wide = 2 * Math.hypot(box[2], box[3]);
        lines = [[A, 'solid'], [[(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], 'dashed'], [B, 'solid']].map(([q, style]) => ({ x: q[0], y: q[1], w: wide, ml: -wide / 2, rot, t, style })); }
      if (a && m.kind === 'Radial') { const C = px(a[0], a[1]), X = px(a[0] + a[2], a[1]), Y = px(a[0], a[1] + a[3]), rx = Math.hypot(X[0] - C[0], X[1] - C[1]), ry = Math.hypot(Y[0] - C[0], Y[1] - C[1]);
        rad = { l: `${C[0] - rx}px`, t: `${C[1] - ry}px`, w: `${2 * rx}px`, h: `${2 * ry}px`, rot: (Math.atan2(X[1] - C[1], X[0] - C[0]) * 180) / Math.PI, b: t }; }
      note = !has ? 'Add a mask to change part of the photo' : S.adding && masks.length >= 8 ? 'A photo can have eight masks' : m.kind === 'Brush' && !m.strokes?.length ? 'Paint on the photo' : mk.RANGE.includes(m.kind) && !m.pick ? `Tap the photo to pick a ${m.kind === 'Color' ? 'colour' : 'brightness'}` : '';
    }
    return {
      real: !!real, demo: !real, pL: box[0], pT: box[1], pW: box[2], pH: box[3], zoomT: real ? zoom.transform() : 'none', rad, hasNote: !!note, note, noteT: Math.max(60, box[1] + box[3] - 46),
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      overlay: real ? 'none' : shape[m.invert ? 1 : 0], lumMask: isRange && !real ? 'url(/lab/editor/assets/sample.jpg)' : 'none',
      overlayO: real ? 0 : S.overlay && !S.detecting ? (valOf('Amount') / 100) * 0.9 + 0.1 : 0,
      dots: m.kind === 'Brush' && !real ? m.dots.map((d) => ({ x: d[0], y: d[1], s: d[2], m: -d[2] / 2 })) : [],
      guides: ['Linear', 'Radial'].includes(m.kind) && S.overlay && (!real || (has && !!m.a)), isRadial: m.kind === 'Radial',
      guideLines: lines,
      detecting: !!S.detecting, detectName: (S.detecting || '').toLowerCase(),
      photoAria: m.kind === 'Brush' ? `Paint the brush mask, ${(real ? S.erase : m.erase) ? 'erasing' : 'adding'}` : 'Photo',
      photoTouch: m.kind === 'Brush' || real ? 'none' : 'auto', photoCursor: m.kind === 'Brush' || (real && mk.RANGE.includes(m.kind)) ? 'crosshair' : 'default',
      pDown: (e) => { if (real) return this.down(e, m, sel, has, { size: brushS / box[2] / zoom.mag(), feather: valOf('Feather') / 100, flow: valOf('Flow') / 100, erase: !!S.erase }); if (m.kind !== 'Brush') return; this.painting = true; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); this.paint(e, brushS); },
      pMove: (e) => { if (real) return this.move(e, sel); if (this.painting) this.paint(e, brushS); },
      pUp: (e) => { this.painting = false; if (real && e?.type === 'pointerup') this.up(sel); this.grab = null; },
      list: masks.map((x, i) => ({ name: label(x), on: String(i === sel), weight: i === sel ? 600 : 500, bg: i === sel ? 'rgba(255,255,255,0.13)' : 'transparent', ink: i === sel ? '#f2efe8' : '#a6aab0',
        ring: i === sel ? 'inset 0 0 0 1px rgba(255,255,255,0.22)' : 'inset 0 0 0 1px rgba(255,255,255,0.07)',
        thumb: shapes[x.kind][2], count: edits(x) ? String(edits(x)) : '', countInk: i === sel ? '#e8202a' : '#a6b0bc',
        pick: () => set({ sel: i, adding: false, group: S.group === 'Mask' && x.kind !== m.kind ? 'Light' : S.group }) })),
      adding: S.adding, openAdd: () => set({ adding: !S.adding }),
      addGroups: groupsAdd.map(([title, kinds]) => ({ title, items: kinds.map((k) => ({ name: k, thumb: shapes[k][2], pick: () => add(k) })) })),
      dialLabel: `${label(m)} · ${adj}`, unit, dialValue: toDial, dialText: fmt(adj, val), dialLeft: lo === 0,
      dialTurn: (d) => setVal(adj, fromDial(d)), dialReset: () => setVal(adj, uni[adj] ?? 0), dialHold: (on) => set({ turning: on }),
      faces: groups.map((g) => ({ label: g, count: g === 'Mask' ? 0 : rows[g].filter((a) => Math.abs(m.vals[a] || 0) > 0.004).length })), faceAt: gi,
      pickFace: (i) => set({ group: groups[i], adj: rows[groups[i]].find(turns) || 'Amount' }),
      chips, rowAria: `${S.group} options`, rowSeed: gi + (S.group === 'Mask' ? masks.length : 0),
      overlayOn: String(S.overlay), overlayDot: S.overlay ? '#e8202a' : '#4f5357', overlayGlow: S.overlay ? '0 0 6px rgba(232,32,42,0.7)' : 'none', toggleOverlay: () => set({ overlay: !S.overlay }),
    };
  }
  /** A finger on the photo, with a photo open: a range mask picks what is under it; a gradient is taken hold of — a
   * linear one by an end (near either line) or whole, a radial one by its middle (to move) or its rim (to size, along
   * one axis when held near that axis's end). */
  down(e, m, sel, has, brush) {
    const eng = photo.eng; if (!has || !eng) return;
    const b = e.currentTarget.getBoundingClientRect(), u = (e.clientX - b.left) / b.width, v = (e.clientY - b.top) / b.height;
    this.grab = null;
    if (!m.a && m.kind !== 'Brush' && !mk.RANGE.includes(m.kind)) return;
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const q = eng.maskPoint(u, v), a = m.a; let hold;
    // a range's pick and a brush's first dab wait for the finger to move or lift: a second finger landing makes it a pinch (zoom.js), not a touch of the mask
    if (mk.RANGE.includes(m.kind)) { this.grab = { kind: 'Range', u, v, x: e.clientX, y: e.clientY }; return; }
    if (m.kind === 'Brush') {   // the brush's size on the photo, in mask units where the finger is
      const e2 = eng.maskPoint(u + brush.size / 2, v), tip = { r: Math.hypot(e2[0] - q[0], e2[1] - q[1]), feather: brush.feather, flow: brush.flow, erase: brush.erase };
      this.grab = { kind: 'Brush', tip, q, began: false }; return;
    }
    if (m.kind === 'Linear') { const dx = a[2] - a[0], dy = a[3] - a[1], t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / Math.max(1e-9, dx * dx + dy * dy); hold = t < 0.25 ? 'a' : t > 0.75 ? 'b' : 'both'; }
    else { const x = (q[0] - a[0]) / a[2], y = (q[1] - a[1]) / a[3]; hold = Math.hypot(x, y) < 0.7 ? 'move' : Math.abs(x) > 2.4 * Math.abs(y) ? 'x' : Math.abs(y) > 2.4 * Math.abs(x) ? 'y' : 'xy'; }
    this.grab = { hold, q, a: [...a], kind: m.kind };
  }
  move(e, sel) {
    const g = this.grab, eng = photo.eng; if (!g || !eng) return;
    if (zoom.pinching()) { this.grab = null; return; }
    if (g.kind === 'Range') { if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) this.grab = null; return; }
    const b = e.currentTarget.getBoundingClientRect(), q = eng.maskPoint((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
    if (g.kind === 'Brush') { if (!g.began) { g.began = true; mk.dab(sel, g.q, g.tip, true); } return mk.dab(sel, q, g.tip, false); }
    const dx = q[0] - g.q[0], dy = q[1] - g.q[1], a = [...g.a];
    if (g.kind === 'Linear') { if (g.hold !== 'b') { a[0] += dx; a[1] += dy; } if (g.hold !== 'a') { a[2] += dx; a[3] += dy; } }
    else if (g.hold === 'move') { a[0] += dx; a[1] += dy; }
    else { const r = (p) => Math.hypot((p[0] - a[0]) / a[2], (p[1] - a[1]) / a[3]), k = Math.max(0.05, r(q) / Math.max(0.05, r(g.q))); if (g.hold !== 'y') a[2] = Math.max(0.01, a[2] * k); if (g.hold !== 'x') a[3] = Math.max(0.01, a[3] * k); }
    mk.lay(sel, a);
  }
  /** The finger lifts without having moved: a range mask picks what was under it, the brush leaves one dab. */
  up(sel) {
    const g = this.grab; if (!g || zoom.pinching()) return;
    if (g.kind === 'Range') mk.pick(sel, g.u, g.v); else if (g.kind === 'Brush' && !g.began) mk.dab(sel, g.q, g.tip, true);
  }
  paint(e, size) {
    const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const S = this.state, m = S.masks[S.sel];
    const dots = m.erase ? m.dots.filter((d) => Math.hypot(d[0] - x, d[1] - y) > size / 2) : m.dots.concat([[x, y, size]]).slice(-400);
    this.setState({ masks: S.masks.map((q, i) => (i === S.sel ? { ...q, dots } : q)) });
  }
}
