// @ts-nocheck
// The ViewTools board, as designed (docs/design/editor/boards/ViewTools.dc.html.dc.html): its logic, unchanged.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { mode: 'compare', hist: true, clip: false, history: false, step: 7, ver: 1, split: 206, zoom: false, cx: 0.62, cy: 0.38, holding: false };
    this.drag = null; this.lastTap = 0;
  }
  renderVals() {
    const S = this.state, set = (o) => this.setState(o);
    const steps = [['Imported', 'RAF'], ['Look · Kodachrome 64', '100%'], ['Exposure', '+0.35'], ['Highlights', '−48'], ['Shadows', '+31'], ['Crop', '3:2'], ['Mask · Sky', '−0.40 EV'], ['Clarity', '+8']];
    const looks = ['none', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg)', 'contrast(1.1) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.06)', 'contrast(1.05) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.04)',
      'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.0) saturate(0.95) sepia(0.12) hue-rotate(-8deg) brightness(1.07)', 'contrast(1.04) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)', 'contrast(1.12) saturate(0.98) sepia(0.12) hue-rotate(-8deg) brightness(1.05)'];
    const vers = [['Original', 'none'], ['Kodachrome', looks[S.step]], ['Tri-X', 'grayscale(1) contrast(1.35)'], ['Warm', 'saturate(1.15) sepia(0.28) brightness(1.04)']];
    const after = S.holding ? 'none' : S.ver === 1 ? looks[S.step] : vers[S.ver][1];
    const AW = 412, AH = 738, baseW = 412, baseH = 275, Z = 7;      // 100% = one RAF pixel per screen pixel on the A35, about 7x the fitted photo
    const imW = S.zoom ? baseW * Z : baseW, imH = S.zoom ? baseH * Z : baseH;
    const imL = S.zoom ? AW / 2 - S.cx * imW : 0, imT = S.zoom ? AH / 2 - S.cy * imH : (AH - baseH) / 2;
    const split = S.mode === 'compare' && !S.zoom;
    const splitRel = Math.max(0, Math.min(baseW, S.split - imL));
    const mode = (m) => set({ mode: S.mode === m ? null : m, history: m === 'history' ? S.mode !== 'history' : false, zoom: m === 'zoom' ? S.mode !== 'zoom' : false });
    const hints = {
      compare: 'BEFORE / AFTER · drag the line. Anywhere else, press and hold the photo to see the original.',
      zoom: '100% · drag to look around; the red box shows where you are. Double-tap the photo to go in and out, or pinch.',
      history: 'HISTORY · tap a step to go back to it; the next edit starts a new branch from there. Long-press Undo opens this too.',
      versions: 'VERSIONS · different edits of one photo, without copies of the RAF. + keeps the current edit as a new one.',
    };
    return {
      hist: S.hist, histInk: S.hist ? '#e8202a' : '#a6b0bc', tHist: () => set({ hist: !S.hist }), clip: S.clip && S.hist, clipInk: S.clip ? '#e8202a' : '#c9d0d8', tClip: () => set({ clip: !S.clip }),
      histMeta: S.clip ? 'clipping shown' : 'tap ▲ for clipping',
      history: S.mode === 'history', historyInk: S.mode === 'history' ? '#e8202a' : '#a6b0bc', tHistory: () => mode('history'),
      steps: steps.map(([name, val], i) => ({ name, val, cur: String(i === S.step), bg: i === S.step ? 'rgba(232,32,42,0.2)' : 'transparent', dot: i === S.step ? '#e8202a' : i < S.step ? '#f2efe8' : '#5d6166', o: i > S.step ? 0.45 : 1, pick: () => set({ step: i, ver: 1 }) })),
      versions: S.mode === 'versions',
      vers: vers.concat([['New', '']]).map(([name, f], i) => ({ name, filter: f || 'none', on: String(i === S.ver), ring: i === S.ver ? '#e8202a' : 'rgba(255,255,255,0.15)', ringW: i === S.ver ? 2 : 1, ink: i === S.ver ? '#f2efe8' : '#a6b0bc',
        imgShow: name === 'New' ? 'none' : 'block', plusShow: name === 'New' ? 'flex' : 'none', pick: () => (name === 'New' ? null : set({ ver: i })) })),
      after, imL, imT, imW, imH, imTr: this.drag ? 'none' : 'all 320ms cubic-bezier(0.2, 0.85, 0.2, 1)', pix: S.zoom ? 'auto' : 'auto',
      afterW: split ? `${baseW - splitRel}px` : '100%', split, splitX: S.split, zoomed: S.zoom,
      mmL: (((-imL) / imW) * 100).toFixed(1), mmT: (((-imT) / imH) * 100).toFixed(1), mmW: ((AW / imW) * 100).toFixed(1), mmH: ((AH / imH) * 100).toFixed(1),
      photoAria: S.zoom ? 'Photo at 100%. Drag to look around; double-tap to fit.' : 'Photo. Double-tap for 100%; press and hold for the original.',
      pDown: (e) => {
        const now = Date.now(), b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
        if (now - this.lastTap < 300) { this.lastTap = 0; const z = !S.zoom; set({ zoom: z, mode: z ? 'zoom' : S.mode === 'zoom' ? null : S.mode, cx: z ? Math.max(0.05, Math.min(0.95, (x - imL) / imW)) : S.cx, cy: z ? Math.max(0.05, Math.min(0.95, (y - imT) / imH)) : S.cy }); return; }
        this.lastTap = now;
        this.drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, onLine: split && Math.abs(x - S.split) < 40 };
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
        if (!S.zoom && !this.drag.onLine) this.holdTimer = setTimeout(() => this.setState({ holding: true }), 350);
      },
      pMove: (e) => {
        const d = this.drag; if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 6) clearTimeout(this.holdTimer);
        if (d.onLine) return this.setState({ split: Math.max(0, Math.min(412, S.split + (e.clientX - d.x))), }) || (d.x = e.clientX);
        if (S.zoom) this.setState({ cx: Math.max(0.03, Math.min(0.97, d.cx - dx / imW)), cy: Math.max(0.03, Math.min(0.97, d.cy - dy / imH)) });
      },
      pUp: () => { this.drag = null; clearTimeout(this.holdTimer); if (this.state.holding) set({ holding: false }); },
      modes: [['compare', 'COMPARE'], ['zoom', '100%'], ['history', 'HISTORY'], ['versions', 'VERSIONS']].map(([m, label]) => ({ label, on: String(S.mode === m), ink: S.mode === m ? '#f2efe8' : '#7d8187', dot: S.mode === m ? '#e8202a' : 'transparent', pick: () => mode(m) })),
      hint: S.holding ? 'Showing the original while you hold.' : hints[S.mode] || 'Tap a tool above. The histogram and history also live in the header.',
    };
  }
}
