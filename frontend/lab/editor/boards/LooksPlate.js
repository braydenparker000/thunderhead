// @ts-nocheck
// The Looks board: the looks kept on this phone, each a small picture of the open photo wearing it, in a strip in
// the panel under the photo. The drum has two faces. PRESETS are the `.cube` looks brought in with IMPORT: a tap
// puts one on, a tap on it again takes it off, and the window above the strip sets its strength. MINE are edits
// saved as looks: a tap lays one over this photo's edit. The camera's own renderings are the Edit board's
// Profile face. Without a photo open it plays a few samples.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import '../app/zoom.js';
import { tile } from '../app/tiles.js';
import * as kept from '../app/looks.js';

const FACES = ['Presets', 'Mine'];
const SAMPLES = { Presets: [['Moody 01', 'contrast(1.2) saturate(0.7) brightness(0.92)'], ['Moody 02', 'contrast(1.1) saturate(0.6) hue-rotate(-10deg) brightness(0.95)'], ['Golden', 'saturate(1.2) sepia(0.25) brightness(1.05)'],
  ['Teal & orange', 'contrast(1.1) saturate(1.3) hue-rotate(-8deg)'], ['Tri-X', 'grayscale(1) contrast(1.35)']], Mine: [['My street look', 'contrast(1.12) saturate(0.85) brightness(0.97)']] };

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { face: 'Presets', look: '', del: '', note: '' };
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  /** IMPORT: `.cube` looks are read and kept; the other kinds say they are not read yet. */
  pickFiles() {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
    i.onchange = async () => {
      let added = 0; const not = [];
      for (const f of i.files || []) {
        if (!/\.cube$/i.test(f.name)) { not.push(`${f.name}: only .cube looks are read so far`); continue; }
        try { await kept.addCube(f); added++; } catch (e) { not.push(`${f.name}: ${e.message}`); }
      }
      this.setState({ face: added ? 'Presets' : this.state.face, note: [added ? `${added} added to Presets` : '', not[0] || '', not.length > 1 ? `and ${not.length - 1} more not read` : ''].filter(Boolean).join(' · ') });
    };
    i.click();
  }
  /** DELETE, for the look that is on: the first tap asks, a second within 5 s deletes it. */
  drop(id) {
    if (this.state.del !== id) { this.setState({ del: id }); clearTimeout(this.delT); this.delT = setTimeout(() => this.setState({ del: '' }), 5000); return; }
    clearTimeout(this.delT);
    if (photo.cubeOn() === id) photo.pickCube(id);   // off this photo first
    kept.remove(id).then(() => this.setState({ del: '', look: '', note: 'Deleted from this phone' }));
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), real = photo.current(), face = S.face, at = FACES.indexOf(face);
    const sample = (g) => SAMPLES[g].map(([name, filter]) => ({ id: name, name, filter }));
    const cubes = real ? kept.list('cube') : sample('Presets'), mine = real ? kept.list('mine') : sample('Mine');
    const on = face === 'Presets' ? (real ? photo.cubeOn() : S.look) : S.look, own = (face === 'Presets' ? cubes : mine).find((l) => l.id === on);
    const save = () => { const name = real ? prompt('Name this look', `My look ${mine.length + 1}`) : ''; if (name?.trim()) kept.addMine(name.trim().slice(0, 40), photo.state()).then((m) => set({ face: 'Mine', look: m.id, note: '' })); };
    const tiles = face === 'Presets'
      ? cubes.map((l) => ({ name: l.name, on: l.id === on, filter: l.filter, src: real ? tile('cube:' + l.id, { ...photo.state(), cube: l.id }, 168, { cube: 1 }) || photo.jpeg() : '', pick: () => { if (real) photo.pickCube(l.id); set({ look: l.id === on ? '' : l.id, del: '', note: '' }); } }))
      : mine.map((l) => ({ name: l.name, on: l.id === on, filter: l.filter, src: real ? tile('mine:' + l.id, photo.worn(l.st), 168) || photo.jpeg() : '', pick: () => { if (real) photo.wear(l.st, l.name); set({ look: l.id, del: '', note: '' }); } }));
    const chips = (face === 'Presets' ? [{ name: 'Import', entry: true, aria: 'Import looks', pick: () => (real ? this.pickFiles() : set({ note: 'Open a photo to bring looks in' })) }] : [{ name: 'Save current', entry: true, pick: save }])
      .concat(real && own ? [{ name: S.del === on ? 'Tap again to delete' : 'Delete', entry: true, hot: S.del === on, aria: 'Delete this look', pick: () => this.drop(on) }] : []);
    // the window sets the strength of the .cube look that is on; otherwise the place says what a tap does
    const strong = face === 'Presets' && !!own && !!real;
    const hint = S.note || (face === 'Presets' ? (cubes.length ? (own ? '' : 'A tap puts a look on · a tap on it again takes it off') : 'No looks on this phone yet: IMPORT brings .cube files in')
      : mine.length ? 'A tap lays a look over this photo’s edit · Undo takes it back' : 'SAVE CURRENT keeps this photo’s edit as a look for other photos');
    return {
      real: !!real, demo: !real, lookFilter: (!real && own?.filter) || 'none',
      faces: FACES.map((f) => ({ label: f, count: real ? (f === 'Presets' ? (photo.cubeOn() ? 1 : 0) : 0) : 0 })), faceAt: at, pickFace: (i) => set({ face: FACES[i], look: '', del: '', note: '' }),
      chips, rowAria: `${face} actions`, tiles, stripLabel: face === 'Presets' ? 'Presets' : 'My looks', noTiles: face === 'Presets' ? '' : 'None of your own yet',
      strong, plain: !strong, hint, dialLabel: own ? `${own.name} · Amount` : 'Amount',
      dialValue: strong ? photo.toDial('Cube') : undefined, dialText: strong ? photo.text('Cube') : undefined, dialTurn: strong ? (d) => photo.turn('Cube', d) : undefined, dialReset: strong ? () => photo.reset('Cube') : undefined,
      status: real?.status || '', hasStatus: !!real?.status,
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
    };
  }
}
