// @ts-nocheck
// The LibraryPlate board, as designed (docs/design/editor/boards/LibraryPlate.dc.html.dc.html). Once photos are
// imported (app/store.js: Choose photos copies RAFs onto the phone) it shows them, grouped by day, with the
// camera's JPEG as each tile, and a tile opens that photo in the editor; until then it plays the design's roll.
import { DCLogic } from '../dc.js';
import * as store from '../app/store.js';
import * as photo from '../app/session.js';

const DAY = (/** @type {number} */ t) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return today ? 'TODAY' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase(); };
/** The stored photos as the board's roll. */
function roll() {
  const real = store.photos(), days = [...new Set(real.map((p) => DAY(p.taken)))];
  return { shoots: days, photos: real.map((p, i) => ({ id: i, key: p.id, name: p.name, src: store.urlNow(p.id), pos: '50% 50%', zoom: '1', sim: '', filter: 'none',
    rating: p.rating, flag: p.flag, edited: !!p.edited, shoot: days.indexOf(DAY(p.taken)) })) };
}

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
    for (const p of photos) p.src = '/lab/editor/assets/sample.jpg';
    this.demo = photos;   // shown again if every photo is deleted
    const real = store.photos().length ? roll() : null;
    this.state = { view: 'grid', cullMode: false, filter: 'All', sort: 0, cols: 3, idx: real ? 0 : 6, photos: real ? real.photos : photos, shoots: real?.shoots || null, importing: false, progress: null, skip: false, spin: 0 };
    this.drag = null;
    // a photo's tile follows its edit, so the roll is read again when the open photo changes; and what the photos take on this phone
    this.keep('Library', ['filter', 'sort', 'cols']);
    const hear = () => { if (this._host?.stale) { photo.events.removeEventListener('change', hear); return; } if (this.state.shoots) { const r = roll(), some = r.photos.length > 0; this.setState({ photos: some ? r.photos : this.demo, shoots: some ? r.shoots : null, idx: some ? Math.min(this.state.idx, r.photos.length - 1) : 6 }); } };
    photo.events.addEventListener('change', hear);
    this.app = document.body.dataset.board === 'App';
    if (this.app) store.usage().then((used) => this.setState({ used }), () => {});
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), P = S.photos;
    const real = !!S.shoots, shoots = S.shoots || ['TODAY · OLD TOWN', 'NOV 7 · COAST', 'NOV 2 · HOME'];
    const fname = (p) => p.name || `DSCF0${p.n}.RAF`;
    const tests = { All: () => true, Picks: (p) => p.flag === 'pick', Rated: (p) => p.rating > 0, Edited: (p) => p.edited, Rejects: (p) => p.flag === 'reject' };
    const shown = P.filter(tests[S.filter]);
    const sorts = ['NEWEST', 'OLDEST', 'RATING'];
    const order = (list) => S.sort === 1 ? [...list].reverse() : S.sort === 2 ? [...list].sort((a, b) => b.rating - a.rating) : list;
    const tile = (p) => ({ src: p.src, aria: `${fname(p).replace(/\.RAF$/i, '')}${p.rating ? `, ${p.rating} stars` : ''}${p.flag !== 'none' ? `, ${p.flag}` : ''}`,
      pos: p.pos, zoom: p.zoom, filter: p.filter, sim: p.sim, stars: '★'.repeat(p.rating), edited: p.edited ? '#e8202a' : 'transparent',
      flag: p.flag === 'pick' ? '⚑' : p.flag === 'reject' ? '✕' : '', flagInk: p.flag === 'reject' ? '#e8202a' : '#f2efe8', dim: p.flag === 'reject' ? 0.45 : 1,
      // CULL on: a photo opens culling at it; off: it opens in the editor (the app takes editor:open)
      open: () => { if (S.cullMode) { set({ view: 'cull', idx: p.id }); return; } if (p.key) photo.open(p.key); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' })); } });
    const groups = S.sort === 2 ? [{ title: 'BY RATING', count: String(shown.length), items: order(shown).map(tile) }]
      : (S.sort === 1 ? shoots.map((_, i) => i).reverse() : shoots.map((_, i) => i)).map((g) => ({ title: shoots[g], count: String(shown.filter((p) => p.shoot === g).length), items: order(shown.filter((p) => p.shoot === g)).map(tile) })).filter((g) => g.items.length);
    const cur = P[S.idx], n = P.length;
    const curT = tile(cur);
    const step = (from, dir) => { let i = from; do { i += dir; } while (S.skip && i >= 0 && i < n && P[i].flag === 'reject'); return i < 0 || i >= n ? from : i; };
    const setPhoto = (patch) => { if (cur.key) store.update(cur.key, patch); set({ photos: P.map((p) => (p.id === cur.id ? { ...p, ...patch } : p)) }); };
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const span = 328, fx = (i) => 22 + (i / (n - 1)) * span;
    const runImport = (label) => {
      let k = 0; const total = 64;
      set({ progress: { label, k, total } });
      const tick = () => { k = Math.min(total, k + 8); this.setState({ progress: { label, k, total } }); if (k < total) setTimeout(tick, 220); };
      setTimeout(tick, 220);
    };
    // Choose photos: the phone's file picker, then each RAF copied onto the phone with the real count
    const choose = () => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.raf,.RAF,image/x-fuji-raf' });
      input.onchange = async () => {
        const files = [...(input.files || [])];
        this.setState({ progress: { label: 'Copying to this phone', k: 0, total: files.length } });
        const n = await store.add(files, (k, total) => this.setState({ progress: { label: 'Copying to this phone', k, total } }));
        const r = roll();
        this.setState({ photos: r.photos, shoots: r.shoots, idx: 0, used: await store.usage(), progress: { label: 'Copying to this phone', k: n, total: n, done: `Done · ${n} photo${n === 1 ? '' : 's'} on this phone` } });
      };
      input.click();
    };
    const pr = S.progress;
    // the phone's storage, and deleting rejects for good: the subtitle says and does both (two taps, the second within 5 s)
    const gb = S.used ? ` · ${S.used >= 1e9 ? (S.used / 1e9).toFixed(1) + ' GB' : Math.round(S.used / 1e6) + ' MB'} on this phone` : '';
    const doomed = real && S.view === 'grid' && S.filter === 'Rejects' ? shown.filter((p) => p.key) : [], armed = doomed.length > 0 && Date.now() - (S.armed || 0) < 5000;
    const subTap = async () => {
      if (!doomed.length) return;
      if (!armed) { set({ armed: Date.now() }); setTimeout(() => this.setState({}), 5100); return; }
      const ids = doomed.map((p) => p.key);
      if (ids.includes(photo.current()?.id)) photo.shut();
      await store.remove(ids);
      const r = roll(), used = await store.usage();
      this.setState({ photos: r.photos.length ? r.photos : this.demo, shoots: r.photos.length ? r.shoots : null, idx: r.photos.length ? 0 : 6, filter: 'All', armed: 0, used });
    };
    return {
      title: S.view === 'grid' ? 'Library' : real ? shoots[cur.shoot] : ['Old town', 'Coast', 'Home'][cur.shoot], subtitle: S.view === 'grid' ? (S.cullMode ? 'Culling on · tap a photo to start there' : armed ? `Delete ${doomed.length} photo${doomed.length === 1 ? '' : 's'} from this phone for good? Tap again` : doomed.length ? `${doomed.length} reject${doomed.length === 1 ? '' : 's'} · tap here to delete ${doomed.length === 1 ? 'it' : 'them'} from this phone` : `${shown.length} of ${n} photos · ${shoots.length} ${real ? (shoots.length === 1 ? 'day' : 'days') : 'shoots'}${gb}`) : real ? fname(cur) : `DSCF0${cur.n}.RAF · ${cur.sim === 'AC' ? 'Acros' : cur.sim === 'CN' ? 'Classic Neg' : cur.sim === 'PV' ? 'Provia' : cur.sim === 'VV' ? 'Velvia' : 'Classic Chrome'}`,
      subTap, subInk: armed ? '#e8202a' : doomed.length ? '#c9d0d8' : '#8b95a1', subRole: doomed.length ? 'button' : null,
      isGrid: S.view === 'grid', isCull: S.view === 'cull', groups, cols: S.cols,
      importing: S.importing, toggleImport: () => set({ importing: !S.importing, progress: null }),
      sources: [{ glyph: '▦', name: 'Choose photos', note: 'Pick RAFs or JPEGs from the phone’s files', pick: choose },
        { glyph: '▣', name: 'From a card or the camera', note: 'Plug in the SD reader or the X-E5 by USB-C, then pick its DCIM folder', pick: this.app ? choose : () => runImport('Copying from the card') },
        this.app ? { glyph: '↻', name: 'Watch a folder', note: 'Later: Chrome on Android cannot watch a folder yet', pick: () => {} }
          : { glyph: '↻', name: 'Watch a folder', note: 'New RAFs in a chosen folder come in by themselves when the app opens', pick: () => runImport('Checking the folder') }],
      progress: !!pr, progText: pr ? (pr.k < pr.total ? `${pr.label}…` : pr.done || 'Done · 64 photos in Today') : '', progCount: pr ? `${pr.k} / ${pr.total}` : '', progPct: pr ? Math.round((pr.k / pr.total) * 100) : 0,
      filters: Object.keys(tests).map((f) => ({ label: f.toUpperCase(), count: String(P.filter(tests[f]).length), current: String(f === S.filter),
        ink: f === S.filter ? '#f2efe8' : '#7d8187', dot: f === S.filter ? '#e8202a' : 'transparent', countInk: f === S.filter ? '#e8202a' : '#5d6166', pick: () => set({ filter: f }) })),
      toCull: () => set({ cullMode: !S.cullMode }), cullOn: String(S.cullMode),
      cullDot: S.cullMode ? '#e8202a' : '#4f5357', cullGlow: S.cullMode ? '0 0 6px rgba(232,32,42,0.7)' : 'none', cycleSort: () => set({ sort: (S.sort + 1) % 3 }), sortName: `${sorts[S.sort]} ▾`,
      cycleSize: () => set({ cols: S.cols === 3 ? 4 : S.cols === 4 ? 2 : 3 }), sizeGlyph: S.cols === 4 ? '▦' : S.cols === 2 ? '◫' : '▤',
      cur: { ...curT, meta: `${S.idx + 1} / ${n} · ${cur.sim}` },
      strip: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => { const p = P[Math.max(0, Math.min(n - 1, S.idx + d))]; const out = S.idx + d < 0 || S.idx + d >= n;
        return { src: p.src, pos: p.pos, filter: p.filter, ringW: d === 0 ? 2 : 0, lift: d === 0 ? 0 : 3, o: out ? 0 : d === 0 ? 1 : p.flag === 'reject' ? 0.3 : 0.65 }; }),
      rollName: shoots[cur.shoot].split(' · ')[1] ?? shoots[cur.shoot], pos: String(S.idx + 1), total: String(n),
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
