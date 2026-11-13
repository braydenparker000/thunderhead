// @ts-nocheck
// The LibraryPlate board, as designed (docs/design/editor/boards/LibraryPlate.dc.html.dc.html). Once photos are
// imported (app/store.js: Choose photos copies RAFs onto the phone) it shows them, grouped by day, with the
// camera's JPEG as each tile, and a tile opens that photo in the editor. In the app with none yet it says so and
// offers the import; only a screen of the design on its own (/lab/editor/screens/) plays the design's roll.
import { DCLogic } from '../dc.js';
import * as store from '../app/store.js';
import * as photo from '../app/session.js';
import * as clip from '../app/clip.js';
import { stackOn } from '../app/stack.js';
import { cancelled, cutOff, presets, saveMany } from '../app/save.js';
import * as backup from '../app/backup.js';

const DAY = (/** @type {number} */ t) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return today ? 'TODAY' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase(); };
/** The stored photos as the board's roll. */
/** What Find reads of a photo, in small letters: its name, what kind of file it is, the camera, the lens, how it
 * was shot (iso 3200, f/5.6, 23mm, 1/250), the day it was taken (2026-03-14, march) and its flag.
 * @param {import('../app/store.js').Photo} p */
function words(p) {
  const s = p.shot, d = new Date(p.taken), two = (/** @type {number} */ n) => String(n).padStart(2, '0'), t = s?.time || 0;
  return [p.name, p.kind || 'raf', s?.camera, s?.lens, s?.iso ? `iso ${s.iso} iso${s.iso}` : '', s?.f ? `f/${+s.f.toFixed(1)} f${+s.f.toFixed(1)}` : '', s?.mm ? `${Math.round(s.mm)}mm ${Math.round(s.mm)} mm` : '',
    t ? (t >= 0.4 ? `${+t.toFixed(1)}s` : `1/${Math.round(1 / t)}`) : '', `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, d.toLocaleDateString('en-US', { month: 'long' }), p.flag === 'none' ? '' : p.flag, p.edited ? 'edited' : '']
    .filter(Boolean).join(' ').toLowerCase();
}
function roll() {
  const real = store.photos(), days = [...new Set(real.map((p) => DAY(p.taken)))];
  return { shoots: days, photos: real.map((p, i) => ({ id: i, key: p.id, name: p.name, src: store.urlNow(p.id), pos: '50% 50%', zoom: '1', sim: '', filter: 'none',
    rating: p.rating, flag: p.flag, edited: !!p.edited, shoot: days.indexOf(DAY(p.taken)), words: words(p) })) };
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
    this.app = document.body.dataset.board === 'App';
    this.demo = this.app ? [] : photos;   // shown again if every photo is deleted (the app: none, and it says so)
    const real = store.photos().length || this.app ? roll() : null;
    this.state = { view: 'grid', cullMode: false, filter: 'All', find: '', sort: 0, cols: 3, idx: real ? 0 : 6, photos: real ? real.photos : photos, shoots: real?.shoots || null, importing: false, progress: null, skip: false, spin: 0 };
    this.drag = null;
    // a photo's tile follows its edit, so the roll is read again when the open photo changes; and what the photos take on this phone
    this.keep('Library', ['filter', 'find', 'sort', 'cols']);
    const hear = () => { if (this._host?.stale) { photo.events.removeEventListener('change', hear); return; } if (this.state.shoots) { const r = roll(), some = r.photos.length > 0 || this.app; this.setState({ photos: some ? r.photos : this.demo, shoots: some ? r.shoots : null, idx: some ? Math.max(0, Math.min(this.state.idx, r.photos.length - 1)) : 6 }); } };
    photo.events.addEventListener('change', hear);
    addEventListener('th-editor-photos', hear, { once: true });   // photos from before their shooting data was kept got it, and with it their place by the camera's clock (app/store.js)
    if (this.app) store.usage().then((used) => this.setState({ used }), () => {});
    // an export the page did not live to finish is offered again, once (app/save.js)
    const cut = this.app ? cutOff() : null;
    if (cut) this.state.cut = cut;
    // Backup to Drive (app/backup.js): an extra. What there is to back up is read here, with no network.
    if (this.app) backup.state().then((b) => { if (!this._host?.stale) this.setState({ backup: b }); }, () => {});
    // the Import sheet goes away at a tap anywhere outside it (the tap does nothing else); its own key toggles it
    const outside = (e) => {
      if (this._host?.stale) { document.removeEventListener('click', outside, true); return; }
      if (!e.isTrusted || !this.state.importing || e.target.closest?.('[role=dialog], [aria-expanded]')) return;   // (a click made by the page, as an export's download, is no tap)
      e.stopPropagation(); e.preventDefault(); this.setState({ importing: false, progress: null });
    };
    document.addEventListener('click', outside, true);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), P = S.photos;
    const real = !!S.shoots, shoots = S.shoots || ['TODAY · OLD TOWN', 'NOV 7 · COAST', 'NOV 2 · HOME'];
    const fname = (p) => p.name || `DSCF0${p.n}.RAF`;
    const tests = { All: () => true, Picks: (p) => p.flag === 'pick', Rated: (p) => p.rating > 0, Edited: (p) => p.edited, Rejects: (p) => p.flag === 'reject' };
    // Find: every word typed must be somewhere in what is known of the photo (words, above)
    const asked = String(S.find || '').toLowerCase().split(/\s+/).filter(Boolean), found = (p) => !asked.length || asked.every((w) => (p.words ?? fname(p).toLowerCase()).includes(w));
    const shown = P.filter(tests[S.filter]).filter(found);
    const sorts = ['NEWEST', 'OLDEST', 'RATING'];
    const order = (list) => S.sort === 1 ? [...list].reverse() : S.sort === 2 ? [...list].sort((a, b) => b.rating - a.rating) : list;
    const tile = (p) => ({ src: p.src, aria: `${photo.stem(fname(p))}${p.rating ? `, ${p.rating} stars` : ''}${p.flag !== 'none' ? `, ${p.flag}` : ''}`,
      pos: p.pos, zoom: p.zoom, filter: p.filter, sim: p.sim, simShow: p.sim ? 'block' : 'none', stars: '★'.repeat(p.rating), edited: p.edited ? '#e8202a' : 'transparent',
      flag: p.flag === 'pick' ? '⚑' : p.flag === 'reject' ? '✕' : '', flagInk: p.flag === 'reject' ? '#e8202a' : '#f2efe8', dim: p.flag === 'reject' ? 0.45 : 1,
      // CULL on: a photo opens culling at it; off: it opens in the editor (the app takes editor:open)
      open: () => { if (S.cullMode) { set({ view: 'cull', idx: p.id }); return; } if (p.key) photo.open(p.key); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' })); } });
    const groups = S.sort === 2 ? [{ title: 'BY RATING', count: String(shown.length), items: order(shown).map(tile) }]
      : (S.sort === 1 ? shoots.map((_, i) => i).reverse() : shoots.map((_, i) => i)).map((g) => ({ title: shoots[g], count: String(shown.filter((p) => p.shoot === g).length), items: order(shown.filter((p) => p.shoot === g)).map(tile) })).filter((g) => g.items.length);
    const n = P.length, cur = P[Math.max(0, Math.min(S.idx, n - 1))] || { id: -1, name: ' ', src: '', pos: '50% 50%', zoom: '1', sim: '', filter: 'none', rating: 0, flag: 'none', shoot: 0 };   // none at all: an empty stand-in
    const curT = tile(cur);
    const step = (from, dir) => { let i = from; do { i += dir; } while (S.skip && i >= 0 && i < n && P[i].flag === 'reject'); return i < 0 || i >= n ? from : i; };
    // (a rating or flag the phone would not keep: the screen goes back to what the phone holds)
    const setPhoto = (patch) => { if (cur.key) store.update(cur.key, patch).catch((e) => { console.warn('photo not updated', e); const r = roll(); this.setState({ photos: r.photos, shoots: r.shoots }); }); set({ photos: P.map((p) => (p.id === cur.id ? { ...p, ...patch } : p)) }); };
    const RD = 240, PERIOD = 360 / 72, frac = ((((-S.spin) / PERIOD) % 1) + 1) % 1;
    const span = 328, fx = (i) => 22 + (n > 1 ? (i / (n - 1)) * span : 0);
    const runImport = (label) => {
      let k = 0; const total = 64;
      set({ progress: { label, k, total } });
      const tick = () => { k = Math.min(total, k + 8); this.setState({ progress: { label, k, total } }); if (k < total) setTimeout(tick, 220); };
      setTimeout(tick, 220);
    };
    // Choose photos: the phone's file picker, then each RAF or JPEG copied onto the phone with the real count
    const choose = () => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.raf,.RAF,image/x-fuji-raf,.jpg,.jpeg,.JPG,.JPEG,image/jpeg' });
      input.onchange = async () => {
        const files = [...(input.files || [])];
        this.setState({ progress: { label: 'Copying to this phone', k: 0, total: files.length } });
        const { added, had, bad } = await store.add(files, (k, total) => this.setState({ progress: { label: 'Copying to this phone', k, total } }));
        const r = roll(), n = added + had + bad;
        this.setState({ photos: r.photos, shoots: r.shoots, idx: 0, used: await store.usage(), progress: { label: 'Copying to this phone', k: n, total: n, done: `Done · ${added} photo${added === 1 ? '' : 's'} copied${had ? ` · ${had} already here` : ''}${bad ? ` · ${bad} could not be read` : ''}` } });
      };
      input.click();
    };
    // Back up to Drive: the originals not there yet (Photos' own import) and the edits that changed
    const B = S.backup, mb = (/** @type {number} */ n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`), count = (/** @type {number} */ k, /** @type {string} */ w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const cell = /** @type {any} */ (navigator).connection?.type === 'cellular';
    const backupNote = !B ? 'Your originals and edits, kept in your Google Drive' : !B.signedIn ? 'Sign in on the home screen first. The editor works without it'
      : !B.originals.length && !B.edits.length ? 'Everything here is in your Drive'
      : [B.originals.length ? `${count(B.originals.length, 'original')} (${mb(B.bytes)})` : '', B.edits.length ? count(B.edits.length, 'edit') : ''].filter(Boolean).join(' and ') + ` to back up${cell && B.originals.length ? ' · you are on mobile data' : ''}`;
    // Photos' page does it (the one page that may reach Drive) and comes straight back
    const backUp = () => { if (B?.signedIn && (B.originals.length || B.edits.length)) location.assign('/photos/?backup'); };
    // One thing done to every photo shown (app/clip.js, app/save.js): paste the copied edit, match them to the open
    // photo, export them. Each is two taps, the second within 5 s, and each photo is opened in turn.
    const all = real && this.app && S.view === 'grid' ? shown.filter((p) => p.key).map((p) => p.key) : [], open = photo.current(), held = all.length ? clip.held() : null, kinds = presets().filter((x) => x.on);
    const armedFor = Date.now() - (S.manyAt || 0) < 5000 ? S.manyKey : '', of = `${count(all.length, 'photo')} shown${S.filter === 'All' ? '' : ` (${S.filter})`}${asked.length ? ` for “${asked.join(' ')}”` : ''}`;
    const many = (/** @type {string} */ key, /** @type {string} */ label, /** @type {(step: (k: number, n: number, part?: number) => void) => Promise<string>} */ run) => async () => {
      if (S.working) return;
      if (armedFor !== key) { set({ manyKey: key, manyAt: Date.now() }); setTimeout(() => this.setState({}), 5100); return; }
      const n = all.length;
      this.setState({ manyAt: 0, working: true, progress: { label, k: 0, total: n } });
      // Cancel (export only) gives the photo in hand up and says what was saved before it: the Library is then as it was
      const done = await run((k, total, part) => { if (!this.stop?.signal.aborted) this.setState({ progress: { label, k, total, part } }); }).catch((e) => (cancelled(e) ? e : `It stopped: ${e?.message || e}`));
      const off = typeof done === 'string' ? null : done, k = off ? off.done || 0 : n;
      this.stop = null;
      this.setState({ working: false, progress: { label, k, total: n, done: off ? `Export cancelled · ${off.done ? `${count(off.files || 0, 'file')} from ${count(off.done, 'photo')} in Downloads` : 'nothing was saved'}` : done } });
    };
    const row = (/** @type {string} */ key, /** @type {string} */ glyph, /** @type {string} */ name, /** @type {string} */ ask, /** @type {string} */ note, /** @type {() => void} */ pick) => ({ glyph, name: armedFor === key ? `${ask} Tap again` : name, note, pick });
    const rows = !all.length ? [] : [
      ...(held ? [row('paste', '⎘', 'Paste the copied edit', `Paste on ${count(all.length, 'photo')}?`, `${photo.stem(held.name)}’s edit, onto the ${of} · each can undo it`,
        many('paste', 'Pasting the edit', async (step) => { const r = await clip.pasteOn(all, step); return `Done · pasted on ${count(r.done, 'photo')}${r.bad ? ` · ${r.bad} could not be opened` : ''}`; }))] : []),
      ...(open && all.some((id) => id !== open.id) ? [row('match', '≈', 'Match the photos shown to the open one', `Match ${count(all.length, 'photo')}?`, `${photo.stem(open.name)}’s white balance, and its brightness by how each was shot, for the ${of} · each can undo it`,
        many('match', 'Matching', async (step) => { const r = await clip.matchOn(all, step); return `Done · matched ${count(r.done, 'photo')}${r.plain ? ` · ${r.plain} white balance only (no shooting data)` : ''}${r.bad ? ` · ${r.bad} left as they were` : ''}`; }))] : []),
      ...(all.length >= 2 && all.length <= 64 && all.every((id) => !store.photos().find((p) => p.id === id)?.kind) ? [row('stack', '≡', 'Stack the photos shown', `Stack ${count(all.length, 'frame')}?`, `Frames of one scene from a tripod, made one new photo: shot alike, less noise; a bracket, the range of all (HDR). The ${of} · the frames stay`,
        many('stack', 'Stacking', async (step) => { const r = await stackOn(all, step), left = [r.moved ? `${count(r.moved, 'frame')} had moved` : '', r.differ ? `${r.differ} shot otherwise` : '', r.bad ? `${r.bad} could not be read` : ''].filter(Boolean).join(' · ');
          return r.id ? `Done · ${r.name} is in the Library${left ? ` · left out: ${left}` : ''}` : `Not stacked: fewer than two frames lie on each other${left ? ` (${left})` : ''}`; }))] : []),
      row('export', '⇪', 'Export the photos shown', `Export ${count(all.length, 'photo')}?`, kinds.length ? `${kinds.map((x) => `${x.name} ${x.fmt}`).join(' and ')} of each of the ${of}, to Downloads · the files are set on the Export board` : 'Both files are off on the Export board',
        kinds.length ? many('export', 'Exporting', async (step) => { const r = await saveMany(all, step, (this.stop = new AbortController()).signal); return `Done · ${count(r.files, 'file')} from ${count(r.done, 'photo')} in Downloads${r.bad ? ` · ${r.bad} could not be opened` : ''}`; }) : () => {})];
    const pr = S.progress;
    // the phone's storage, and deleting rejects for good: the subtitle says and does both (two taps, the second within 5 s)
    const gb = S.used ? ` · ${S.used >= 1e9 ? (S.used / 1e9).toFixed(1) + ' GB' : Math.round(S.used / 1e6) + ' MB'} on this phone${real && !store.kept() ? ', which Chrome may clear if space runs low' : ''}` : '';
    const doomed = real && S.view === 'grid' && S.filter === 'Rejects' ? shown.filter((p) => p.key) : [], armed = doomed.length > 0 && Date.now() - (S.armed || 0) < 5000;
    const subTap = async () => {
      if (S.cut && S.view === 'grid') { set({ cut: null }); photo.open(S.cut.id); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Export' })); return; }
      if (!doomed.length) return;
      if (!armed) { set({ armed: Date.now() }); setTimeout(() => this.setState({}), 5100); return; }
      const ids = doomed.map((p) => p.key);
      if (ids.includes(photo.current()?.id)) photo.shut();
      await store.remove(ids);
      const r = roll(), used = await store.usage();
      const some = r.photos.length > 0 || this.app;
      this.setState({ photos: some ? r.photos : this.demo, shoots: some ? r.shoots : null, idx: some ? 0 : 6, filter: 'All', armed: 0, used });
    };
    return {
      title: S.view === 'grid' ? 'Library' : real ? shoots[cur.shoot] : ['Old town', 'Coast', 'Home'][cur.shoot], subtitle: S.view === 'grid' ? (S.cut ? `The export of ${photo.stem(S.cut.name)} did not finish · tap here to open it again` : S.cullMode ? 'Culling on · tap a photo to start there' : armed ? `Delete ${doomed.length} photo${doomed.length === 1 ? '' : 's'}? Tap again · they can be brought back for ${store.KEEP_DAYS} days` : doomed.length ? `${doomed.length} reject${doomed.length === 1 ? '' : 's'} · tap here to delete ${doomed.length === 1 ? 'it' : 'them'} from this phone` : real && !n ? 'Your RAFs and JPEGs, kept on this phone' : `${shown.length} of ${n} photos · ${shoots.length} ${real ? (shoots.length === 1 ? 'day' : 'days') : 'shoots'}${gb}`) : real ? fname(cur) : `DSCF0${cur.n}.RAF · ${cur.sim === 'AC' ? 'Acros' : cur.sim === 'CN' ? 'Classic Neg' : cur.sim === 'PV' ? 'Provia' : cur.sim === 'VV' ? 'Velvia' : 'Classic Chrome'}`,
      subTap, subInk: armed ? '#e8202a' : doomed.length || S.cut ? '#c9d0d8' : '#8b95a1', subRole: doomed.length || S.cut ? 'button' : null,
      isGrid: S.view === 'grid', isCull: S.view === 'cull', groups,
      // nothing to show: none on the phone yet (the app), or none that the filter and Find let through
      empty: S.view === 'grid' && !shown.length && !S.importing, emptyTitle: n ? 'No photos match' : 'No photos yet',
      emptyNote: n ? (asked.length ? `Nothing for “${asked.join(' ')}”${S.filter === 'All' ? '' : ` in ${S.filter}`} · clear Find${S.filter === 'All' ? '' : ' or show ALL'}` : `None in ${S.filter} yet · show ALL`) : 'Import brings RAFs and JPEGs from the phone’s files. They stay on this phone.',
      canChoose: !n && this.app, choose, cols: S.cols, find: S.find || '', onFind: (e) => set({ find: e.target.value }),
      importing: S.importing, toggleImport: () => set({ importing: !S.importing, progress: null }),
      sources: [{ glyph: '▦', name: 'Choose photos', note: 'Pick RAFs or JPEGs from the phone’s files', pick: choose },
        ...(this.app && B ? [{ glyph: '☁', name: 'Back up to Drive', note: backupNote, pick: backUp }] : []),   // (once what there is to back up is known: until then a tap would do nothing)
        ...rows,
        // deleted lately: still on the phone, and back with their edits at a tap; or gone now, to free their room (two taps)
        ...(this.app && store.deleted().length ? [{ glyph: '↺', name: `Bring back ${count(store.deleted().length, 'deleted photo')}`, note: `Deleted in the last ${store.KEEP_DAYS} days · they come back with their edits`, pick: async () => { await store.restore(); const r = roll(); this.setState({ photos: r.photos, shoots: r.shoots, filter: 'All', used: await store.usage() }); } },
          { glyph: '✕', name: 'Empty the deleted photos', note: Date.now() - (S.emptying || 0) < 5000 ? `Tap again: ${count(store.deleted().length, 'photo')} will be gone for good` : 'Frees their room on this phone now · this cannot be undone',
            pick: async () => { if (Date.now() - (S.emptying || 0) >= 5000) { set({ emptying: Date.now() }); setTimeout(() => this.setState({}), 5100); return; } await store.empty(); this.setState({ emptying: 0, used: await store.usage() }); } }] : []),
        { glyph: '▣', name: 'From a card or the camera', note: 'Plug in the SD reader or the X-E5 by USB-C, then pick its DCIM folder', pick: this.app ? choose : () => runImport('Copying from the card') },
        // watching a folder is the design's: Chrome on Android cannot watch one yet, so the app does not offer it
        ...(this.app ? [] : [{ glyph: '↻', name: 'Watch a folder', note: 'New RAFs in a chosen folder come in by themselves when the app opens', pick: () => runImport('Checking the folder') }])],
      progress: !!pr, // (the app says Done in its own words, once it is: the sample's line showed for a moment after the last file)
      stoppable: !!S.working && !!this.stop && !this.stop.signal.aborted, stopMany: () => { this.stop?.abort(); this.setState({}); },
      progText: pr ? (pr.done && this.app ? pr.done : pr.k < pr.total || this.app ? `${pr.label}…` : pr.done || 'Done · 64 photos in Today') : '', progCount: pr ? `${pr.k} / ${pr.total}` : '', progPct: pr ? Math.round(((pr.k + (pr.part || 0)) / pr.total) * 100) : 0,
      filters: Object.keys(tests).map((f) => ({ label: f.toUpperCase(), count: String(P.filter(found).filter(tests[f]).length), current: String(f === S.filter),
        ink: f === S.filter ? '#f2efe8' : '#7d8187', dot: f === S.filter ? '#e8202a' : 'transparent', countInk: f === S.filter ? '#e8202a' : '#5d6166', pick: () => set({ filter: f }) })),
      toCull: () => set({ cullMode: !S.cullMode }), cullOn: String(S.cullMode),
      cullDot: S.cullMode ? '#e8202a' : '#4f5357', cullGlow: S.cullMode ? '0 0 6px rgba(232,32,42,0.7)' : 'none', cycleSort: () => set({ sort: (S.sort + 1) % 3 }), sortName: `${sorts[S.sort]} ▾`,
      cycleSize: () => set({ cols: S.cols === 3 ? 4 : S.cols === 4 ? 2 : 3 }), sizeGlyph: S.cols === 4 ? '▦' : S.cols === 2 ? '◫' : '▤',
      cur: { ...curT, meta: [`${S.idx + 1} / ${n}`, cur.sim].filter(Boolean).join(' · ') },
      strip: !n ? [] : [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => { const p = P[Math.max(0, Math.min(n - 1, S.idx + d))]; const out = S.idx + d < 0 || S.idx + d >= n;
        return { src: p.src, pos: p.pos, filter: p.filter, ringW: d === 0 ? 2 : 0, lift: d === 0 ? 0 : 3, o: out ? 0 : d === 0 ? 1 : p.flag === 'reject' ? 0.3 : 0.65 }; }),
      rollName: (shoots[cur.shoot] || '').split(' · ')[1] ?? shoots[cur.shoot] ?? '', pos: String(S.idx + 1), total: String(n),
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
      // EDIT ›: the photo on screen, in the editor (the app takes editor:open)
      toEdit: () => { if (cur.key) photo.open(cur.key); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' })); },
      toGrid: () => set({ view: 'grid' }), skip: String(S.skip), skipDot: S.skip ? '#e8202a' : '#4f5357', toggleSkip: () => set({ skip: !S.skip }), noop: () => {},
    };
  }
}
