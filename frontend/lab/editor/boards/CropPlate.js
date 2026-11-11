// @ts-nocheck
// The Crop board. With a photo open it is real: the photo shows uncropped under the frame, turned and tilted, and
// what the board sets is the photo's crop (engine/crop.js), which the engine draws from the same numbers. The
// drum has four faces (Straighten, Aspect, Rotate, Geometry); the dial turns the angle or a perspective setting.
// The frame always fills the stage and the photo sits under it: a finger inside the frame moves the photo, two
// fingers zoom it, and the frame's corners and sides pull it to another shape, after which the view settles so
// the frame fills the stage again. The stage is whatever room the screen leaves above the panel.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import { frame } from '../../engine/crop.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { group: 'Straighten', ctl: 'Angle', aspect: 'Original', portrait: false, quarter: 0, flipH: false, flipV: false,
      vals: { Angle: 0, Vertical: 0, Horizontal: 0, Scale: 0 }, turning: false, crop: null };
    this.corner = null; this.pts = new Map(); this.g = null;
    const g = photo.current() && photo.geo();   // the photo's crop as saved: the board starts from it
    if (g) Object.assign(this.state, { quarter: g.quarter, flipH: g.flipH, flipV: g.flipV, aspect: g.aspect || 'Free', portrait: !!g.portrait, vals: { Angle: g.angle, Vertical: g.vertical, Horizontal: g.horizontal, Scale: g.scale } });
    this.rect0 = g ? g.rect : null;
    this.keep('Crop', ['group', 'ctl']);
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => { if ('crop' in o) this.rect0 = null; this.setState(o); };
    const real = photo.current(), [pw, ph] = real ? photo.uncropped() : [1600, 1067], q = 412 / (document.getElementById('frame')?.getBoundingClientRect().width || 412);
    // the image box: the photo fitted into the stage, turned by quarter turns
    const odd = S.quarter % 2 === 1, natW = odd ? ph : pw, natH = odd ? pw : ph;
    const room = 649 - (parseFloat(getComputedStyle(document.getElementById('frame') || document.body).getPropertyValue('--cut')) || 0), stageH = room - 36;   // what the screen leaves above the panel
    const k = Math.min(372 / natW, stageH / natH), boxW = natW * k, boxH = natH * k, boxL = (412 - boxW) / 2, boxT = (room - boxH) / 2;
    const ratios = { Original: pw / ph, Free: null, '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '16:9': 16 / 9, '65:24': 65 / 24 };
    let ratio = ratios[S.aspect];
    if (S.aspect === 'Original' && odd) ratio = ph / pw;
    if (ratio && S.portrait && ratio !== 1 && S.aspect !== 'Original') ratio = 1 / ratio;   // the swap key turns 3:2 into 2:3
    const fit = (r) => { let w = boxW, h = w / r; if (h > boxH) { h = boxH; w = h * r; } return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }; };
    const r0 = this.rect0, crop = S.crop || (r0 ? { x: r0.x * boxW, y: r0.y * boxH, w: r0.w * boxW, h: r0.h * boxH } : ratio ? fit(ratio) : { x: 0, y: 0, w: boxW, h: boxH });
    const v = S.vals, a = (v.Angle * Math.PI) / 180;
    // a photo's crop, in shares of the box (none when the frame is all of it), and how the engine lays it out
    const near = (x, y) => Math.abs(x - y) < 1e-4, rect = { x: crop.x / boxW, y: crop.y / boxH, w: crop.w / boxW, h: crop.h / boxH };
    const geo = { quarter: S.quarter, flipH: S.flipH, flipV: S.flipV, angle: v.Angle, vertical: v.Vertical, horizontal: v.Horizontal, scale: v.Scale,
      rect: near(rect.x, 0) && near(rect.y, 0) && near(rect.w, 1) && near(rect.h, 1) ? null : rect, aspect: S.aspect, portrait: S.portrait };
    const laid = real ? frame(geo, pw, ph) : null, sent = JSON.stringify(geo);
    if (real && this.sent === undefined) this.sent = sent;   // as opened: nothing to save yet
    if (real && this.sent !== sent) { this.sent = sent; queueMicrotask(() => photo.setGeo(geo)); }
    // scale the turned photo up just enough to keep the crop covered
    const cover = laid ? laid.cover : Math.max(1, (crop.w * Math.cos(Math.abs(a)) + crop.h * Math.sin(Math.abs(a))) / boxW, (crop.w * Math.sin(Math.abs(a)) + crop.h * Math.cos(Math.abs(a))) / boxH);
    const imgW = odd ? boxH : boxW, imgH = odd ? boxW : boxH;
    const tf = `rotateX(${(v.Vertical * 0.18).toFixed(2)}deg) rotateY(${(-v.Horizontal * 0.18).toFixed(2)}deg) rotate(${S.quarter * 90 + v.Angle}deg) scale(${((S.flipH ? -1 : 1) * cover * (1 + v.Scale / 200)).toFixed(4)}, ${((S.flipV ? -1 : 1) * cover * (1 + v.Scale / 200)).toFixed(4)})`;
    // grid: thirds at rest, a fine level grid while the dial turns
    const n = S.turning ? 8 : 3, grid = [];
    for (let i = 1; i < n; i++) {
      const p = `${((i / n) * 100).toFixed(2)}%`, al = S.turning ? (i % 2 ? 0.16 : 0.3) : 0.35;
      grid.push({ l: p, t: '0', w: '1px', h: '100%', a: al }, { l: '0', t: p, w: '100%', h: '1px', a: al });
    }
    // the view: the frame fitted into the stage, the photo's box scaled and shifted under it (held still while a corner or side is pulled)
    const fitted = (c) => { const sc = Math.min(372 / c.w, stageH / c.h); return { s: sc, tx: 206 - boxL - sc * (c.x + c.w / 2), ty: room / 2 - boxT - sc * (c.y + c.h / 2) }; };
    const view = this.corner?.view || fitted(crop), clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x)), LEAST = 0.1 * Math.min(boxW, boxH);
    const spots = [['top left corner', 0, 0], ['top right corner', 1, 0], ['bottom left corner', 0, 1], ['bottom right corner', 1, 1], ['top side', 0.5, 0], ['bottom side', 0.5, 1], ['left side', 0, 0.5], ['right side', 1, 0.5]];
    const handles = spots.map(([name, fx, fy]) => ({
      name, l: `${fx * 100}%`, t: `${fy * 100}%`, corner: fx !== 0.5 && fy !== 0.5, cursor: fx === 0.5 ? 'ns-resize' : fy === 0.5 ? 'ew-resize' : 'nwse-resize',
      il: fx ? 22 - 18 + 2 : 22 - 2, it: fy ? 22 - 18 + 2 : 22 - 2, bw: `${fy ? 0 : 3}px ${fx ? 3 : 0}px ${fy ? 3 : 0}px ${fx ? 0 : 3}px`,
      bl: fx === 0.5 ? 10 : fx ? 19 : 22, bt: fy === 0.5 ? 10 : fy ? 19 : 22, bwid: fx === 0.5 ? 24 : 3, bhgt: fy === 0.5 ? 24 : 3, bar: fx === 0.5 || fy === 0.5 ? 0.95 : 0,   // a side's mark: a short bar on the line
      down: (e) => { e.stopPropagation(); this.corner = { x: e.clientX, y: e.clientY, c: { ...crop }, view }; this.setState({}); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      move: (e) => {
        const d = this.corner; if (!d) return;
        const c = d.c, dx = ((e.clientX - d.x) * q) / d.view.s, dy = ((e.clientY - d.y) * q) / d.view.s;
        let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
        if (fx === 1) x1 = clamp(x1 + dx, x0 + LEAST, boxW); else if (fx === 0) x0 = clamp(x0 + dx, 0, x1 - LEAST);
        if (fy === 1) y1 = clamp(y1 + dy, y0 + LEAST, boxH); else if (fy === 0) y0 = clamp(y0 + dy, 0, y1 - LEAST);
        if (ratio) {   // a set shape: the pulled side leads and the other dimension follows (about the middle, for a side)
          if (fx !== 0.5) { const h = (x1 - x0) / ratio, m = c.y + c.h / 2; if (fy === 1) y1 = c.y + h; else if (fy === 0) y0 = c.y + c.h - h; else { y0 = m - h / 2; y1 = m + h / 2; } }
          else { const w = (y1 - y0) * ratio, m = c.x + c.w / 2; x0 = m - w / 2; x1 = m + w / 2; }
          if (x0 < -0.01 || y0 < -0.01 || x1 > boxW + 0.01 || y1 > boxH + 0.01) return;
        }
        set({ crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      },
      up: () => { this.corner = null; this.setState({}); },
    }));
    // a finger inside the frame moves the photo under it; two zoom it (the frame keeps its shape, and stays inside the photo)
    const begin = () => { const p = [...this.pts.values()], mx = p.reduce((a, b) => a + b[0], 0) / p.length, my = p.reduce((a, b) => a + b[1], 0) / p.length; return { c: { ...crop }, mx, my, d: p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0, s: view.s }; };
    const stage = {
      down: (e) => { if (e.target.closest('[role=button]') || this.pts.size > 1) return; this.pts.set(e.pointerId, [e.clientX, e.clientY]); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); this.g = begin(); this.setState({}); },
      move: (e) => {
        if (!this.pts.has(e.pointerId) || !this.g) return;
        this.pts.set(e.pointerId, [e.clientX, e.clientY]);
        const g = this.g, now = begin(), shape = g.c.w / g.c.h, f = g.d && now.d ? now.d / g.d : 1;
        const w = clamp(g.c.w / f, LEAST, Math.min(boxW, boxH * shape)), h = w / shape;
        const mx = g.c.x + g.c.w / 2 - ((now.mx - g.mx) * q) / g.s, my = g.c.y + g.c.h / 2 - ((now.my - g.my) * q) / g.s;
        set({ crop: { x: clamp(mx - w / 2, 0, boxW - w), y: clamp(my - h / 2, 0, boxH - h), w, h } });
      },
      up: (e) => { if (!this.pts.delete(e.pointerId)) return; this.g = this.pts.size ? begin() : null; this.setState({}); },
    };
    const held = !!this.g || !!this.corner;
    // the dial drives whichever control is active
    const ranges = { Angle: 45, Vertical: 100, Horizontal: 100, Scale: 100 }, range = ranges[S.ctl], val = v[S.ctl];
    const fmt = (x, c) => (x > 0.04 ? '+' : x < -0.04 ? '−' : '') + (c === 'Angle' ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x)));
    // Auto: the sample's is a set angle; a photo's is read from its lines (engine/level.js), against the turns and flips shown
    const auto = () => (real ? photo.level().then((t) => this.setState({ ctl: 'Angle', vals: { ...this.state.vals, Angle: Math.max(-45, Math.min(45, +((S.flipH !== S.flipV ? t : -t)).toFixed(1))) } })) : set({ ctl: 'Angle', vals: { ...v, Angle: -1.8 } }));
    const setVal = (c, x) => set({ vals: { ...this.state.vals, [c]: Math.max(-ranges[c], Math.min(ranges[c], x)) } });
    const reset = () => set({ vals: { Angle: 0, Vertical: 0, Horizontal: 0, Scale: 0 }, aspect: 'Original', portrait: false, quarter: 0, flipH: false, flipV: false, crop: null, ctl: 'Angle' });
    // rows: what each section offers
    const rows = {
      Straighten: [{ name: 'Angle', value: fmt(v.Angle, 'Angle') + '°', on: S.ctl === 'Angle', pick: () => set({ ctl: 'Angle' }) }],
      Aspect: Object.keys(ratios).map((r) => ({ name: r, on: S.aspect === r, pick: () => set({ aspect: r, crop: null }) }))
        .concat([{ name: '⇄', aria: 'Swap orientation', on: S.portrait, pick: () => set({ portrait: !S.portrait, crop: null }) }]),
      Rotate: [{ name: '⟲ 90°', pick: () => set({ quarter: (S.quarter + 3) % 4, crop: null }) }, { name: '⟳ 90°', pick: () => set({ quarter: (S.quarter + 1) % 4, crop: null }) },
        { name: 'Flip ↔', on: S.flipH, pick: () => set({ flipH: !S.flipH }) }, { name: 'Flip ↕', on: S.flipV, pick: () => set({ flipV: !S.flipV }) }],
      Geometry: [real ? { name: 'Upright', value: 'LATER', pick: () => {} } : { name: 'Upright', pick: () => set({ ctl: 'Vertical', vals: { ...v, Vertical: 22, Angle: -1.8 } }) }]
        .concat(['Vertical', 'Horizontal', 'Scale'].map((c) => ({ name: c, value: fmt(v[c], c), on: S.ctl === c, pick: () => set({ ctl: c }) }))),
    };
    const groups = Object.keys(rows), gi = groups.indexOf(S.group);
    const chips = rows[S.group].concat([{ name: 'Reset', entry: true, aria: 'Reset the crop', pick: reset }]);
    const fullW = odd ? 5152 : 7728, fullH = odd ? 7728 : 5152;          // the sample: the X-E5's 40 MP frame
    const outW = laid ? laid.ow : Math.round((crop.w / boxW) * fullW), outH = laid ? laid.oh : Math.round((crop.h / boxH) * fullH);
    return {
      real: !!real, demo: !real, fileName: real ? photo.stem(real.name) : 'DSCF0412', shotLine: real ? photo.kindLine() : '23 mm · f/5.6 · 1/250 · ISO 160',
      boxL, boxT, boxW, boxH, viewTf: `translate(${view.tx.toFixed(2)}px, ${view.ty.toFixed(2)}px) scale(${view.s.toFixed(4)})`, viewTr: held ? 'none' : '320ms cubic-bezier(0.2, 0.85, 0.2, 1)',
      sDown: stage.down, sMove: stage.move, sUp: stage.up, imgW, imgH, imgML: -imgW / 2, imgMT: -imgH / 2, imgTf: tf,
      imgTr: S.turning ? '60ms linear' : '380ms cubic-bezier(0.2, 0.85, 0.2, 1)', cropTr: held ? 'none' : 'all 320ms cubic-bezier(0.2, 0.85, 0.2, 1)',
      cx: boxL + view.tx + view.s * crop.x, cy: boxT + view.ty + view.s * crop.y, cw: view.s * crop.w, ch: view.s * crop.h, grid, handles, dims: `${outW} × ${outH} · ${((outW * outH) / 1e6).toFixed(1)} MP`,
      dialLabel: S.ctl === 'Angle' ? 'Straighten' : S.ctl, dialValue: (val / range) * 5, dialText: fmt(val, S.ctl) + (S.ctl === 'Angle' ? '°' : ''),
      dialTurn: (d) => setVal(S.ctl, (d / 5) * range), dialReset: () => setVal(S.ctl, 0), dialHold: (on) => set({ turning: on }),
      auto: S.ctl === 'Angle' ? 'AUTO' : '', pressAuto: auto,
      faces: groups.map((g) => ({ label: g, count: 0 })), faceAt: gi, pickFace: (i) => set({ group: groups[i], ctl: groups[i] === 'Geometry' ? 'Vertical' : 'Angle' }),
      chips, rowAria: `${S.group} options`,
    };
  }
}
