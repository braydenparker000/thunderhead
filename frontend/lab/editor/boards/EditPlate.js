// @ts-nocheck
// The Edit board. The photo fills the screen above a short panel: the value's window, the dial that turns it, and
// one row holding a drum and the adjustments. The drum stands on the left and turns up and down; each face is a
// section (Light, Curve, Color, Mixer, Grading, Effects, Detail, Optics, Profile) and the section's adjustments fly
// out of it into the row. The dial turns the chosen one, runs on when flicked, and two taps on it put the value
// back where it starts. With a photo open (app/session.js) every value is the photo's; without one it plays a sample.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import '../app/zoom.js';   // the photo's own layer, zoomed with two fingers

const FACES = ['Light', 'Curve', 'Color', 'Mixer', 'Grading', 'Effects', 'Detail', 'Optics', 'Profile'];
const LISTS = {
  Light: [['Exposure', '+0.35', 'EV'], ['Contrast', '+12'], ['Highlights', '−48'], ['Shadows', '+31'], ['Whites', '0'], ['Blacks', '−9']],
  Color: [['Temp', '5,450', 'K'], ['Tint', '+4'], ['Vibrance', '+15'], ['Saturation', '−6']],
  Effects: [['Texture', '0'], ['Clarity', '+8'], ['Dehaze', '+5'], ['Vignette', '−12'], ['Grain', '0']],
  Detail: [['Sharpening', '40'], ['Radius', '1.0'], ['Detail', '25'], ['Noise', '+10'], ['Color noise', '25']],
  Optics: [['Distortion', '0'], ['Vignetting', '0'], ['Defringe', '0']],
};
const COLORS = [['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#ffc53d'], ['Green', '#46a758'], ['Aqua', '#12a594'], ['Blue', '#3e63dd'], ['Purple', '#8e4ec6'], ['Magenta', '#d6409f']];
const ZONES = ['Shadows', 'Midtones', 'Highlights', 'Global'];
const DRUM_X = 50;   // the drum's middle across the panel: where the row's chips fly out from

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { face: 'Light', adj: { Light: 'Exposure' }, chan: 'RGB', mixColor: 'Blue', mixAttr: 'Hue', zone: 'Shadows', wb: 'As shot', wbMenu: false };
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), real = photo.current(), face = S.face;
    const val = (n, sample) => (real ? photo.text(n) : sample);
    const moved = (names) => (real ? names.filter((n) => photo.edited(n)).length : 0);
    const mixNames = COLORS.flatMap(([c]) => ['Hue', 'Sat', 'Lum'].map((a) => `Mix ${c} ${a}`)), gradeNames = ZONES.flatMap((z) => ['Hue', 'Sat', 'Lum'].map((a) => `Grade ${z} ${a}`)).concat(['Blending', 'Balance']);
    const counts = real ? { Light: moved(LISTS.Light.map((a) => a[0])), Curve: photo.curve() ? 1 : 0, Color: moved(LISTS.Color.map((a) => a[0])), Mixer: moved(mixNames), Grading: moved(gradeNames),
      Effects: moved(LISTS.Effects.map((a) => a[0])), Detail: moved(LISTS.Detail.map((a) => a[0])), Optics: moved(LISTS.Optics.map((a) => a[0])), Profile: real.profile ? 1 : 0 } : { Light: 5, Color: 4, Detail: 1, Optics: 1 };
    // the row: what flies out of the drum for this face, and which of them the dial turns
    let chips = [], ctl = '', dialLabel = '', unit = '', point = null, auto = '';
    const pickAdj = (name) => { photo.pickWhite(false); set({ adj: { ...S.adj, [face]: name }, wbMenu: false }); };
    if (LISTS[face]) {
      const list = LISTS[face], cur = list.find((a) => a[0] === S.adj[face]) || list[0];
      ctl = dialLabel = cur[0]; unit = cur[2] || '';
      chips = list.map(([name, sample]) => ({ name, value: val(name, sample), on: name === ctl, pick: () => pickAdj(name) }));
      if (face === 'Light') auto = 'AUTO';
      if (face === 'Color') chips.unshift({ name: 'WB', value: (real ? real.wb : S.wb), entry: true, aria: 'White balance', pick: () => set({ wbMenu: !S.wbMenu }) },
        { name: '', aria: 'Pick white balance from the photo', dropper: true, pad: 9, pick: () => { photo.pickWhite(); set({ wbMenu: false }); } });
    } else if (face === 'Curve') {
      chips = ['RGB', 'R', 'G', 'B'].map((c) => ({ name: c, on: c === S.chan, pad: 12, pick: () => set({ chan: c }) })).concat([{ name: 'Reset', entry: true, pick: () => photo.setCurve() }]);
      dialLabel = 'Curve point';
      if (real) {   // the dial lifts or lowers the point last touched: finer than a finger on the curve
        const pts = photo.curve()?.[S.chan] || [[0, 0], [1, 1]], i = Math.min(photo.picked.i, pts.length - 1), [x, y] = pts[i];
        point = { value: (y - x) * 5, text: String(Math.round(y * 255)), turn: (d) => photo.setCurve(S.chan, pts.map((q, j) => (j === i ? [x, Math.max(0, Math.min(1, x + d / 5))] : q))), reset: () => photo.setCurve(S.chan, pts.map((q, j) => (j === i ? [x, x] : q))) };
      }
    } else if (face === 'Mixer') {
      chips = ['Hue', 'Sat', 'Lum'].map((a) => ({ name: a, on: a === S.mixAttr, pad: 6, pick: () => set({ mixAttr: a }) }))
        .concat(COLORS.map(([c, hex]) => ({ name: '', aria: c, swatch: hex, on: c === S.mixColor, pad: 5, pick: () => set({ mixColor: c }) })))
        .concat([{ name: 'Reset', entry: true, pick: () => photo.resetAll(mixNames, 'Mixer reset') }]);
      dialLabel = `${S.mixColor} ${S.mixAttr}`; ctl = `Mix ${S.mixColor} ${S.mixAttr}`;
    } else if (face === 'Grading') {
      chips = [...ZONES, 'Blending', 'Balance'].map((z) => ({ name: z, on: z === S.zone, pick: () => set({ zone: z }) })).concat([{ name: 'Reset', entry: true, pick: () => photo.resetAll(gradeNames, 'Grading reset') }]);
      const wheel = ZONES.includes(S.zone);
      dialLabel = wheel ? `${S.zone} Lum` : S.zone; ctl = wheel ? `Grade ${S.zone} Lum` : S.zone;
    } else {   // Profile: the camera's own renderings, the one the photo was shot with marked; the dial sets a look table's strength
      const looks = real ? photo.looks() : [{ id: 'p', label: 'Provia', asShot: true }, { id: 'v', label: 'Velvia' }, { id: 'c', label: 'Classic Chrome' }, { id: 'a', label: 'Acros' }], on = real ? photo.look() : 'p';
      chips = looks.map((l) => ({ name: l.label, value: l.asShot ? 'AS SHOT' : '', on: l.id === on, pick: () => real && photo.pickLook(l.id) }));
      dialLabel = 'Amount'; ctl = 'Amount'; unit = '%';
      if (!chips.length) chips = [{ name: 'No profiles on this phone', pick: () => {} }];
    }
    // engraved markings: paint-filled when chosen, a red bar under them; each starts at the drum and springs into place
    let cx = 98;
    const at = FACES.indexOf(face);
    const row = chips.map((o, i) => {
      const pad = o.pad ?? 8, w = o.swatch ? 13 + 2 * pad : o.dropper ? 17 + 2 * pad : 2 * pad + Math.max(o.name.length, String(o.value ?? '').length * 0.8) * 7.6, mid = cx + w / 2; cx += w + 4;
      return { name: o.name.toUpperCase(), value: String(o.value ?? '').toUpperCase(), on: String(!!o.on), aria: o.aria ?? o.name, pad,
        ink: o.on ? '#f2efe8' : o.entry ? '#c9ccd1' : '#80848a', valueInk: o.on ? '#e8202a' : (o.value === '0' ? '#4f5357' : '#6a6e73'), bar: o.on ? '#e8202a' : 'transparent',
        box: o.entry ? 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 2px rgba(0,0,0,0.6)' : 'none',
        isDot: !!o.swatch, dot: o.swatch || 'transparent', dotRing: o.on ? '0 0 0 2px #232525, 0 0 0 3.5px #f2efe8' : 'inset 0 1px 2px rgba(0,0,0,0.6)', isDropper: !!o.dropper,
        dx: (DRUM_X - mid).toFixed(0), delay: i * 26, anim: 'pop' + at, pick: o.pick };
    });
    const wbs = real ? Object.keys(photo.WB).map((n) => [n, `${photo.wbKelvin(n).toLocaleString('en-US')} K`])
      : [['As shot', '5,450 K'], ['Auto', '5,210 K'], ['Daylight', '5,500 K'], ['Cloudy', '6,500 K'], ['Shade', '7,500 K'], ['Tungsten', '2,850 K'], ['Fluorescent', '3,800 K'], ['Flash', '5,500 K']];
    const wbNow = real ? real.wb : S.wb, live = real && ctl;
    return {
      faces: FACES.map((f) => ({ label: f, count: counts[f] || 0 })), faceAt: at, pickFace: (i) => { photo.pickWhite(false); set({ face: FACES[i], wbMenu: false }); this._host?.el.querySelector('[role=toolbar]')?.scrollTo({ left: 0 }); },   // a new face's row starts from its beginning
      chips: row, rowAria: `${face} adjustments`, dialLabel, unit,
      dialValue: point ? point.value : live ? photo.toDial(ctl) : undefined, dialText: point ? point.text : live ? photo.text(ctl) : undefined,
      dialTurn: point ? point.turn : live ? (d) => photo.turn(ctl, d) : undefined, dialReset: point ? point.reset : live ? () => photo.reset(ctl) : undefined,
      auto, pressAuto: real ? photo.auto : undefined,
      showCurve: face === 'Curve', chan: S.chan, showTrio: face === 'Grading', zone: S.zone,
      wbMenu: S.wbMenu && face === 'Color',
      wbList: wbs.map(([name, k]) => ({ name, k, on: String(name === wbNow), bg: name === wbNow ? 'rgba(255,255,255,0.16)' : 'transparent', pick: () => { if (real) photo.setWb(name); set({ wb: name, wbMenu: false }); } })),
      status: real?.status || '', hasStatus: !!real?.status,
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
    };
  }
}
