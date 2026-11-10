// @ts-nocheck
// The LooksPlate board, as designed (docs/design/editor/boards/LooksPlate.dc.html.dc.html). With a photo open
// (app/session.js), FILM SIMS are this phone's camera profiles: each tile is the photo drawn through it, the
// one it was shot with is marked AS SHOT, a tap develops the photo with it, Amount sets a look table's
// strength and press-and-hold shows it as shot. Recipes, Presets and Mine still play the design's samples.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import { tile } from '../app/tiles.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { group: 'Recipes', coll: 'All', look: 'r-kchrome', amounts: {}, favs: { 'r-kchrome': 1, 's-cc': 1 }, card: true, param: null,
      edits: {}, importing: false, report: null, packs: [], comparing: false, spin: 0 };
    this.drag = null;
    if (photo.current()) Object.assign(this.state, { group: 'Film', look: 'x:' + photo.look(), card: false });
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    // film simulations: our own, to be fitted to this camera's JPEGs; CSS filters stand in for the previews
    const sims = [['Provia', 'contrast(1.05) saturate(1.05)'], ['Velvia', 'contrast(1.18) saturate(1.5)'], ['Astia', 'contrast(0.98) saturate(1.15) brightness(1.03)'],
      ['Classic Chrome', 'contrast(1.12) saturate(0.72) sepia(0.08) hue-rotate(-6deg)'], ['Reala Ace', 'contrast(1.06) saturate(1.08) hue-rotate(2deg)'],
      ['Pro Neg Hi', 'contrast(1.1) saturate(0.9)'], ['Pro Neg Std', 'contrast(0.94) saturate(0.86)'], ['Classic Neg', 'contrast(1.2) saturate(0.85) sepia(0.12) hue-rotate(-12deg)'],
      ['Nostalgic Neg', 'contrast(1.04) saturate(1.05) sepia(0.22) brightness(1.03)'], ['Eterna', 'contrast(0.85) saturate(0.7) brightness(1.04)'],
      ['Bleach Bypass', 'contrast(1.3) saturate(0.4)'], ['Acros', 'grayscale(1) contrast(1.25)'], ['Acros +R', 'grayscale(1) contrast(1.4) brightness(0.95)'],
      ['Monochrome', 'grayscale(1) contrast(1.05)'], ['Sepia', 'sepia(0.85) contrast(1.05)']];
    const looks = [], real = photo.current();
    if (real) {
      for (const e of photo.looks()) looks.push({ id: 'x:' + e.id, real: e.id, name: e.label, group: 'Film', colls: ['All', e.mono ? 'B&W' : 'Color'], filter: 'none', src: S.group === 'Film' ? tile('look:' + e.id, { ...photo.state(), profile: e.id }, 132, { amount: 1 }) : '', table: e.table, tag: e.asShot ? 'AS SHOT' : '' });
    } else {
      sims.forEach(([n, f], i) => looks.push({ id: 's-' + i, name: n, group: 'Film', colls: ['All', i >= 11 ? 'B&W' : 'Color'], filter: f }));
      looks.push({ id: 's-cc', name: 'As shot · Classic Chrome', group: 'Film', colls: ['All', 'Color'], filter: sims[3][1], tag: 'RAF' });
    }
    const rec = (id, name, film, f, p, credit) => looks.push({ id, name, group: 'Recipes', colls: ['All', film.toUpperCase()], filter: f, recipe: { Film: film, ...p }, credit, tag: 'RECIPE' });
    const P = (g, cc, fx, wb, r, b, dr, hi, sh, co, sp, nr, cl) => ({ Grain: g, 'Color chrome': cc, 'Chrome FX blue': fx, 'White balance': wb, 'WB red': r, 'WB blue': b, 'Dynamic range': dr, Highlight: hi, Shadow: sh, Color: co, Sharpness: sp, 'High ISO NR': nr, Clarity: cl });
    rec('r-kchrome', 'Kodachrome 64', 'Classic Chrome', 'contrast(1.15) saturate(0.95) sepia(0.12) hue-rotate(-8deg)', P('Weak · Small', 'Strong', 'Off', 'Daylight', 2, -5, 'DR200', 0, 0.5, 2, 1, -4, 3), 'Pasted recipe · credit kept with it');
    rec('r-portra', 'Portra 400', 'Classic Chrome', 'contrast(1.02) saturate(0.85) sepia(0.18) brightness(1.04)', P('Strong · Small', 'Strong', 'Off', '5200K', 2, -4, 'DR400', -1, -1, 2, -2, -4, -2), 'Pasted recipe');
    rec('r-800t', 'Cinestill 800T', 'Eterna', 'contrast(1.1) saturate(0.9) hue-rotate(-14deg) brightness(0.96)', P('Strong · Large', 'Off', 'Strong', 'Fluorescent 3', -6, 3, 'DR400', 0, 2, 3, -2, -4, -3), 'Pasted recipe');
    rec('r-neg', 'Superia 400', 'Classic Neg', 'contrast(1.18) saturate(0.95) sepia(0.1) hue-rotate(-10deg)', P('Weak · Small', 'Strong', 'Weak', 'Auto', 1, -2, 'DR400', 0, 0, 1, -1, -4, 0), 'Pasted recipe');
    rec('r-trix', 'Tri-X 400', 'Acros', 'grayscale(1) contrast(1.35)', P('Strong · Large', 'Off', 'Off', 'Auto', 0, 0, 'DR200', 1, 2, 0, 1, -4, 2), 'Pasted recipe');
    rec('r-americana', 'Americana', 'Nostalgic Neg', 'contrast(1.05) saturate(1.1) sepia(0.25)', P('Weak · Small', 'Weak', 'Weak', 'Daylight', 3, -5, 'DR400', -0.5, 0.5, 3, 0, -4, -1), 'Pasted recipe');
    const pk = (id, name, coll, f) => looks.push({ id, name, group: 'Presets', colls: ['All', coll], filter: f, tag: 'XMP' });
    pk('p-m1', 'Moody 01', 'MOODY FILM.ZIP', 'contrast(1.2) saturate(0.7) brightness(0.92)'); pk('p-m2', 'Moody 02', 'MOODY FILM.ZIP', 'contrast(1.1) saturate(0.6) hue-rotate(-10deg) brightness(0.95)');
    pk('p-m3', 'Moody 03', 'MOODY FILM.ZIP', 'contrast(1.25) saturate(0.8) sepia(0.15) brightness(0.9)'); pk('p-t1', 'Golden', 'TRAVEL', 'saturate(1.2) sepia(0.25) brightness(1.05)');
    pk('p-t2', 'Teal & orange', 'TRAVEL', 'contrast(1.1) saturate(1.3) hue-rotate(-8deg)');
    S.packs.forEach((p) => pk(p.id, p.name, p.coll, p.filter));
    looks.push({ id: 'm-1', name: 'My street look', group: 'Mine', colls: ['All'], filter: 'contrast(1.12) saturate(0.85) brightness(0.97)', tag: '' });
    const cur = (real && S.group === 'Film' ? looks.find((l) => l.real === photo.look()) : null) || looks.find((l) => l.id === S.look) || looks[0];
    const groups = ['Film', 'Recipes', 'Presets', 'Mine'];
    const collsOf = (g) => ['All', '★'].concat([...new Set(looks.filter((l) => l.group === g).flatMap((l) => l.colls.slice(1)))]);
    const colls = collsOf(S.group), coll = colls.includes(S.coll) ? S.coll : 'All';
    const inColl = looks.filter((l) => l.group === S.group && (coll === 'All' || (coll === '★' ? S.favs[l.id] : l.colls.includes(coll))));
    // a recipe's settings: numbers step by one, choices step through their options
    const enums = { Grain: ['Off', 'Weak · Small', 'Weak · Large', 'Strong · Small', 'Strong · Large'], 'Color chrome': ['Off', 'Weak', 'Strong'], 'Chrome FX blue': ['Off', 'Weak', 'Strong'], 'Dynamic range': ['DR100', 'DR200', 'DR400'] };
    const nums = { 'WB red': [-9, 9], 'WB blue': [-9, 9], Highlight: [-2, 4], Shadow: [-2, 4], Color: [-4, 4], Sharpness: [-4, 4], 'High ISO NR': [-4, 4], Clarity: [-5, 5] };
    const recipe = cur.recipe ? { ...cur.recipe, ...(S.edits[cur.id] || {}) } : null;
    const amount = cur.real ? photo.value('Amount') : S.amounts[cur.id] ?? 100;
    const setAmt = (a) => (cur.real ? photo.setAmount(a) : this.setState({ amounts: { ...this.state.amounts, [cur.id]: Math.max(0, Math.min(150, a)) } }));
    const ctl = recipe && S.param && (S.param in enums || S.param in nums) ? S.param : 'Amount';
    const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x);
    let valText, fillL, fillW, numX, unit = '';
    if (ctl === 'Amount') { valText = `${Math.round(amount)}`; unit = '%'; fillL = 22; fillW = (amount / 150) * 328; numX = 22 + fillW; }
    else if (ctl in enums) { const o = enums[ctl], i = Math.max(0, o.indexOf(recipe[ctl])); valText = recipe[ctl]; fillL = 22; fillW = (i / (o.length - 1)) * 328; numX = 22 + fillW; }
    else { const [lo, hi] = nums[ctl], v = recipe[ctl], f = v / Math.max(-lo, hi); valText = sgn(v); fillL = 186 + Math.min(0, f) * 164; fillW = Math.abs(f) * 164; numX = 186 + f * 164; }
    const setParam = (k, v) => set({ edits: { ...S.edits, [cur.id]: { ...(S.edits[cur.id] || {}), [k]: v } } });
    const gi = groups.indexOf(S.group), secX = 14 + (384 / 4) * (gi + 0.5);
    let cx = 14;
    const chips = colls.map((c, i) => {
      const w = 16 + c.length * 7.6, x = cx + w / 2; cx += w + 4;
      const n = c === 'All' ? looks.filter((l) => l.group === S.group).length : c === '★' ? looks.filter((l) => l.group === S.group && S.favs[l.id]).length : looks.filter((l) => l.group === S.group && l.colls.includes(c)).length;
      return { name: c.toUpperCase(), value: String(n), on: String(c === coll), aria: `${c} collection`, pad: 8, size: c === '★' ? 13 : 10,
        ink: c === coll ? '#f2efe8' : '#80848a', valueInk: c === coll ? '#e8202a' : '#6a6e73', bar: c === coll ? '#e8202a' : 'transparent',
        dx: (secX - x).toFixed(0), delay: i * 32, anim: 'fly' + gi, pick: () => set({ coll: c }) };
    });
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const tiles = (S.group === 'Mine' ? [{ id: '+save', name: 'Save current', glyph: '+' }] : []).concat(inColl).map((l, i) => ({
      on: String(l.id === cur.id), name: l.name, filter: l.filter || 'none', src: l.real ? l.src || photo.jpeg() : '/lab/editor/assets/sample.jpg', ring: l.id === cur.id ? '#e8202a' : 'rgba(255,255,255,0.15)', ringW: l.id === cur.id ? 2 : 1,
      ink: l.id === cur.id ? '#f2efe8' : '#a6b0bc', star: S.favs[l.id] ? '★' : '', tag: l.tag || '', tagShow: l.tag ? 'block' : 'none',
      glyph: l.glyph || '', glyphShow: l.glyph ? 'block' : 'none', imgShow: l.glyph ? 'none' : 'block', plain: l.glyph ? 'rgba(232,32,42,0.25)' : '#000',
      delay: i * 24, anim: 'tl' + ((gi * 7 + colls.indexOf(coll)) % 8),
      pick: () => { if (l.glyph) return; if (l.real) photo.pickLook(l.real); set({ look: l.id, param: null }); },
    }));
    const doImport = (kind) => {
      if (kind === 'files') {
        const id = 'pk' + S.packs.length;
        const add = [['Portra 160', 'contrast(1.0) saturate(0.85) sepia(0.15) brightness(1.06)'], ['Portra 400', 'contrast(1.04) saturate(0.9) sepia(0.2)'], ['Portra 800', 'contrast(1.08) saturate(0.95) sepia(0.18) brightness(0.98)'], ['Ektar 100', 'contrast(1.12) saturate(1.35)'], ['Gold 200', 'saturate(1.1) sepia(0.3) brightness(1.04)']];
        set({ packs: S.packs.concat(add.map(([n, f], i) => ({ id: `${id}-${i}`, name: n, coll: 'FILM STOCKS.ZIP', filter: f }))),
          report: [['Film stocks.zip · 24 files', '#f2efe8'], ['19 presets and 5 LUTs added to Presets › Film stocks', '#c9d0d8'], ['3 asked for Adobe profiles: matched to our Classic Neg and Provia', '#a6b0bc'], ['2 used local masks: kept, with masks applied as gradients', '#a6b0bc']] });
      } else if (kind === 'paste') set({ report: [['Recipe read: 13 of 13 settings', '#f2efe8'], ['Classic Chrome · DR400 · Highlight −1 · Shadow +1 …', '#c9d0d8'], ['Name and credit kept with it in Recipes', '#a6b0bc']] });
      else set({ report: [['Read 186 photos from this card', '#f2efe8'], ['Classic Chrome 121 · Acros 42 · Classic Neg 23', '#c9d0d8'], ['Each opens with its own simulation as "As shot"', '#a6b0bc']] });
    };
    const params = recipe ? Object.keys(recipe).map((k) => ({ name: k, text: k in nums ? sgn(recipe[k]) : String(recipe[k]), on: String(k === ctl),
      ink: k === ctl ? '#e8202a' : '#f2efe8', bg: k === ctl ? 'rgba(232,32,42,0.16)' : 'transparent', pick: () => set({ param: k in enums || k in nums ? k : null }) })) : [];
    return {
      lookFilter: cur.filter, lookO: S.comparing ? 0 : amount / 100, grainO: recipe && recipe.Grain !== 'Off' && !S.comparing ? (recipe.Grain.startsWith('Strong') ? 0.5 : 0.28) : 0,
      comparing: S.comparing, holdOn: () => { if (real) photo.hold(true); set({ comparing: true }); }, holdOff: () => { if (this.state.comparing) { if (real) photo.hold(false); set({ comparing: false }); } },
      real: !!real, demo: !real,
      fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      card: S.card && !!recipe && !S.importing, lookName: cur.name, credit: cur.credit || '', params,
      tiles, collName: coll, importing: S.importing, report: !!S.report, reportLines: (S.report || []).map(([text, ink]) => ({ text, ink })),
      sources: [{ glyph: '⇪', name: 'Files', note: '.xmp · .lrtemplate · .cube · .zip, many at once', pick: () => doImport('files') },
        { glyph: '¶', name: 'Paste a recipe', note: 'The text block a recipe is shared as', pick: () => doImport('paste') },
        { glyph: '◎', name: 'From my camera', note: 'Read each RAF’s film simulation as “As shot”', pick: () => doImport('camera') }],
      ctl, ctlUp: `${cur.name.toUpperCase()} · ${ctl.toUpperCase()}`, unit, valText, valNow: valText, vmin: 0, vmax: 150,
      fillL: fillL.toFixed(1), fillW: Math.max(0, fillW).toFixed(1), numX: Math.max(34, Math.min(338, numX)).toFixed(1), spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, s: S.spin, a: amount, v: recipe && ctl !== 'Amount' ? recipe[ctl] : null }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => {
        const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI);
        if (ctl === 'Amount') { setAmt(d.a + deg * (150 / 180)); return this.setState({ spin: d.s + deg }); }
        const steps = Math.round(deg / 10);                      // a detent every 10 degrees for settings that click
        let v;
        if (ctl in enums) { const o = enums[ctl]; v = o[Math.max(0, Math.min(o.length - 1, o.indexOf(d.v) + steps))]; }
        else { const [lo, hi] = nums[ctl], st = ctl === 'Highlight' || ctl === 'Shadow' ? 0.5 : 1; v = Math.max(lo, Math.min(hi, d.v + steps * st)); }   // tone steps in halves, as on the camera
        this.setState({ spin: d.s + deg, edits: { ...this.state.edits, [cur.id]: { ...(this.state.edits[cur.id] || {}), [ctl]: v } } });
      },
      dUp: () => { this.drag = null; },
      dKey: (e) => { if (ctl === 'Amount') setAmt(amount + (e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0)); },
      group: S.group, chips,
      groups: groups.map((g) => ({ label: g === 'Film' ? 'FILM SIMS' : g.toUpperCase(), current: String(g === S.group), ink: g === S.group ? '#f2efe8' : '#7d8187', dot: g === S.group ? '#e8202a' : 'transparent',
        pick: () => set({ group: g, coll: 'All', param: null }) })),
      actions: [{ name: 'IMPORT', dot: S.importing, pressed: String(S.importing), pick: () => set({ importing: !S.importing, report: null }) },
        { name: S.favs[cur.id] ? '★ SAVED' : '☆ FAVOURITE', dot: false, pressed: String(!!S.favs[cur.id]), pick: () => set({ favs: { ...S.favs, [cur.id]: S.favs[cur.id] ? 0 : 1 } }) },
        { name: 'RECIPE', dot: S.card && !!recipe, pressed: String(S.card), pick: () => set({ card: !S.card }) }],
    };
  }
}
