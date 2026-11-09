// @ts-nocheck
// The EditPlate board, as designed (docs/design/editor/boards/EditPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { open: true, section: 'Light', adj: 'Exposure', sub: null, chan: 'RGB', mixColor: 'Blue', mixAttr: 'Hue', zone: 'Shadows', wb: 'As shot', wbMenu: false };
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    const { open, section, sub } = S;
    const sets = {
      Light: [['Exposure', '+0.35', 'EV'], ['Contrast', '+12'], ['Highlights', '−48'], ['Shadows', '+31'], ['Whites', '0'], ['Blacks', '−9']],
      Color: [['Temp', '5,450', 'K'], ['Tint', '+4'], ['Vibrance', '+15'], ['Saturation', '−6']],
      Effects: [['Texture', '0'], ['Clarity', '+8'], ['Dehaze', '+5'], ['Vignette', '−12'], ['Grain', '0']],
      Detail: [['Sharpening', '40'], ['Radius', '1.0'], ['Detail', '25'], ['Noise', '+10'], ['Color noise', '25']],
      Optics: [['Distortion', '0'], ['Vignetting', '0'], ['Defringe', '0']],
    };
    const subs = { Light: [['curve', 'Curve']], Color: [['mixer', 'Mixer'], ['grading', 'Grading']] };
    const counts = { Light: 5, Color: 4, Effects: 0, Detail: 1, Optics: 1 };
    const list = sets[section];
    const current = list.find((a) => a[0] === S.adj) || list[0];
    const sections = Object.keys(sets).map((name) => {
      const on = name === section;
      return { label: name.toUpperCase(), current: on ? 'true' : 'false', count: counts[name] ? String(counts[name]) : '',
        ink: on ? '#f2efe8' : '#7d8187', dot: on ? '#e8202a' : 'transparent', countInk: on ? '#e8202a' : '#5d6166',
        pick: () => set({ section: name, adj: sets[name][0][0], sub: null, wbMenu: false }) };
    });
    // engraved markings on the plate: paint-filled when active, with a red bar under them
    const chip = (o) => ({
      name: o.name.toUpperCase(), value: o.value ?? '', on: String(!!o.on), aria: o.aria ?? o.name, pad: o.pad ?? 8,
      ink: o.on ? '#f2efe8' : o.entry ? '#c9ccd1' : '#80848a',
      valueInk: o.on ? '#e8202a' : (o.value === '0' ? '#4f5357' : '#6a6e73'),
      bar: o.on ? '#e8202a' : 'transparent',
      box: o.entry ? 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 2px rgba(0,0,0,0.6)' : 'none',
      isDot: !!o.swatch, dot: o.swatch || 'transparent', dotRing: o.on ? '0 0 0 2px #232525, 0 0 0 3.5px #f2efe8' : 'inset 0 1px 2px rgba(0,0,0,0.6)',
      pick: o.pick,
    });
    const colors = [['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#ffc53d'], ['Green', '#46a758'], ['Aqua', '#12a594'], ['Blue', '#3e63dd'], ['Purple', '#8e4ec6'], ['Magenta', '#d6409f']];
    let chips, dialLabel, unit = '', actions;
    if (sub === 'curve') {
      chips = ['RGB', 'R', 'G', 'B'].map((c) => ({ name: c, on: c === S.chan, pad: 12, pick: () => set({ chan: c }) }));
      dialLabel = 'Curve point'; actions = [{ name: 'RESET CURVE' }];
    } else if (sub === 'mixer') {
      chips = ['Hue', 'Sat', 'Lum'].map((a) => ({ name: a, on: a === S.mixAttr, pad: 6, pick: () => set({ mixAttr: a }) }))
        .concat(colors.map(([c, hex]) => ({ name: '', aria: c, swatch: hex, on: c === S.mixColor, pad: 5, pick: () => set({ mixColor: c }) })));
      dialLabel = `${S.mixColor} ${S.mixAttr}`; actions = [{ name: `RESET ${S.mixColor.toUpperCase()}` }, { name: 'RESET ALL' }];
    } else if (sub === 'grading') {
      chips = ['Shadows', 'Midtones', 'Highlights', 'Global', 'Blending', 'Balance'].map((z) => ({ name: z, on: z === S.zone, pick: () => set({ zone: z }) }));
      const wheel = !['Blending', 'Balance'].includes(S.zone);
      dialLabel = wheel ? `${S.zone} Lum` : S.zone; actions = [{ name: 'RESET GRADING' }];
    } else {
      chips = list.map(([name, value]) => ({ name, value, on: name === current[0], pick: () => set({ adj: name }) }))
        .concat((subs[section] || []).map(([key, name]) => ({ name: `${name} ›`, entry: true, pad: 10, pick: () => set({ sub: key, wbMenu: false }) })));
      dialLabel = current[0]; unit = current[2] || '';
      actions = section === 'Color'
        ? [{ name: '', aria: 'Pick white balance from the photo', dropper: true, pad: 12 }, { name: `WB · ${S.wb.toUpperCase()}`, caret: true, expanded: String(S.wbMenu), pick: () => set({ wbMenu: !S.wbMenu }) }]
        : [{ name: 'AUTO', auto: true }, { name: 'RESET' }];
    }
    // the row flies out of the section name that was tapped: each chip starts at that name and springs into place
    const secX = 14 + (384 / 5) * (Object.keys(sets).indexOf(section) + 0.5);
    let cx = 14 + (sub ? 24 : 0);
    const placed = chips.map((o) => {
      const w = o.swatch ? 13 + 2 * (o.pad ?? 8) : 2 * (o.pad ?? 8) + Math.max(o.name.length, String(o.value ?? '').length * 0.8) * 7.6;
      const c = cx + w / 2; cx += w + 4; return c;
    });
    const anim = 'fly' + ['Light', 'Color', 'Effects', 'Detail', 'Optics', 'curve', 'mixer', 'grading'].indexOf(sub || section);
    const wbs = [['As shot', '5,450 K'], ['Auto', '5,210 K'], ['Daylight', '5,500 K'], ['Cloudy', '6,500 K'], ['Shade', '7,500 K'], ['Tungsten', '2,850 K'], ['Fluorescent', '3,800 K'], ['Flash', '5,500 K']];
    const tools = ['Looks', 'Crop', 'Edit', 'Masks', 'Heal', 'Versions'].map((name) => ({
      name, lens: name === 'Edit' ? 'lens' : '',
      isLooks: name === 'Looks', isCrop: name === 'Crop', isEdit: name === 'Edit', isMasks: name === 'Masks', isHeal: name === 'Heal', isVersions: name === 'Versions',
      open: () => set({ open: true }),
    }));
    return {
      photoH: open ? 540 : 780, plateY: open ? '0' : '330px',
      panelEvents: open ? 'auto' : 'none',
      dockLeft: open ? 342 : 14, dockW: open ? 56 : 384, dockH: open ? 56 : 64,
      toolsOpacity: open ? 0 : 1, toolsEvents: open ? 'none' : 'auto', backOpacity: open ? 1 : 0, closed: !open,
      sections, section, chips: chips.map((o, i) => ({ ...chip(o), dx: (secX - placed[i]).toFixed(0), delay: i * 32, anim })), rowAria: sub ? `${section} ${sub}` : `${section} adjustments`, tools, dialLabel, unit,
      inSub: !!sub, backSub: () => set({ sub: null }),
      showCurve: open && sub === 'curve', chan: S.chan,
      showTrio: open && sub === 'grading', zone: S.zone,
      wbMenu: open && S.wbMenu && section === 'Color' && !sub,
      wbList: wbs.map(([name, k]) => ({ name, k, on: String(name === S.wb), bg: name === S.wb ? 'rgba(255,255,255,0.16)' : 'transparent', pick: () => set({ wb: name, wbMenu: false }) })),
      actions: actions.map((a) => ({ name: a.name, aria: a.aria ?? a.name, pad: a.pad ?? 16, auto: !!a.auto, dropper: !!a.dropper, caret: !!a.caret, expanded: a.expanded ?? 'false', pick: a.pick ?? (() => {}) })),
      close: () => set({ open: false, wbMenu: false }),
    };
  }
}
