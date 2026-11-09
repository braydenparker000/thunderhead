// @ts-nocheck
// The ExportPlate board, as designed (docs/design/editor/boards/ExportPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const base = { fmt: 'JPEG', space: 'sRGB', sharpen: 'Off', amt: 'Standard', mark: false, meta: 'All', gps: false, naming: 'Camera name' };
    this.state = { sel: 0, group: 'Size', ctl: 'long', presets: [{ ...base, name: 'Full', on: true, size: 'Full', long: 7728, q: 95 }, { ...base, name: 'Small', on: true, size: '2048', long: 2048, q: 85, sharpen: 'Screen', mark: true }],
      working: null, done: false, spin: 0 };
    this.drag = null;
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), P = S.presets, p = P[S.sel];
    const setP = (patch) => set({ presets: P.map((x, i) => (i === S.sel ? { ...x, ...patch } : x)), done: false });
    const sizeList = [['Full', 7728], ['4K', 3840], ['2048', 2048], ['1080', 1080]], sizes = Object.fromEntries(sizeList);
    const enums = { amt: ['Low', 'Standard', 'High'], meta: ['All', 'Copyright only', 'None'], naming: ['Camera name', 'Date + number', 'Shoot + number'] };
    const nums = { long: [512, 7728, 64, 'px'], q: [50, 100, 1, ''] };
    const short = (x) => Math.round(x.long / 1.5);
    const est = (x) => { const px = x.long * short(x); const bpp = x.fmt === 'PNG' ? 1.9 : x.fmt === 'TIFF 16' ? 6 : 0.1 + Math.pow((x.q - 50) / 50, 1.6) * 0.55; const mb = (px * bpp) / 1e6; return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`; };
    const fileName = (x) => { const stem = x.naming === 'Camera name' ? 'DSCF0412' : x.naming === 'Date + number' ? '2026-11-09_0412' : 'Oldtown_012'; return `${stem}${x.name === 'Small' ? '_small' : ''}.${x.fmt === 'JPEG' ? 'jpg' : x.fmt === 'PNG' ? 'png' : 'tif'}`; };
    const rows = {
      Size: sizeList.map(([k, px]) => ({ name: k, value: String(px), on: p.size === k, pick: () => setP({ size: k, long: px }) }))
        .concat([{ name: 'Custom', value: p.size === 'Custom' ? String(p.long) : '', on: p.size === 'Custom', pick: () => { setP({ size: 'Custom' }); set({ ctl: 'long' }); } }]),
      Format: ['JPEG', 'PNG', 'TIFF 16'].map((f) => ({ name: f, on: p.fmt === f, pick: () => setP({ fmt: f }) }))
        .concat([{ name: 'Quality', value: p.fmt === 'JPEG' ? String(p.q) : '—', on: S.ctl === 'q', pick: () => set({ ctl: 'q' }) }, { name: 'Color space', value: p.space, pick: () => setP({ space: p.space === 'sRGB' ? 'Display P3' : 'sRGB' }) }]),
      Output: ['Off', 'Screen', 'Print'].map((s) => ({ name: s === 'Off' ? 'No sharpen' : s, on: p.sharpen === s, pick: () => setP({ sharpen: s }) }))
        .concat([{ name: 'Amount', value: p.amt, on: S.ctl === 'amt', pick: () => set({ ctl: 'amt' }) }, { name: 'Watermark', value: p.mark ? 'ON' : 'OFF', on: p.mark, pick: () => setP({ mark: !p.mark }) }]),
      Info: [{ name: 'Metadata', value: p.meta, on: S.ctl === 'meta', pick: () => set({ ctl: 'meta' }) }, { name: 'Location', value: p.gps ? 'ON' : 'OFF', on: p.gps, pick: () => setP({ gps: !p.gps }) },
        { name: 'File name', value: p.naming, on: S.ctl === 'naming', pick: () => set({ ctl: 'naming' }) }],
    };
    const defaultCtl = { Size: 'long', Format: 'q', Output: 'amt', Info: 'naming' };
    const ctl = S.ctl, labels = { long: 'Long edge', q: 'Quality', amt: 'Sharpen amount', meta: 'Metadata', naming: 'File name' };
    let valText, fillW, unit = '';
    if (ctl in nums) { const [lo, hi, , u] = nums[ctl]; const v = p[ctl]; valText = String(v); unit = u; fillW = ((v - lo) / (hi - lo)) * 328; }
    else { const o = enums[ctl], i = o.indexOf(p[ctl]); valText = p[ctl]; fillW = (i / (o.length - 1)) * 328; }
    const groups = Object.keys(rows), gi = groups.indexOf(S.group), secX = 14 + (384 / 4) * (gi + 0.5);
    let cx = 14;
    const chips = rows[S.group].map((o, i) => {
      const w = 16 + Math.max(o.name.length, String(o.value ?? '').length * 0.8) * 7.6, x = cx + w / 2; cx += w + 4;
      return { name: o.name.toUpperCase(), value: o.value ?? '', on: String(!!o.on), aria: o.name, pad: 8, size: 10,
        ink: o.on ? '#f2efe8' : '#80848a', valueInk: o.on ? '#e8202a' : '#6a6e73', bar: o.on ? '#e8202a' : 'transparent',
        dx: (secX - x).toFixed(0), delay: i * 32, anim: 'fly' + (gi + S.sel * 4), pick: o.pick };
    });
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const W = S.working, on = P.filter((x) => x.on);
    const run = () => {
      if (!on.length) return;
      let k = 0; const total = on.length * 12;
      const tick = () => { k++; this.setState({ working: { k, total } }); if (k < total) setTimeout(tick, 120); else setTimeout(() => this.setState({ working: null, done: true }), 300); };
      set({ done: false, working: { k: 0, total } }); setTimeout(tick, 120);
    };
    const pvW = 372, pvH = Math.round(pvW / 1.5);
    const cur = W ? on[Math.min(on.length - 1, Math.floor(W.k / 12))] : null;
    return {
      who: 'DSCF0412 · Classic Chrome · edited', pvW, pvH, mark: p.mark,
      working: !!W, bandPct: W ? ((W.k % 12) / 12) * 100 : 0,
      cards: P.map((x, i) => ({ name: x.name, sel: String(i === S.sel), on: String(x.on), ringW: i === S.sel ? 2 : 0,
        dims: `${x.long} × ${short(x)} px`, fmt: `${x.fmt}${x.fmt === 'JPEG' ? ` ${x.q}` : ''} · ${x.space}${x.sharpen !== 'Off' ? ` · sharpen ${x.sharpen.toLowerCase()}` : ''}`,
        size: x.on ? `≈ ${est(x)} · ${fileName(x)}` : 'Off · not saved', track: x.on ? '#e8202a' : '#3a3c3f', knob: x.on ? 18 : 2,
        pick: () => set({ sel: i, ctl: defaultCtl[S.group] }), toggle: () => set({ presets: P.map((y, j) => (j === i ? { ...y, on: !y.on } : y)), done: false }) })),
      showDone: S.done, doneTitle: 'Saved to Downloads', doneLines: on.map((x) => `${fileName(x)} · ${x.long} × ${short(x)} · ${est(x)}`),
      ctlUp: `${p.name.toUpperCase()} · ${labels[ctl].toUpperCase()}`, unit, valText, fillW: Math.max(0, fillW).toFixed(1), numX: Math.max(34, Math.min(338, 22 + fillW)).toFixed(1),
      spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, s: S.spin, v: p[ctl] }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => {
        const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI);
        let v;
        if (ctl in nums) { const [lo, hi, st] = nums[ctl]; const k = ctl === 'long' ? Math.round(deg / 3) : Math.round(deg / 4); v = Math.max(lo, Math.min(hi, d.v + k * st)); }
        else { const o = enums[ctl]; v = o[Math.max(0, Math.min(o.length - 1, o.indexOf(d.v) + Math.round(deg / 12)))]; }
        this.setState({ spin: d.s + deg, presets: this.state.presets.map((x, i) => (i === S.sel ? { ...x, [ctl]: v, ...(ctl === 'long' ? { size: (sizeList.find((z) => z[1] === v) || ['Custom'])[0] } : {}) } : x)), done: false });
      },
      dUp: () => { this.drag = null; },
      dKey: () => {},
      group: S.group, chips,
      groups: groups.map((g) => ({ label: g.toUpperCase(), current: String(g === S.group), ink: g === S.group ? '#f2efe8' : '#7d8187', dot: g === S.group ? '#e8202a' : 'transparent', pick: () => set({ group: g, ctl: defaultCtl[g] }) })),
      saveLabel: W ? `SAVING ${cur ? cur.name.toUpperCase() : ''} · ${Math.round((W.k / W.total) * 100)}%` : on.length === 2 ? 'SAVE BOTH' : on.length ? `SAVE ${on[0].name.toUpperCase()}` : 'NOTHING ON', save: run,
    };
  }
}
