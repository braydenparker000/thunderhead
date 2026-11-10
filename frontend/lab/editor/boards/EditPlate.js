// @ts-nocheck
// The Edit board. The photo fills the screen above a short panel: the value's window, the dial that turns it, and
// one row holding a drum and the adjustments. The drum stands on the left and turns up and down; each face is a
// section (Light, Curve, Color, Mixer, Grading, Effects, Detail, Optics, Profile) and the section's adjustments fly
// out of it into the row. The curve and the grading wheels are in the panel too, never over the photo: the panel
// grows for them and the photo's room gives way. The dial turns the chosen one, runs on when flicked, and two taps on it put the value
// back where it starts. With a photo open (app/session.js) every value is the photo's; without one it plays a sample.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import '../app/zoom.js';   // the photo's own layer, zoomed with two fingers
import { tile } from '../app/tiles.js';

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

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { face: 'Light', adj: { Light: 'Exposure' }, chan: 'RGB', mixColor: 'Blue', mixAttr: 'Hue', zone: 'Shadows', wb: 'As shot', wbMenu: false, kind: 'All' };
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
    let chips = [], tiles = [], ctl = '', dialLabel = '', unit = '', point = null, auto = '';
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
    } else {   // Profile: the camera's own renderings, each a small picture of this photo, the one it was shot with marked; the window sets a look table's strength
      const looks = real ? photo.looks() : [{ id: 'p', label: 'Provia', asShot: true }, { id: 'v', label: 'Velvia' }, { id: 'c', label: 'Classic Chrome' }, { id: 'a', label: 'Acros', mono: true }], on = real ? photo.look() : 'p';
      const kinds = { All: () => true, Film: (l) => !/^Adobe/.test(l.label), Adobe: (l) => /^Adobe/.test(l.label), 'B&W': (l) => l.mono };
      chips = Object.keys(kinds).map((k) => ({ name: k, value: String(looks.filter(kinds[k]).length), on: k === S.kind, pick: () => set({ kind: k }) }));
      tiles = looks.filter(kinds[S.kind] || kinds.All).map((l) => ({ name: l.label, on: l.id === on, tag: l.asShot ? 'AS SHOT' : '', src: real ? tile('look:' + l.id, { ...photo.state(), profile: l.id }, 168, { amount: 1 }) || photo.jpeg() : '', pick: () => real && photo.pickLook(l.id) }));
      dialLabel = 'Amount'; ctl = 'Amount'; unit = '%';
    }
    const at = FACES.indexOf(face);
    const wbs = real ? Object.keys(photo.WB).map((n) => [n, `${photo.wbKelvin(n).toLocaleString('en-US')} K`])
      : [['As shot', '5,450 K'], ['Auto', '5,210 K'], ['Daylight', '5,500 K'], ['Cloudy', '6,500 K'], ['Shade', '7,500 K'], ['Tungsten', '2,850 K'], ['Fluorescent', '3,800 K'], ['Flash', '5,500 K']];
    const wbNow = real ? real.wb : S.wb, live = real && ctl;
    // the panel is as tall as its face needs: the curve and a grading wheel take the dial's place and more, and the photo's room gives way
    const mode = face === 'Curve' ? 'curve' : face === 'Grading' && ZONES.includes(S.zone) ? 'wheel' : face === 'Profile' ? 'tiles' : 'dial', plateH = mode === 'curve' ? 340 : mode === 'wheel' ? 262 : 210;
    const cp = photo.curve()?.[S.chan] || [[0, 0], [1, 1]], ci = Math.min(photo.picked.i, cp.length - 1), inner = ci > 0 && ci < cp.length - 1;
    const lift = (by) => real && photo.setCurve(S.chan, (photo.curve()?.[S.chan] || [[0, 0], [1, 1]]).map((q, j, all) => (j === Math.min(photo.picked.i, all.length - 1) ? [q[0], Math.max(0, Math.min(1, q[1] + by / 255))] : q)));
    const hold = (by) => () => { lift(by); clearTimeout(this.rep); clearInterval(this.rep); this.rep = setTimeout(() => { this.rep = setInterval(() => lift(by), 60); }, 380); };   // a press steps once; held, it keeps stepping
    return {
      faces: FACES.map((f) => ({ label: f, count: counts[f] || 0 })), faceAt: at, pickFace: (i) => { photo.pickWhite(false); set({ face: FACES[i], wbMenu: false }); this._host?.el.querySelector('[role=toolbar]')?.scrollTo({ left: 0 }); },   // a new face's row starts from its beginning
      chips, rowAria: `${face} adjustments`, dialLabel, unit,
      dialValue: point ? point.value : live ? photo.toDial(ctl) : undefined, dialText: point ? point.text : live ? photo.text(ctl) : undefined,
      dialTurn: point ? point.turn : live ? (d) => photo.turn(ctl, d) : undefined, dialReset: point ? point.reset : live ? () => photo.reset(ctl) : undefined,
      auto, pressAuto: real ? photo.auto : undefined,
      plateTop: 915 - plateH, photoH: 915 - plateH - 56, drumTop: plateH - 60, rowTop: plateH - 58,
      isDial: mode === 'dial', isCurve: mode === 'curve', isWheel: mode === 'wheel', isTiles: mode === 'tiles', tiles, noTiles: 'No profiles on this phone yet: load them on the engine page', dialLeft: !!real && !!ctl && photo.upward(ctl), chan: S.chan, zone: S.zone, pickZone: (z) => set({ zone: z }),
      curveIn: Math.round(cp[ci][0] * 255), curveOut: Math.round(cp[ci][1] * 255), nudgeUp: hold(1), nudgeDown: hold(-1), nudgeStop: () => { clearTimeout(this.rep); clearInterval(this.rep); },
      removePoint: () => { if (real && inner) { photo.setCurve(S.chan, cp.filter((_, j) => j !== ci)); photo.picked.i = Math.max(0, ci - 1); } }, removeInk: inner ? '#dedbd4' : '#5d6166',
      wbMenu: S.wbMenu && face === 'Color',
      wbList: wbs.map(([name, k]) => ({ name, k, on: String(name === wbNow), bg: name === wbNow ? 'rgba(255,255,255,0.16)' : 'transparent', pick: () => { if (real) photo.setWb(name); set({ wb: name, wbMenu: false }); } })),
      status: real?.status || '', hasStatus: !!real?.status,
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
    };
  }
}
