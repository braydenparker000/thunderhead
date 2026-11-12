// @ts-nocheck
// The ViewTools board, as designed (docs/design/editor/boards/ViewTools.dc.html.dc.html). With a photo open it is
// real. The photo zooms (app/zoom.js). Compare lays the photo as imported over the left of the line, and a press
// and hold shows all of it. The histogram and the clipping overlay are read from the photo as it looks
// (app/scope.js). History lists the steps the edit took and goes back to one; Versions are edits kept by name
// (app/past.js). With no photo open it plays the design's sample.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as clip from '../app/clip.js';
import * as zoom from '../app/zoom.js';
import { scope } from '../app/scope.js';
import { tile } from '../app/tiles.js';

const SAMPLE = '/lab/editor/assets/sample.jpg';
const SCOPE = { r: 'M8 66 C20 64 26 40 38 44 S58 20 70 30 S92 12 104 24 S130 50 142 40 S154 30 160 62 L160 66Z', g: 'M8 66 C22 62 30 46 42 38 S62 26 76 22 S96 30 108 34 S132 42 144 48 S154 52 160 64 L160 66Z',
  b: 'M8 66 C16 50 26 22 40 26 S60 44 74 40 S98 28 112 40 S138 58 150 60 S156 64 160 66Z', lo: '0.4%', hi: '1.2%', clip: '' };

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { mode: 'compare', hist: true, clip: false, step: 7, ver: 1, split: 206, zoom: false, cx: 0.62, cy: 0.38, holding: false };
    this.drag = null; this.lastTap = 0; this.pts = new Map(); this.pinch = null;
    this.keep('View', ['mode', 'hist', 'clip', 'split']);
    const hear = () => { if (this._host?.stale) photo.events.removeEventListener('change', hear); else this.setState({}); };
    photo.events.addEventListener('change', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o), real = photo.current();
    const steps = [['Imported', 'RAF'], ['Look · Kodachrome 64', '100%'], ['Exposure', '+0.35'], ['Highlights', '−48'], ['Shadows', '+31'], ['Crop', '3:2'], ['Mask · Sky', '−0.40 EV'], ['Clarity', '+8']];
    const looks = ['none', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg)', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.06)', 'contrast(1.05) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.04)',
      'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.04) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)', 'contrast(1.12) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)'];
    const vers = [['Original', 'none'], ['Kodachrome', looks[S.step]], ['Tri-X', 'grayscale(1) contrast(1.35)'], ['Warm', 'saturate(1.15) sepia(0.28) brightness(1.04)']];
    const after = S.holding ? 'none' : S.ver === 1 ? looks[S.step] : vers[S.ver][1];
    // the photo's box in its area: the sample's is the design's (100% about 7x the fitted photo); a photo's own comes from zoom.js
    const box = real ? zoom.fitted() : null, zi = real ? zoom.info() : null, zoomed = real ? zi.on : S.zoom;
    // the panel grows for the history's row and the versions' strip, and the photo's room gives way: nothing lies over the photo
    const now = real && zoomed ? 'zoom' : S.mode, more = now === 'versions' ? 96 : now === 'history' ? 50 : 0, plateH = 125 + more;
    const AW = 412, AH = 738 - more, baseW = box ? box.width : 412, baseH = box ? box.height : 275, Z = 7;
    const imW = !real && S.zoom ? baseW * Z : baseW, imH = !real && S.zoom ? baseH * Z : baseH;
    const fitc = (c, size, area) => (size <= area ? 0.5 : Math.max(area / 2 / size, Math.min(1 - area / 2 / size, c)));
    const cx = fitc(S.cx, imW, AW), cy = fitc(S.cy, imH, AH);
    const imL = box ? box.left : S.zoom ? AW / 2 - cx * imW : 0, imT = box ? box.top : S.zoom ? AH / 2 - cy * imH : (AH - baseH) / 2;
    const split = S.mode === 'compare' && !zoomed, splitRel = Math.max(0, Math.min(baseW, S.split - imL));
    const go = (z, x, y) => set({ zoom: z, mode: z ? 'zoom' : S.mode === 'zoom' ? null : S.mode, cx: z ? (x - imL) / imW + (AW / 2 - x) / (baseW * Z) : S.cx, cy: z ? (y - imT) / imH + (AH / 2 - y) / (baseH * Z) : S.cy });
    const mode = (m) => {
      if (!real) return set({ mode: S.mode === m ? null : m, zoom: m === 'zoom' ? S.mode !== 'zoom' : false });
      if (m === 'zoom' || zoomed) zoom.toggle();   // the 100% key, or a tool that wants the whole photo back
      if (m !== 'zoom') set({ mode: S.mode === m && !zoomed ? null : m });
    };
    const shownMode = real ? (zoomed ? 'zoom' : S.mode) : S.mode;
    const hints = {
      compare: 'BEFORE / AFTER · drag the line. Anywhere else, press and hold the photo to see the original.',
      zoom: '100% · drag to look around; the red box shows where you are. Double-tap the photo to go in and out, or pinch.',
      history: 'HISTORY · tap a step to go back to it; the next edit starts a new branch from there. Long-press Undo opens this too.',
      versions: 'VERSIONS · different edits of one photo, without copies of the RAF. + keeps the current edit as a new one. Copy takes it to other photos.',
    };
    if (real) Object.assign(hints, { zoom: `${zi.pct}% · drag to look around; the red box shows where you are. Pinch for more or less, up to 300%; double-tap goes in and out.`,
      compare: 'BEFORE / AFTER · drag the line. Anywhere else, press and hold the photo to see it as imported.', history: 'HISTORY · tap a step to go back to it; the next edit starts a new branch from there. Undo steps back one.' });
    // a photo's own: the picture before any edit, its scope, its history and its versions
    const first = real ? photo.versions()[0] : null, beforeSrc = first && !zoomed && (split || S.holding) ? tile('before:', first.st, 0) : '';
    const sc = !S.hist ? null : real ? scope() : SCOPE;
    if (real) zoom.clip(sc && S.clip ? sc.clip : '');
    const past = real ? photo.history() : null;
    const stepList = past ? past.steps.map((s, i) => [s.name, s.val, i === past.at, i > past.at, () => photo.goto(i)]) : steps.map(([name, val], i) => [name, val, i === S.step, i > S.step, () => set({ step: i, ver: 1 })]);
    const verList = real ? photo.versions().map((v, i) => ({ name: v.name, src: tile(`ver:${JSON.stringify(v.st)}`, v.st, 152), filter: 'none', sel: v.on, pick: () => photo.version(i) })).concat([{ name: 'New', glyph: '+', pick: () => photo.keep() }, { name: 'Copy edit', glyph: '⎘', pick: () => set({ said: clip.copy() ? 'Copied. Open another photo and Paste it here, or paste it on many from the Library’s Import sheet.' : '' }) },
        // the compare page: this photo made every way the engine has, side by side (lab/editor/compare/)
        { name: 'Compare', glyph: '◫', pick: () => { const id = photo.current()?.id; if (id) photo.saveNow().finally(() => location.assign(`/lab/editor/compare/?open=${encodeURIComponent(id)}`)); } },
        ...(clip.held() ? [{ name: 'Paste edit', glyph: '⇣', pick: () => set({ said: clip.paste() ? `Pasted the edit from ${photo.stem(clip.held()?.name || '')}. Undo takes it off.` : 'That edit is on this photo already.' }) }] : [])])
      : vers.concat([['New', '']]).map(([name, f], i) => ({ name, src: SAMPLE, filter: f || 'none', sel: i === S.ver, pick: () => (name === 'New' ? null : set({ ver: i })) }));
    // the history's row comes to the step the photo is at, when it opens and when that step changes
    const here = shownMode === 'history' ? stepList.findIndex((x) => x[2]) : -1;
    if (here !== this.here) { this.here = here; if (here >= 0) requestAnimationFrame(() => { const row = this._host?.el.querySelector('[role=list][aria-label=History]'), b = row?.children[here]; if (b) row.scrollTo({ left: b.offsetLeft - (row.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' }); }); }
    const secs = (what, t) => (t > 0 ? ` · ${what} ${t < 10 ? t.toFixed(1) : Math.round(t)} s` : '');   // the photo's own waits, to read off the phone
    return {
      real: !!real, demo: !real, fileName: real ? photo.stem(real.name) : 'DSCF0412', shotLine: real ? photo.kindLine() + secs('opened in', photo.took.open) + secs('sharp in', photo.took.detail) : '23 mm · f/5.6 · 1/250 · ISO 160',
      hist: !!sc, histInk: S.hist ? '#e8202a' : '#a6b0bc', tHist: () => set({ hist: !S.hist }), clip: S.clip && !!sc, clipDemo: S.clip && !!sc && !real, clipInk: S.clip ? '#e8202a' : '#c9d0d8', tClip: () => set({ clip: !S.clip }),
      hR: sc?.r, hG: sc?.g, hB: sc?.b, clipLo: sc?.lo, clipHi: sc?.hi, histMeta: S.clip ? 'clipping shown' : 'tap ▲ for clipping',
      history: shownMode === 'history', historyInk: shownMode === 'history' ? '#e8202a' : '#a6b0bc', tHistory: () => mode('history'),
      steps: stepList.map(([name, val, cur, ahead, pick]) => ({ name, val, cur: String(cur), bg: cur ? 'rgba(232,32,42,0.2)' : 'transparent', dot: cur ? '#e8202a' : ahead ? '#5d6166' : '#f2efe8', o: ahead ? 0.45 : 1, pick })),
      versions: shownMode === 'versions', plateTop: 915 - plateH, photoH: 915 - 52 - plateH, hintTop: 56 + more,
      vers: verList.map((v) => (v.glyph || v.name === 'New' ? { name: v.name, glyph: v.glyph || '+', pick: v.pick } : { name: v.name, src: v.src || SAMPLE, filter: v.filter || 'none', on: !!v.sel, pick: v.pick })),
      after, imL, imT, imW, imH, imTr: this.drag ? 'none' : 'all 320ms cubic-bezier(0.2, 0.85, 0.2, 1)', pix: 'auto',
      afterW: split ? `${baseW - splitRel}px` : '100%', split, splitX: S.split, zoomed: S.zoom && !real,
      beforeOn: !!beforeSrc, beforeSrc, beforeW: S.holding ? baseW : splitRel,
      mapSrc: SAMPLE, mapW: 96, mapH: 64,
      mmL: (Math.max(0, -imL / imW) * 100).toFixed(1), mmT: (Math.max(0, -imT / imH) * 100).toFixed(1), mmW: (Math.min(1, AW / imW) * 100).toFixed(1), mmH: (Math.min(1, AH / imH) * 100).toFixed(1),
      photoAria: zoomed ? 'Photo, zoomed in. Drag to look around; double-tap to fit.' : 'Photo. Double-tap for 100%; press and hold for the original.',
      pDown: (e) => {
        const el = e.currentTarget, b = el.getBoundingClientRect(), q = AW / b.width, x = (e.clientX - b.left) * q, y = (e.clientY - b.top) * q, now = Date.now();
        this.pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (!real && el.setPointerCapture) el.setPointerCapture(e.pointerId);   // a photo's own gestures are zoom.js's, which captures for itself
        if (this.pts.size > 1) {   // a second finger: a pinch (the sample's goes in or out once)
          const [p, r] = [...this.pts.values()];
          this.drag = null; this.lastTap = 0; clearTimeout(this.holdTimer);
          this.pinch = this.pinch || { d: Math.hypot(p[0] - r[0], p[1] - r[1]), done: !!real };
          return;
        }
        if (!real && now - this.lastTap < 300) { this.lastTap = 0; go(!S.zoom, x, y); return; }
        this.lastTap = now;
        if (real && zoomed) return;
        this.drag = { x: e.clientX, y: e.clientY, cx, cy, q, onLine: split && Math.abs(x - S.split) < 40 };
        if (!zoomed && !this.drag.onLine) this.holdTimer = setTimeout(() => { if (!real || !zoom.info().on) this.setState({ holding: true }); }, 350);
      },
      pMove: (e) => {
        if (!this.pts.has(e.pointerId)) return;
        this.pts.set(e.pointerId, [e.clientX, e.clientY]);
        const [p, r] = [...this.pts.values()], pinch = this.pinch;
        if (pinch) {
          const by = r && !pinch.done ? Math.hypot(p[0] - r[0], p[1] - r[1]) / pinch.d : 1;
          if (S.zoom ? by < 0.8 : by > 1.25) { pinch.done = true; const b = e.currentTarget.getBoundingClientRect(), q = AW / b.width; go(!S.zoom, ((p[0] + r[0]) / 2 - b.left) * q, ((p[1] + r[1]) / 2 - b.top) * q); }
          return;
        }
        const d = this.drag; if (!d) return;
        const dx = (e.clientX - d.x) * d.q, dy = (e.clientY - d.y) * d.q;
        if (Math.hypot(dx, dy) > 6) { clearTimeout(this.holdTimer); this.lastTap = 0; }
        if (d.onLine) { this.setState({ split: Math.max(0, Math.min(412, S.split + dx)) }); d.x = e.clientX; return; }
        if (S.zoom && !real) this.setState({ cx: fitc(d.cx - dx / imW, imW, AW), cy: fitc(d.cy - dy / imH, imH, AH) });
      },
      pUp: (e) => {
        this.pts.delete(e.pointerId);
        if (!this.pts.size) this.pinch = null;
        this.drag = null; clearTimeout(this.holdTimer); if (this.state.holding) set({ holding: false });
      },
      modes: [['compare', 'COMPARE'], ['zoom', '100%'], ['history', 'HISTORY'], ['versions', 'VERSIONS']].map(([m, label]) => ({ label: m === 'zoom' && real && zoomed ? `${zi.pct}%` : label, on: String(shownMode === m), ink: shownMode === m ? '#f2efe8' : '#7d8187', dot: shownMode === m ? '#e8202a' : 'transparent', pick: () => mode(m) })),
      hint: S.holding ? (real ? 'Showing the photo as imported while you hold.' : 'Showing the original while you hold.') : (shownMode === 'versions' && S.said) || hints[shownMode] || 'Tap a tool above. The histogram and history also live in the header.',
    };
  }
}
