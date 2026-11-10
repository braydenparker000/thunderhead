// @ts-nocheck
// The Export board. With a photo open it saves for real (app/save.js): size, format, quality, output sharpening,
// metadata, location and file name are the photo's own; the watermark and Display P3 wait for their stage and say
// so. The two files to save (Full, Small) are cards along the panel's top; the drum's faces are Size, Format,
// Output and Info; the dial sets the long edge, the quality, or steps through a choice; Save is in the header.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import '../app/zoom.js';   // the photo's own layer: it stays as it was on the board before
import { day, save } from '../app/save.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const base = { fmt: 'JPEG', space: 'sRGB', sharpen: 'Off', amt: 'Standard', mark: false, meta: 'All', gps: false, naming: 'Camera name' };
    this.state = { sel: 0, group: 'Size', ctl: 'long', presets: [{ ...base, name: 'Full', on: true, size: 'Full', long: 7728, q: 95 }, { ...base, name: 'Small', on: true, size: '2048', long: 2048, q: 85, sharpen: 'Screen', mark: true }],
      working: null, done: false, day: '', saved: null, note: '' };
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
    if (photo.current()) day().then((d) => this.setState({ day: d }), () => {});
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    // a photo's own size and name; what its export can't do yet is off, whatever the preset says
    const real = photo.current(), [fw, fh] = real ? photo.shape() : [7728, 5152], full = Math.max(fw, fh), stem0 = real ? real.name.replace(/\.\w+$/, '') : 'DSCF0412';
    const P = real ? S.presets.map((x) => ({ ...x, long: x.size === 'Full' ? full : Math.min(full, x.long), space: 'sRGB', mark: false, naming: x.naming === 'Shoot + number' ? 'Camera name' : x.naming })) : S.presets, p = P[S.sel];
    const setP = (patch) => set({ presets: S.presets.map((x, i) => (i === S.sel ? { ...x, ...patch } : x)), done: false });
    const sizeList = [['Full', full], ['4K', 3840], ['2048', 2048], ['1080', 1080]].filter(([k, px]) => k === 'Full' || px < full);
    const enums = { amt: ['Low', 'Standard', 'High'], meta: ['All', 'Copyright only', 'None'], naming: real ? ['Camera name', 'Date + number'] : ['Camera name', 'Date + number', 'Shoot + number'] };
    const nums = { long: [512, full, 64, 'px'], q: [50, 100, 1, ''] };
    const short = (x) => Math.round((x.long * Math.min(fw, fh)) / full);
    const mb = (n) => (n >= 10 ? `${Math.round(n)} MB` : `${n.toFixed(1)} MB`);
    const est = (x) => { const px = x.long * short(x); const bpp = x.fmt === 'PNG' ? 1.9 : x.fmt === 'TIFF 16' ? 6 : 0.1 + Math.pow((x.q - 50) / 50, 1.6) * 0.55; return mb((px * bpp) / 1e6); };
    const fileName = (x) => { const stem = x.naming === 'Camera name' ? stem0 : x.naming === 'Date + number' ? (real ? `${S.day || 'photo'}_${(stem0.match(/\d+$/) || [stem0])[0]}` : '2026-11-09_0412') : 'Oldtown_012'; return `${stem}${x.name === 'Small' ? '_small' : ''}.${x.fmt === 'JPEG' ? 'jpg' : x.fmt === 'PNG' ? 'png' : 'tif'}`; };
    const rows = {
      Size: sizeList.map(([k, px]) => ({ name: k, value: String(px), on: p.size === k, pick: () => setP({ size: k, long: px }) }))
        .concat([{ name: 'Custom', value: p.size === 'Custom' ? String(p.long) : '', on: p.size === 'Custom', pick: () => { setP({ size: 'Custom' }); set({ ctl: 'long' }); } }]),
      Format: ['JPEG', 'PNG', 'TIFF 16'].map((f) => ({ name: f, on: p.fmt === f, pick: () => setP({ fmt: f }) }))
        .concat([{ name: 'Quality', value: p.fmt === 'JPEG' ? String(p.q) : '—', on: S.ctl === 'q', pick: () => set({ ctl: 'q' }) }, { name: 'Color space', value: p.space, pick: () => (real ? null : setP({ space: p.space === 'sRGB' ? 'Display P3' : 'sRGB' })) }]),
      Output: ['Off', 'Screen', 'Print'].map((s) => ({ name: s === 'Off' ? 'No sharpen' : s, on: p.sharpen === s, pick: () => setP({ sharpen: s }) }))
        .concat([{ name: 'Amount', value: p.amt, on: S.ctl === 'amt', pick: () => set({ ctl: 'amt' }) }, real ? { name: 'Watermark', value: 'LATER', pick: () => {} } : { name: 'Watermark', value: p.mark ? 'ON' : 'OFF', on: p.mark, pick: () => setP({ mark: !p.mark }) }]),
      Info: [{ name: 'Metadata', value: p.meta, on: S.ctl === 'meta', pick: () => set({ ctl: 'meta' }) }, { name: 'Location', value: p.gps ? 'ON' : 'OFF', on: p.gps, pick: () => setP({ gps: !p.gps }) },
        { name: 'File name', value: p.naming, on: S.ctl === 'naming', pick: () => set({ ctl: 'naming' }) }],
    };
    const defaultCtl = { Size: 'long', Format: 'q', Output: 'amt', Info: 'naming' };
    const ctl = S.ctl, labels = { long: 'Long edge', q: 'Quality', amt: 'Sharpen amount', meta: 'Metadata', naming: 'File name' };
    // the dial's window runs -5..5 over a number's whole range, or over a choice's options (it stops on each)
    const groups = Object.keys(rows), gi = groups.indexOf(S.group), isNum = ctl in nums, opts = isNum ? null : enums[ctl];
    const span = isNum ? 5 : 1.2;   // a choice steps with a short turn
    const share = isNum ? (p[ctl] - nums[ctl][0]) / (nums[ctl][1] - nums[ctl][0]) : opts.indexOf(p[ctl]) / (opts.length - 1);
    const turned = (d) => {
      const t = Math.max(0, Math.min(1, (d / span + 1) / 2));
      if (isNum) { const [lo, hi, st] = nums[ctl], v = Math.max(lo, Math.min(hi, Math.round((lo + t * (hi - lo)) / st) * st)); return v === p[ctl] ? null : { [ctl]: v, ...(ctl === 'long' ? { size: (sizeList.find((z) => z[1] === v) || ['Custom'])[0] } : {}) }; }
      const v = opts[Math.round(t * (opts.length - 1))]; return v === p[ctl] ? null : { [ctl]: v };
    };
    const start = { long: { size: 'Full', long: full }, q: { q: p.name === 'Small' ? 85 : 95 }, amt: { amt: 'Standard' }, meta: { meta: 'All' }, naming: { naming: 'Camera name' } };
    const chips = rows[S.group].map((o) => ({ name: o.name, value: o.value ?? '', on: !!o.on, pick: o.pick }));
    const W = S.working, on = P.filter((x) => x.on);
    const run = () => {
      if (!on.length || W) return;
      if (real) {
        const total = on.length * 12;
        set({ done: false, saved: null, note: '', working: { k: 0, total } });
        save(on.map((x) => ({ fmt: x.fmt, long: x.long, q: x.q, meta: x.meta, gps: x.gps, file: fileName(x), sharpen: x.sharpen, amt: x.amt })), (i, d) => this.setState({ working: { k: Math.min(total - 0.01, (i + d) * 12), total } }))
          .then((saved) => this.setState({ working: null, done: true, saved }), (err) => this.setState({ working: null, done: true, note: String(err?.message || err) }));
        return;
      }
      let k = 0; const total = on.length * 12;
      const tick = () => { k++; this.setState({ working: { k, total } }); if (k < total) setTimeout(tick, 120); else setTimeout(() => this.setState({ working: null, done: true }), 300); };
      set({ done: false, working: { k: 0, total } }); setTimeout(tick, 120);
    };
    // the files just saved, for the phone's share sheet (where it takes files)
    const shares = real && S.saved ? S.saved.map((x) => new File([x.blob], x.file, { type: x.blob.type })) : [];
    const cur = W ? on[Math.min(on.length - 1, Math.floor(W.k / 12))] : null;
    return {
      real: !!real, demo: !real, who: real ? `${stem0} · ${(photo.looks().find((l) => l.id === photo.look()) || {}).label || 'RAF'}${[...photo.LIVE].some((n) => photo.edited(n)) ? ' · edited' : ''}` : 'DSCF0412 · Classic Chrome · edited',
      working: !!W, donePct: W ? (W.k / W.total) * 100 : 0,
      cards: P.map((x, i) => ({ name: x.name, sel: String(i === S.sel), on: String(x.on), ringW: i === S.sel ? 2 : 0,
        fmt: `${x.fmt}${x.fmt === 'JPEG' ? ` ${x.q}` : ''}${x.sharpen !== 'Off' ? ` · ${x.sharpen.toLowerCase()}` : ''}`, line: x.on ? `${x.long} × ${short(x)} · ≈ ${est(x)}` : 'Off · not saved',
        ink: x.on ? '#f2efe8' : '#80848a', track: x.on ? '#e8202a' : '#3a3c3f', knob: x.on ? 18 : 2,
        pick: () => set({ sel: i, ctl: defaultCtl[S.group] }), toggle: () => set({ presets: P.map((y, j) => (j === i ? { ...y, on: !y.on } : y)), done: false }) })),
      canShare: !real || (shares.length > 0 && !!navigator.canShare?.({ files: shares })), share: () => { if (shares.length) navigator.share({ files: shares }).catch(() => {}); },
      showDone: S.done, doneTitle: S.note ? 'Not saved' : 'Saved to Downloads',
      doneLines: S.note ? [S.note] : S.saved ? S.saved.map((x) => `${x.file} · ${x.width} × ${x.height} · ${mb(x.bytes / 1e6)}`) : on.map((x) => `${fileName(x)} · ${x.long} × ${short(x)} · ${est(x)}`),
      dialLabel: `${p.name} · ${labels[ctl]}`, unit: isNum ? nums[ctl][3] : '', dialValue: (share * 2 - 1) * span, dialSpan: span, dialText: String(p[ctl]),
      dialTurn: (d) => { const patch = turned(d); if (patch) setP(patch); }, dialReset: () => setP(start[ctl]),
      faces: groups.map((g) => ({ label: g, count: 0 })), faceAt: gi, pickFace: (i) => set({ group: groups[i], ctl: defaultCtl[groups[i]] }),
      chips, rowAria: `${S.group} options`, rowSeed: gi + S.sel * 4, dialLeft: true,
      saveLabel: W ? `SAVING ${cur ? cur.name.toUpperCase() : ''} · ${Math.round((W.k / W.total) * 100)}%` : on.length === 2 ? 'SAVE BOTH' : on.length ? `SAVE ${on[0].name.toUpperCase()}` : 'NOTHING ON', save: run, saveBg: on.length && !W ? '#2468d8' : '#3a3c3f',
    };
  }
}
