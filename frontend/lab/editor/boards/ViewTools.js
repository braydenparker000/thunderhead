// @ts-nocheck
// The ViewTools board, as designed (docs/design/editor/boards/ViewTools.dc.html.dc.html). With a photo open its
// 100 % is real (app/zoom.js): one sensor pixel to one screen pixel, the photo's own map in the corner. Compare,
// the histogram, History and Versions are still the design's samples.
import { DCLogic } from '../dc.js';
import * as photo from '../app/session.js';
import * as zoom from '../app/zoom.js';
import { tile } from '../app/tiles.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { mode: photo.current() ? null : 'compare', hist: true, clip: false, history: false, step: 7, ver: 1, split: 206, zoom: false, cx: photo.current() ? 0.5 : 0.62, cy: photo.current() ? 0.5 : 0.38, holding: false };
    this.drag = null; this.lastTap = 0; this.pts = new Map(); this.pinch = null;
    const hear = () => { if (this._host?.stale) { photo.events.removeEventListener('change', hear); removeEventListener('resize', hear); } else this.setState({}); };
    photo.events.addEventListener('change', hear); addEventListener('resize', hear);
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    const steps = [['Imported', 'RAF'], ['Look · Kodachrome 64', '100%'], ['Exposure', '+0.35'], ['Highlights', '−48'], ['Shadows', '+31'], ['Crop', '3:2'], ['Mask · Sky', '−0.40 EV'], ['Clarity', '+8']];
    const looks = ['none', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg)', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.06)', 'contrast(1.05) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.04)',
      'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.04) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)', 'contrast(1.12) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)'];
    const vers = [['Original', 'none'], ['Kodachrome', looks[S.step]], ['Tri-X', 'grayscale(1) contrast(1.35)'], ['Warm', 'saturate(1.15) sepia(0.28) brightness(1.04)']];
    const after = S.holding ? 'none' : S.ver === 1 ? looks[S.step] : vers[S.ver][1];
    // 100% = one RAF pixel per screen pixel: about 7x the fitted photo on the A35 (the sample's numbers; a photo's are its own)
    const real = photo.current(), g = real ? zoom.geometry() : null, [fw, fh] = real ? photo.shape() : [3, 2];
    const AW = 412, AH = g ? g.ah : 738, baseW = g ? g.w : 412, baseH = g ? g.h : 275, Z = g ? g.z : 7;
    const imW = S.zoom ? baseW * Z : baseW, imH = S.zoom ? baseH * Z : baseH;
    // the photo's point at the middle of the area, kept where the photo still covers it
    const fitc = (c, size, area) => (size <= area ? 0.5 : Math.max(area / 2 / size, Math.min(1 - area / 2 / size, c)));
    const cx = fitc(S.cx, imW, AW), cy = fitc(S.cy, imH, AH);
    const imL = S.zoom ? AW / 2 - cx * imW : (AW - baseW) / 2, imT = S.zoom ? AH / 2 - cy * imH : (AH - baseH) / 2;
    zoom.aim(!!real && S.zoom, imL, imT);
    const split = S.mode === 'compare' && !S.zoom && !real;
    // in or out of 100 %, the photo's point under (x, y) staying there
    const go = (z, x, y) => set({ zoom: z, mode: z ? 'zoom' : S.mode === 'zoom' ? null : S.mode, cx: z ? (x - imL) / imW + (AW / 2 - x) / (baseW * Z) : S.cx, cy: z ? (y - imT) / imH + (AH / 2 - y) / (baseH * Z) : S.cy });
    const mapW = fw >= fh ? 96 : (96 * fw) / fh, mapH = fw >= fh ? (96 * fh) / fw : 96;
    const splitRel = Math.max(0, Math.min(baseW, S.split - imL));
    const mode = (m) => set({ mode: S.mode === m ? null : m, history: m === 'history' ? S.mode !== 'history' : false, zoom: m === 'zoom' ? S.mode !== 'zoom' : false });
    const hints = {
      compare: 'BEFORE / AFTER · drag the line. Anywhere else, press and hold the photo to see the original.',
      zoom: '100% · drag to look around; the red box shows where you are. Double-tap the photo to go in and out, or pinch.',
      history: 'HISTORY · tap a step to go back to it; the next edit starts a new branch from there. Long-press Undo opens this too.',
      versions: 'VERSIONS · different edits of one photo, without copies of the RAF. + keeps the current edit as a new one.',
    };
    return {
      real: !!real, demo: !real, fileName: real ? real.name.replace(/\.RAF$/i, '') : 'DSCF0412', shotLine: real ? (real.shot.split(' · ')[0] || 'Fujifilm') + ' · RAF' : '23 mm · f/5.6 · 1/250 · ISO 160',
      mapSrc: !real ? '/lab/editor/assets/sample.jpg' : S.zoom ? tile('map:' + photo.stamp(), null, 192, {}, true) || photo.jpeg() : '', mapW: mapW.toFixed(1), mapH: mapH.toFixed(1),
      hist: S.hist && !real, histInk: S.hist && !real ? '#e8202a' : '#a6b0bc', tHist: () => set({ hist: !S.hist }), clip: S.clip && S.hist, clipInk: S.clip ? '#e8202a' : '#c9d0d8', tClip: () => set({ clip: !S.clip }),
      histMeta: S.clip ? 'clipping shown' : 'tap ▲ for clipping',
      history: S.mode === 'history', historyInk: S.mode === 'history' ? '#e8202a' : '#a6b0bc', tHistory: () => mode('history'),
      steps: steps.map(([name, val], i) => ({ name, val, cur: String(i === S.step), bg: i === S.step ? 'rgba(232,32,42,0.2)' : 'transparent', dot: i === S.step ? '#e8202a' : i < S.step ? '#f2efe8' : '#5d6166', o: i > S.step ? 0.45 : 1, pick: () => set({ step: i, ver: 1 }) })),
      versions: S.mode === 'versions',
      vers: vers.concat([['New', '']]).map(([name, f], i) => ({ name, filter: f || 'none', on: String(i === S.ver), ring: i === S.ver ? '#e8202a' : 'rgba(255,255,255,0.15)', ringW: i === S.ver ? 2 : 1, ink: i === S.ver ? '#f2efe8' : '#a6b0bc',
        imgShow: name === 'New' ? 'none' : 'block', plusShow: name === 'New' ? 'flex' : 'none', pick: () => (name === 'New' ? null : set({ ver: i })) })),
      after: real ? 'none' : after, imL, imT, imW, imH, imTr: this.drag ? 'none' : 'all 320ms cubic-bezier(0.2, 0.85, 0.2, 1)', pix: S.zoom ? 'auto' : 'auto',
      afterW: split ? `${baseW - splitRel}px` : '100%', split, splitX: S.split, zoomed: S.zoom,
      mmL: (Math.max(0, -imL / imW) * 100).toFixed(1), mmT: (Math.max(0, -imT / imH) * 100).toFixed(1), mmW: (Math.min(1, AW / imW) * 100).toFixed(1), mmH: (Math.min(1, AH / imH) * 100).toFixed(1),
      photoAria: S.zoom ? 'Photo at 100%. Drag to look around; double-tap to fit.' : 'Photo. Double-tap for 100%; press and hold for the original.',
      pDown: (e) => {
        const el = e.currentTarget, b = el.getBoundingClientRect(), q = AW / b.width, x = (e.clientX - b.left) * q, y = (e.clientY - b.top) * q, now = Date.now();
        this.pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        if (this.pts.size > 1) {   // a second finger: a pinch, which goes in or out once
          const [p, r] = [...this.pts.values()];
          this.drag = null; this.lastTap = 0; clearTimeout(this.holdTimer);
          this.pinch = this.pinch || { d: Math.hypot(p[0] - r[0], p[1] - r[1]), done: false };
          return;
        }
        if (now - this.lastTap < 300) { this.lastTap = 0; go(!S.zoom, x, y); return; }
        this.lastTap = now;
        this.drag = { x: e.clientX, y: e.clientY, cx, cy, q, onLine: split && Math.abs(x - S.split) < 40 };
        if (!S.zoom && !this.drag.onLine && !real) this.holdTimer = setTimeout(() => this.setState({ holding: true }), 350);
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
        if (S.zoom) this.setState({ cx: fitc(d.cx - dx / imW, imW, AW), cy: fitc(d.cy - dy / imH, imH, AH) });
      },
      pUp: (e) => {
        this.pts.delete(e.pointerId);
        if (!this.pts.size) this.pinch = null;
        this.drag = null; clearTimeout(this.holdTimer); if (this.state.holding) set({ holding: false });
      },
      modes: [['compare', 'COMPARE'], ['zoom', '100%'], ['history', 'HISTORY'], ['versions', 'VERSIONS']].map(([m, label]) => ({ label, on: String(S.mode === m), ink: S.mode === m ? '#f2efe8' : '#7d8187', dot: S.mode === m ? '#e8202a' : 'transparent', pick: () => mode(m) })),
      hint: S.holding ? 'Showing the original while you hold.' : real && S.mode !== 'zoom' ? 'Double-tap the photo for 100%, or pinch. Compare, the histogram, History and Versions are samples for now.' : hints[S.mode] || 'Tap a tool above. The histogram and history also live in the header.',
    };
  }
}
