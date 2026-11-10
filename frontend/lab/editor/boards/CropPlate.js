// @ts-nocheck
// The CropPlate board, as designed (docs/design/editor/boards/CropPlate.dc.html.dc.html). With a photo open it is
// real: the photo shows uncropped under the frame, turned and tilted by the same transform the design uses,
// and what the board sets is the photo's crop (engine/crop.js), which the engine draws from the same numbers.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import { frame } from '../../engine/crop.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { group: 'Straighten', ctl: 'Angle', aspect: 'Original', portrait: false, quarter: 0, flipH: false, flipV: false,
      vals: { Angle: 0, Vertical: 0, Horizontal: 0, Scale: 0 }, spin: 0, turning: false, crop: null };
    this.drag = null; this.corner = null;
    const g = photo.current() && photo.geo();   // the photo's crop as saved: the board starts from it
    if (g) Object.assign(this.state, { quarter: g.quarter, flipH: g.flipH, flipV: g.flipV, aspect: g.aspect || 'Free', portrait: !!g.portrait, vals: { Angle: g.angle, Vertical: g.vertical, Horizontal: g.horizontal, Scale: g.scale } });
    this.rect0 = g ? g.rect : null;
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => { if ('crop' in o) this.rect0 = null; this.setState(o); };
    const real = photo.current(), [pw, ph] = real ? photo.uncropped() : [1600, 1067], q = 412 / (document.getElementById('frame')?.getBoundingClientRect().width || 412);
    // the image box: the photo fitted into the stage, turned by quarter turns
    const odd = S.quarter % 2 === 1, natW = odd ? ph : pw, natH = odd ? pw : ph;
    const k = Math.min(372 / natW, 500 / natH), boxW = natW * k, boxH = natH * k;
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
    const corners = [['top left', 0, 0], ['top right', 1, 0], ['bottom left', 0, 1], ['bottom right', 1, 1]];
    const handles = corners.map(([name, fx, fy]) => ({
      name, l: fx ? '100%' : '0', t: fy ? '100%' : '0', il: fx ? 22 - 18 + 2 : 22 - 2, it: fy ? 22 - 18 + 2 : 22 - 2,
      bw: `${fy ? 0 : 3}px ${fx ? 3 : 0}px ${fy ? 3 : 0}px ${fx ? 0 : 3}px`,
      down: (e) => { this.corner = { fx, fy, x: e.clientX, y: e.clientY, c: { ...crop } }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      move: (e) => {
        const d = this.corner; if (!d) return;
        const c = d.c, dx = (e.clientX - d.x) * q, dy = (e.clientY - d.y) * q;
        let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
        if (fx) x1 = Math.min(boxW, Math.max(x0 + 60, x1 + dx)); else x0 = Math.max(0, Math.min(x1 - 60, x0 + dx));
        if (ratio) { const h = (x1 - x0) / ratio; if (fy) y1 = y0 + h; else y0 = y1 - h; if (y0 < 0 || y1 > boxH) return; }
        else if (fy) y1 = Math.min(boxH, Math.max(y0 + 60, y1 + dy)); else y0 = Math.max(0, Math.min(y1 - 60, y0 + dy));
        set({ crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      },
      up: () => { this.corner = null; },
    }));
    // the dial drives whichever control is active
    const ranges = { Angle: [45, '°', 0.25], Vertical: [100, '', 100 / 180], Horizontal: [100, '', 100 / 180], Scale: [100, '', 100 / 180] };
    const [range, unit, perDeg] = ranges[S.ctl];
    const val = v[S.ctl], f = val / range, half = 164;
    const fmt = (x, c) => (x > 0.04 ? '+' : x < -0.04 ? '−' : '') + (c === 'Angle' ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x)));
    const R = 240, PERIOD = 360 / 72;
    const frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    // Auto: the sample's is a set angle; a photo's is read from its lines (engine/level.js), against the turns and flips shown
    const auto = () => (real ? photo.level().then((t) => this.setState({ ctl: 'Angle', vals: { ...this.state.vals, Angle: Math.max(-45, Math.min(45, +((S.flipH !== S.flipV ? t : -t)).toFixed(1))) } })) : set({ ctl: 'Angle', vals: { ...v, Angle: -1.8 } }));
    const setVal = (c, x) => set({ vals: { ...this.state.vals, [c]: Math.max(-ranges[c][0], Math.min(ranges[c][0], x)) } });
    // rows: what each section offers
    const rows = {
      Straighten: [{ name: 'Auto', pick: () => auto() }, { name: 'Angle', value: fmt(v.Angle, 'Angle') + '°', on: S.ctl === 'Angle', pick: () => set({ ctl: 'Angle' }) }],
      Aspect: Object.keys(ratios).map((r) => ({ name: r, on: S.aspect === r, pick: () => set({ aspect: r, crop: null }) }))
        .concat([{ name: '⇄', aria: 'Swap orientation', on: S.portrait, size: 14, pick: () => set({ portrait: !S.portrait, crop: null }) }]),
      Rotate: [{ name: '⟲ 90°', pick: () => set({ quarter: (S.quarter + 3) % 4, crop: null }) }, { name: '⟳ 90°', pick: () => set({ quarter: (S.quarter + 1) % 4, crop: null }) },
        { name: 'Flip ↔', on: S.flipH, pick: () => set({ flipH: !S.flipH }) }, { name: 'Flip ↕', on: S.flipV, pick: () => set({ flipV: !S.flipV }) }],
      Geometry: [real ? { name: 'Upright', value: 'LATER', pick: () => {} } : { name: 'Upright', pick: () => set({ ctl: 'Vertical', vals: { ...v, Vertical: 22, Angle: -1.8 } }) }]
        .concat(['Vertical', 'Horizontal', 'Scale'].map((c) => ({ name: c, value: fmt(v[c], c), on: S.ctl === c, pick: () => set({ ctl: c }) }))),
    };
    const groups = Object.keys(rows);
    const gi = groups.indexOf(S.group), secX = 14 + (384 / 4) * (gi + 0.5);
    let cx = 14;
    const chips = rows[S.group].map((o, i) => {
      const w = 16 + Math.max(o.name.length, String(o.value ?? '').length * 0.8) * 7.6, c = cx + w / 2; cx += w + 4;
      return { name: o.name.toUpperCase(), value: o.value ?? '', on: String(!!o.on), aria: o.aria ?? o.name, pad: 8, size: o.size ?? 10,
        ink: o.on ? '#f2efe8' : '#80848a', valueInk: o.on ? '#e8202a' : '#6a6e73', bar: o.on ? '#e8202a' : 'transparent',
        dx: (secX - c).toFixed(0), delay: i * 32, anim: 'fly' + gi, pick: o.pick };
    });
    const fullW = odd ? 5152 : 7728, fullH = odd ? 7728 : 5152;          // the sample: the X-E5's 40 MP frame
    const outW = laid ? laid.ow : Math.round((crop.w / boxW) * fullW), outH = laid ? laid.oh : Math.round((crop.h / boxH) * fullH);
    return {
      real: !!real, demo: !real, fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      boxL: (412 - boxW) / 2, boxT: (540 - boxH) / 2, boxW, boxH, imgW, imgH, imgML: -imgW / 2, imgMT: -imgH / 2, imgTf: tf,
      imgTr: S.turning ? '60ms linear' : '380ms cubic-bezier(0.2, 0.85, 0.2, 1)', cropTr: this.corner ? 'none' : 'all 320ms cubic-bezier(0.2, 0.85, 0.2, 1)',
      cx: crop.x, cy: crop.y, cw: crop.w, ch: crop.h, grid, handles, dims: `${outW} × ${outH} · ${((outW * outH) / 1e6).toFixed(1)} MP`,
      ctl: S.ctl === 'Angle' ? 'Straighten' : S.ctl, ctlUp: (S.ctl === 'Angle' ? 'Straighten' : S.ctl).toUpperCase(), unit,
      valText: fmt(val, S.ctl) + unit, valNow: val.toFixed(1), vmin: -range, vmax: range,
      fillL: (186 + Math.min(0, f) * half).toFixed(1), fillW: (Math.abs(f) * half).toFixed(1), numX: Math.max(34, Math.min(338, 186 + f * half)).toFixed(1),
      spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, v: val, s: S.spin }; set({ turning: true }); if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => { const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / R) * (180 / Math.PI); this.setState({ spin: d.s + deg, vals: { ...this.state.vals, [S.ctl]: Math.max(-range, Math.min(range, d.v + deg * perDeg)) } }); },
      dUp: () => { this.drag = null; setTimeout(() => this.setState({ turning: false }), 250); },
      dKey: (e) => { const st = S.ctl === 'Angle' ? 0.1 : 1; if (e.key === 'ArrowRight') setVal(S.ctl, val + st); if (e.key === 'ArrowLeft') setVal(S.ctl, val - st); },
      group: S.group, chips,
      groups: groups.map((g) => ({ label: g.toUpperCase(), current: String(g === S.group), ink: g === S.group ? '#f2efe8' : '#7d8187', dot: g === S.group ? '#e8202a' : 'transparent',
        pick: () => set({ group: g, ctl: g === 'Geometry' ? 'Vertical' : 'Angle' }) })),
      auto,
      reset: () => set({ vals: { Angle: 0, Vertical: 0, Horizontal: 0, Scale: 0 }, aspect: 'Original', portrait: false, quarter: 0, flipH: false, flipV: false, crop: null, ctl: 'Angle' }),
    };
  }
}
