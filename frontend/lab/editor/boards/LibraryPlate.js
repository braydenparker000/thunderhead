// @ts-nocheck
// The LibraryPlate board, as designed (docs/design/editor/boards/LibraryPlate.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    // one sample image stands in for a roll: each "photo" is a different crop and look of it
    const sims = [['CC', 'contrast(1.12) saturate(0.72) sepia(0.08) hue-rotate(-6deg)'], ['AC', 'grayscale(1) contrast(1.25)'], ['CN', 'contrast(1.2) saturate(0.85) sepia(0.12) hue-rotate(-12deg)'], ['PV', 'none'], ['VV', 'contrast(1.18) saturate(1.5)']];
    const photos = [];
    for (let i = 0; i < 30; i++) {
      const s = sims[(i * 7 + (i >> 2)) % 5];
      photos.push({ id: i, n: 412 + i, pos: `${(i * 37) % 100}% ${(i * 53) % 100}%`, zoom: (1.3 + ((i * 29) % 13) / 10).toFixed(2), sim: s[0], filter: s[1],
        rating: [0, 3, 0, 4, 2, 0, 5, 0, 1, 3][i % 10], flag: i % 9 === 4 ? 'reject' : i % 4 === 1 ? 'pick' : 'none', edited: i % 5 === 2, shoot: i < 12 ? 0 : i < 24 ? 1 : 2 });
    }
    this.state = { view: 'grid', cullMode: false, filter: 'All', sort: 0, cols: 3, idx: 6, photos, importing: false, progress: null, skip: false, spin: 0 };
    this.drag = null;
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), P = S.photos;
    const shoots = ['TODAY · OLD TOWN', 'NOV 7 · COAST', 'NOV 2 · HOME'];
    const tests = { All: () => true, Picks: (p) => p.flag === 'pick', Rated: (p) => p.rating > 0, Edited: (p) => p.edited, Rejects: (p) => p.flag === 'reject' };
    const shown = P.filter(tests[S.filter]);
    const sorts = ['NEWEST', 'OLDEST', 'RATING'];
    const order = (list) => S.sort === 1 ? [...list].reverse() : S.sort === 2 ? [...list].sort((a, b) => b.rating - a.rating) : list;
    const tile = (p) => ({ aria: `DSCF0${p.n}${p.rating ? `, ${p.rating} stars` : ''}${p.flag !== 'none' ? `, ${p.flag}` : ''}`,
      pos: p.pos, zoom: p.zoom, filter: p.filter, sim: p.sim, stars: '★'.repeat(p.rating), edited: p.edited ? '#e8202a' : 'transparent',
      flag: p.flag === 'pick' ? '⚑' : p.flag === 'reject' ? '✕' : '', flagInk: p.flag === 'reject' ? '#e8202a' : '#f2efe8', dim: p.flag === 'reject' ? 0.45 : 1,
      // CULL on: a photo opens culling at it; off: it opens in the editor (the app takes editor:open)
      open: () => (S.cullMode ? set({ view: 'cull', idx: p.id }) : document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }))) });
    const groups = S.sort === 2 ? [{ title: 'BY RATING', count: String(shown.length), items: order(shown).map(tile) }]
      : (S.sort === 1 ? [2, 1, 0] : [0, 1, 2]).map((g) => ({ title: shoots[g], count: String(shown.filter((p) => p.shoot === g).length), items: order(shown.filter((p) => p.shoot === g)).map(tile) })).filter((g) => g.items.length);
    const cur = P[S.idx], n = P.length;
    const curT = tile(cur);
    const step = (from, dir) => { let i = from; do { i += dir; } while (S.skip && i >= 0 && i < n && P[i].flag === 'reject'); return i < 0 || i >= n ? from : i; };
    const setPhoto = (patch) => set({ photos: P.map((p) => (p.id === cur.id ? { ...p, ...patch } : p)) });
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const span = 328, fx = (i) => 22 + (i / (n - 1)) * span;
    const runImport = (label) => {
      let k = 0; const total = 64;
      set({ progress: { label, k, total } });
      const tick = () => { k = Math.min(total, k + 8); this.setState({ progress: { label, k, total } }); if (k < total) setTimeout(tick, 220); };
      setTimeout(tick, 220);
    };
    const pr = S.progress;
    return {
      title: S.view === 'grid' ? 'Library' : ['Old town', 'Coast', 'Home'][cur.shoot], subtitle: S.view === 'grid' ? (S.cullMode ? 'Culling on · tap a photo to start there' : `${shown.length} of ${n} photos · 3 shoots`) : `DSCF0${cur.n}.RAF · ${cur.sim === 'AC' ? 'Acros' : cur.sim === 'CN' ? 'Classic Neg' : cur.sim === 'PV' ? 'Provia' : cur.sim === 'VV' ? 'Velvia' : 'Classic Chrome'}`,
      isGrid: S.view === 'grid', isCull: S.view === 'cull', groups, cols: S.cols,
      importing: S.importing, toggleImport: () => set({ importing: !S.importing, progress: null }),
      sources: [{ glyph: '▦', name: 'Choose photos', note: 'Pick RAFs or JPEGs from the phone’s files', pick: () => runImport('Reading previews') },
        { glyph: '▣', name: 'From a card or the camera', note: 'Plug in the SD reader or the X-E5 by USB-C, then pick its DCIM folder', pick: () => runImport('Copying from the card') },
        { glyph: '↻', name: 'Watch a folder', note: 'New RAFs in a chosen folder come in by themselves when the app opens', pick: () => runImport('Checking the folder') }],
      progress: !!pr, progText: pr ? (pr.k < pr.total ? `${pr.label}…` : 'Done · 64 photos in Today') : '', progCount: pr ? `${pr.k} / ${pr.total}` : '', progPct: pr ? Math.round((pr.k / pr.total) * 100) : 0,
      filters: Object.keys(tests).map((f) => ({ label: f.toUpperCase(), count: String(P.filter(tests[f]).length), current: String(f === S.filter),
        ink: f === S.filter ? '#f2efe8' : '#7d8187', dot: f === S.filter ? '#e8202a' : 'transparent', countInk: f === S.filter ? '#e8202a' : '#5d6166', pick: () => set({ filter: f }) })),
      toCull: () => set({ cullMode: !S.cullMode }), cullOn: String(S.cullMode),
      cullDot: S.cullMode ? '#e8202a' : '#4f5357', cullGlow: S.cullMode ? '0 0 6px rgba(232,32,42,0.7)' : 'none', cycleSort: () => set({ sort: (S.sort + 1) % 3 }), sortName: `${sorts[S.sort]} ▾`,
      cycleSize: () => set({ cols: S.cols === 3 ? 4 : S.cols === 4 ? 2 : 3 }), sizeGlyph: S.cols === 4 ? '▦' : S.cols === 2 ? '◫' : '▤',
      cur: { ...curT, meta: `${S.idx + 1} / ${n} · ${cur.sim}` },
      strip: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => { const p = P[Math.max(0, Math.min(n - 1, S.idx + d))]; const out = S.idx + d < 0 || S.idx + d >= n;
        return { pos: p.pos, filter: p.filter, ringW: d === 0 ? 2 : 0, lift: d === 0 ? 0 : 3, o: out ? 0 : d === 0 ? 1 : p.flag === 'reject' ? 0.3 : 0.65 }; }),
      rollName: shoots[cur.shoot].split(' · ')[1], pos: String(S.idx + 1), total: String(n),
      marks: P.map((p, i) => ({ x: fx(i).toFixed(1), c: p.flag === 'pick' ? 'rgba(242,239,232,0.75)' : p.flag === 'reject' ? 'rgba(232,32,42,0.6)' : 'transparent' })),
      fillW: (fx(S.idx) - 22).toFixed(1), numX: Math.max(30, Math.min(342, fx(S.idx))).toFixed(1), spinY: -Math.floor(frac * 12) * 150,
      dDown: (e) => { this.drag = { x: e.clientX, s: S.spin, i: S.idx }; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); },
      dMove: (e) => {
        const d = this.drag; if (!d) return; const deg = ((e.clientX - d.x) / RD) * (180 / Math.PI);
        let i = d.i; const k = Math.round(deg / 9);                 // one photo per 9 degree detent, like the camera's playback
        for (let j = 0; j < Math.abs(k); j++) i = step(i, Math.sign(k));
        this.setState({ spin: d.s + deg, idx: i });
      },
      dUp: () => { this.drag = null; },
      dKey: (e) => { if (e.key === 'ArrowRight') set({ idx: step(S.idx, 1) }); if (e.key === 'ArrowLeft') set({ idx: step(S.idx, -1) }); },
      rates: [0, 1, 2, 3, 4, 5].map((r) => ({ name: r === 0 ? '✕' : '★'.repeat(r), size: r === 0 ? 11 : r > 3 ? 9 : 11, aria: r === 0 ? 'No stars' : `${r} stars`, on: String(cur.rating === r),
        ink: cur.rating === r ? '#f2efe8' : '#7d8187', bar: cur.rating === r ? '#e8202a' : 'transparent', pick: () => setPhoto({ rating: r }) })),
      flags: [['pick', 'PICK ⚑'], ['none', 'UNFLAG'], ['reject', 'REJECT ✕']].map(([f, label]) => ({ label, on: String(cur.flag === f),
        ink: cur.flag === f ? (f === 'reject' ? '#e8202a' : '#f2efe8') : '#7d8187', dot: cur.flag === f ? '#e8202a' : 'transparent', pick: () => setPhoto({ flag: f }) })),
      toGrid: () => set({ view: 'grid' }), skip: String(S.skip), skipDot: S.skip ? '#e8202a' : '#4f5357', toggleSkip: () => set({ skip: !S.skip }), noop: () => {},
    };
  }
}
