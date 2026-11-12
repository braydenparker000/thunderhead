// @ts-nocheck
// The Looks board: the looks kept on this phone, each a small picture of the open photo wearing it, in a strip in
// the panel under the photo. The drum has two faces. PRESETS are the `.cube` looks brought in with IMPORT: a tap
// puts one on, a tap on it again takes it off, and the window above the strip sets its strength. MINE are edits
// saved as looks: a tap lays one over this photo's edit. The camera's own renderings are the Edit board's
// Profile face. First on the Presets face is the Weekly Fuji recipes card (app/recipes.js): a tap opens the recipes,
// grouped by the sensor each was made for; a tap on one puts its profile and settings on. In the app with no photo open it shows none (app/shown.js); a screen of the design on its own plays a few samples.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as store from '../app/store.js';
import { dropStart, forWhat, keepStart, startFor } from '../app/starts.js';
import '../app/zoom.js';
import { tile } from '../app/tiles.js';
import * as shown from '../app/shown.js';
import * as kept from '../app/looks.js';
import * as recipes from '../app/recipes.js';
import { XMP_MAX_BYTES, lookOfXmp } from '../app/xmp.js';

const FACES = ['Presets', 'Mine'];
const SAMPLES = { Presets: [['Moody 01', 'contrast(1.2) saturate(0.7) brightness(0.92)'], ['Moody 02', 'contrast(1.1) saturate(0.6) hue-rotate(-10deg) brightness(0.95)'], ['Golden', 'saturate(1.2) sepia(0.25) brightness(1.05)'],
  ['Teal & orange', 'contrast(1.1) saturate(1.3) hue-rotate(-8deg)'], ['Tri-X', 'grayscale(1) contrast(1.35)']], Mine: [['My street look', 'contrast(1.12) saturate(0.85) brightness(0.97)']] };

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { face: 'Presets', look: '', del: '', note: '', shelf: '', group: '', upTo: 8 };
    this.keep('Looks', ['face']);
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  /** IMPORT: `.cube` looks go to Presets; a Lightroom preset (`.xmp`) becomes a look of the owner's own, in Mine
   * (app/xmp.js); the other kinds say they are not read yet. */
  pickFiles() {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
    i.onchange = async () => {
      let added = 0, mine = 0; const not = [], left = [];
      for (const f of i.files || []) {
        if (/\.xmp$/i.test(f.name)) {
          const look = f.size <= XMP_MAX_BYTES ? lookOfXmp(await f.text(), f.name) : null;
          if (!look) { not.push(`${f.name}: not a preset this editor reads`); continue; }
          await kept.addMine(look.name, look.st); mine++;
          if (look.left) left.push(`${look.name}: ${look.left} of its settings have no control here`);
          continue;
        }
        if (!/\.cube$/i.test(f.name)) { not.push(`${f.name}: only .cube and .xmp looks are read so far`); continue; }
        try { await kept.addCube(f); added++; } catch (e) { not.push(`${f.name}: ${e.message}`); }
      }
      this.setState({ face: mine ? 'Mine' : added ? 'Presets' : this.state.face, note: [added ? `${added} added to Presets` : '', mine ? `${mine} preset${mine === 1 ? '' : 's'} added to Mine` : '', left[0] || '', not[0] || '', not.length > 1 ? `and ${not.length - 1} more not read` : ''].filter(Boolean).join(' · ') });
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
  /** The Weekly Fuji recipes card: opened, its list is read (once); shut, the strip is the Presets again. */
  shelf(open) {
    this.setState({ shelf: open ? 'fxw' : '', look: '', del: '', note: '', upTo: 8 });
    if (open) recipes.load().then(() => this.setState({}), (e) => this.setState({ shelf: '', note: `The recipes could not be read: ${e?.message || e}` }));
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), seen = shown.face(), real = seen.real ? photo.current() : null, face = S.face, at = FACES.indexOf(face), app = shown.app;
    const sample = (g) => SAMPLES[g].map(([name, filter]) => ({ id: name, name, filter }));
    const cubes = real ? kept.list('cube') : app ? [] : sample('Presets'), mine = real ? kept.list('mine') : app ? [] : sample('Mine');
    // the recipes card, open: its groups (the sensor a recipe was made for), and the one group's recipes in the strip
    const fx = face === 'Presets' && S.shelf === 'fxw' && !!real, groups = fx ? recipes.groups() : [], group = groups.find((g) => g.sensor === S.group)?.sensor || groups[0]?.sensor || '', inGroup = fx ? recipes.list().filter((r) => r.sensor === group) : [];
    const on = face === 'Presets' ? (real ? photo.cubeOn() : S.look) : S.look, own = fx ? undefined : (face === 'Presets' ? cubes : mine).find((l) => l.id === on);
    const save = () => { const name = real ? prompt('Name this look', `My look ${mine.length + 1}`) : ''; if (name?.trim()) kept.addMine(name.trim().slice(0, 40), photo.state()).then((m) => set({ face: 'Mine', look: m.id, note: '' })); };
    const wear = (r) => { const left = recipes.wear(r), film = photo.looks().find((l) => l.id === photo.look())?.label || ''; const names = (l) => l.map((t) => t.split(':')[0]).join(', '), none = left.filter((t) => /not applied|not replicated|no profile/.test(t)), near = left.filter((t) => !none.includes(t));
      set({ look: r.id, del: '', note: [r.name, film, near.length ? `near only: ${names(near)}` : '', none.length ? `not here: ${names(none)}` : ''].filter(Boolean).join(' · ') }); };
    const card = real ? [{ name: 'Fuji recipes', tag: 'WEEKLY', src: photo.jpeg(), pick: () => this.shelf(true) }] : [];
    const tiles = fx ? inGroup.map((r, i) => ({ name: r.name, on: r.id === S.look, src: (i < S.upTo && tile('fxw:' + r.id, () => recipes.worn(r).st, 168)) || photo.jpeg(), pick: () => wear(r) }))
      : face === 'Presets'
      ? card.concat(cubes.map((l) => ({ name: l.name, on: l.id === on, filter: l.filter, src: real ? tile('cube:' + l.id, { ...photo.state(), cube: l.id }, 168, { cube: 1 }) || photo.jpeg() : '', pick: () => { if (real) photo.pickCube(l.id); set({ look: l.id === on ? '' : l.id, del: '', note: '' }); } })))
      : mine.map((l) => ({ name: l.name, on: l.id === on, filter: l.filter, src: real ? tile('mine:' + l.id, photo.worn(l.st), 168) || photo.jpeg() : '', pick: () => { if (real) photo.wear(l.st, l.name); set({ look: l.id, del: '', note: '' }); } }));
    // AS .CUBE: the look that is picked, or this photo's edit, saved as a table to use elsewhere (app/cube-out.js)
    const asCube = async () => { const { saveCube } = await import('../app/cube-out.js'); set({ note: 'Making the table…' }); saveCube(own?.st ? photo.worn(own.st) : photo.state(), own?.name || photo.stem(real.name)).then((f) => set({ note: `Saved ${f} to Downloads · colour only: no Exposure, white balance, Highlights, Shadows or masks` }), (e) => set({ note: `Not saved: ${e?.message || e}` })); };
    // START: this photo's edit kept as where every photo from its camera and lens begins (app/starts.js); a tap on it again clears it
    const shot = real ? store.photos().find((p) => p.id === real.id)?.shot : null, whose = forWhat(shot), has = !!startFor(shot);
    const asStart = () => { if (has) { dropStart(shot); set({ note: `Photos from the ${whose} start plain again` }); } else set({ note: keepStart(shot, photo.state()) ? `New photos from the ${whose} now start like this one (but for Exposure, white balance and Noise, which stay each photo’s own)` : 'Not kept' }); };
    const chips = fx ? [{ name: '‹ Presets', entry: true, aria: 'Back to Presets', pick: () => this.shelf(false) }].concat(groups.map((g) => ({ name: g.sensor, value: String(g.count), on: g.sensor === group, aria: `${g.sensor}: ${g.count} recipes`, pick: () => set({ group: g.sensor, look: '', note: '', upTo: 8 }) })))
      : (face === 'Presets' ? [{ name: 'Import', entry: true, aria: 'Import looks', pick: () => (real ? this.pickFiles() : set({ note: 'Open a photo to bring looks in' })) }] : [{ name: 'Save current', entry: true, pick: save }, ...(real ? [{ name: 'As .cube', entry: true, aria: 'Save the look as a .cube file', pick: asCube }] : []), ...(whose ? [{ name: has ? 'Start ✓' : 'As start', entry: true, hot: has, aria: has ? `Clear the start for the ${whose}` : `Make this the start for the ${whose}`, pick: asStart }] : [])])
      .concat(real && own ? [{ name: S.del === on ? 'Tap again to delete' : 'Delete', entry: true, hot: S.del === on, aria: 'Delete this look', pick: () => this.drop(on) }] : []);
    // the window sets the strength of the .cube look that is on; otherwise the place says what a tap does
    const strong = face === 'Presets' && !!own && !!real;
    const hint = S.note || (fx ? (groups.length ? `${inGroup.length} recipes by Ritchie Roesch, fujixweekly.com · a tap puts one on · Undo takes it back` : 'Reading the recipes…') : face === 'Presets' ? (cubes.length ? (own ? '' : 'A tap puts a look on · a tap on it again takes it off') : (real ? 'The Weekly Fuji recipes open with a tap · IMPORT brings .cube files in' : 'No looks on this phone yet: IMPORT brings .cube files in'))
      : mine.length ? 'A tap lays a look over this photo’s edit · Undo takes it back' : 'SAVE CURRENT keeps this photo’s edit as a look for other photos');
    return {
      real: !!real, demo: seen.demo, lookFilter: (!real && own?.filter) || 'none',
      // the drum's counts: Presets, whether one is on; Mine, how many there are
      faces: FACES.map((f) => ({ label: f, count: real ? (f === 'Presets' ? (photo.cubeOn() ? 1 : 0) : mine.length) : 0 })), faceAt: at, pickFace: (i) => set({ face: FACES[i], look: '', del: '', note: '' }),
      chips, rowAria: fx ? 'Weekly Fuji recipes' : `${face} actions`, tiles, stripLabel: fx ? `Weekly Fuji recipes · ${group}` : face === 'Presets' ? 'Presets' : 'My looks', noTiles: face === 'Presets' ? '' : 'None of your own yet',
      // a long strip's pictures are made as they come near (boards/Strip.js)
      near: (n) => { if (fx && n + 4 > S.upTo) set({ upTo: n + 10 }); },
      strong, plain: !strong, hint, dialLabel: own ? `${own.name} · Amount` : 'Amount',
      dialValue: strong ? photo.toDial('Cube') : undefined, dialText: strong ? photo.text('Cube') : undefined, dialTurn: strong ? (d) => photo.turn('Cube', d) : undefined, dialReset: strong ? () => photo.reset('Cube') : undefined,
      status: seen.status, hasStatus: !!seen.status, fileName: seen.fileName, shotLine: seen.shotLine,
    };
  }
}
