// @ts-nocheck
// The tool dial (the owner, 2026-11-18): one knurled dial in the bottom-right corner, where the round tools key and its
// glass dock were. Held, it opens into a ring of the tools, and the thumb sliding straight up or down turns it, a click
// every 40 design px: up the next tool, down the one before (a little over half a click's way: there is little room
// under the thumb). The ring goes all the way round, so every tool is reached by sliding up. Sideways turns nothing. A
// tool holds until the thumb is well past half way to the next, the ring leaning a little meanwhile. As it turns, the
// panel slides through the tools, each named with its sections; let go and that tool opens, on the section it was left
// at (each board keeps its own, dc.js `keep`). A quick tap leaves it open, to tap a tool or slide it; a tap outside
// closes it. The arrow keys step it from a keyboard. The app owns it (boot.js): it hears which board shows
// (`editor:board`) and which section (`editor:section`, boards/Barrel.js), and asks for a tool with `editor:open`.
// Opening it tells the board (`editor:dial`), which shuts what it had open over the panel.
import { DCLogic } from '../dc.js';
import { tick } from '../app/haptic.js';

export const TOOLS = ['Looks', 'Crop', 'Edit', 'Masks', 'Heal', 'Versions'];
const SUBS = { Looks: ['Presets', 'Mine'], Crop: ['Straighten', 'Aspect', 'Rotate', 'Geometry'], Edit: ['Light', 'Curve', 'Color', 'Mixer', 'Grading', 'Effects', 'Detail', 'Optics', 'Profile'],
  Masks: ['Mask', 'Light', 'Color', 'Effects'], Heal: ['Heal', 'Clone', 'Remove'], Versions: ['Compare', '100%', 'History', 'Versions'] };   // until a board has told its own
// the dial's radius open and at rest; where the window points (degrees, round from the right); how far apart the names
// stand (degrees); the thumb's slide a click (design px); where a notch lets go (a click's part); the names' radius
const R = 160, REST = 84, AT = 225, STEP = 30, PX = 40, NOTCH = 0.6, TEXT = 106;
const T = TOOLS.length, mod = (i) => ((i % T) + T) % T;
const METAL = 'conic-gradient(from 200deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 22%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.10)), repeating-radial-gradient(circle, rgba(255,255,255,0.03) 0 1px, rgba(0,0,0,0) 1px 3px), linear-gradient(180deg, #2b2d2f, #17181a)';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { tool: document.getElementById('frame')?.dataset.board || '', sticky: false, t: 0 };
    this.sec = {};   // each board's sections and the one showing, as its panel last told
    this.last = TOOLS.includes(this.state.tool) ? this.state.tool : 'Edit';   // the tool last shown: Export opens the dial at it
    const at = TOOLS.indexOf(this.last);
    this.sp = { p: { x: 0, v: 0, to: 0 }, a: { x: at, v: 0, to: at }, k: { x: 0, v: 0, to: 0 } };
    this.g = null; this.raf = 0; this.h = 210;
    document.addEventListener('editor:board', (e) => {
      const name = e.detail; if (TOOLS.includes(name)) this.last = name;
      if (!this.g && !this.state.sticky) { const i = TOOLS.indexOf(this.last); this.sp.a.x = this.sp.a.to = i; }   // (round the ring, the same place)
      this.setState({ tool: name });
    });
    document.addEventListener('editor:section', (e) => { this.sec[this.state.tool] = e.detail; this.setState({}); });
  }
  step(s, k, c, dt) { s.v += (-k * (s.x - s.to) - c * s.v) * dt; s.x += s.v * dt; }
  run() {
    if (this.raf) return;
    let last = performance.now();
    const go = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000), sp = this.sp, held = !!this.g; last = now;
      for (let i = 0; i < 4; i++) { this.step(sp.p, 300, 21, dt / 4); this.step(sp.a, held ? 900 : 520, held ? 40 : 28, dt / 4); this.step(sp.k, 1100, 30, dt / 4); }
      const still = Object.values(sp).every((s) => Math.abs(s.x - s.to) < 0.002 && Math.abs(s.v) < 0.01);
      if (still && !held) { for (const s of Object.values(sp)) { s.x = s.to; s.v = 0; } this.raf = 0; } else this.raf = requestAnimationFrame(go);
      this.setState({ t: now });
    };
    this.raf = requestAnimationFrame(go);
  }
  click() { const k = this.sp.k; k.x = 1; k.v = 0; k.to = 0; tick('detent'); }
  /** The panel's height now (the tools slide by over it). */
  measure() {
    const stage = document.getElementById('stage'), plate = stage?.querySelector('.plate');
    this.h = plate ? Math.max(100, Math.min(340, stage.clientHeight - plate.offsetTop)) : 210;
  }
  open() { this.measure(); document.dispatchEvent(new Event('editor:dial')); this.sp.p.to = 1; }
  choose(i) {
    this.sp.a.to = i; this.setState({ sticky: false });
    if (TOOLS[mod(i)] !== this.state.tool) document.dispatchEvent(new CustomEvent('editor:open', { detail: TOOLS[mod(i)] }));
    setTimeout(() => { this.sp.p.to = 0; this.run(); }, 170);   // it settles on the choice, then folds back into the corner
  }
  shut() { const i = TOOLS.indexOf(this.last); this.g = null; this.sp.a.to = i + T * Math.round((this.sp.a.x - i) / T); this.sp.p.to = 0; this.setState({ sticky: false }); this.run(); }   // closed without a choice: back round to the tool that was on
  /** A finger on the dial (its key at rest, or the open dial after a tap). */
  hold(e, el, sticky) {
    const i = Math.round(this.sp.a.to);
    this.g = { el, id: e.pointerId, k: el.getBoundingClientRect().width / (sticky ? 2 * R * this.scale() : REST) || 1, x0: e.clientX, y0: e.clientY, base: i, idx: i, moved: false, sticky };
  }
  /** The thumb's slide up or down turns the dial, in notches: a tool holds until it is well past half way to the next. */
  follow(e) {
    const g = this.g; if (!g || e.pointerId !== g.id) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) / g.k > 8) { g.moved = true; try { g.el.setPointerCapture(e.pointerId); } catch { /* followed while over it */ } }
    const raw = g.base - (e.clientY - g.y0) / g.k / PX;   // up: the next tool
    let i = g.idx;
    while (raw - i > NOTCH) i++;
    while (i - raw > NOTCH) i--;
    this.sp.a.to = i + Math.max(-NOTCH, Math.min(NOTCH, raw - i)) * 0.3;
    if (i !== g.idx) { g.idx = i; this.click(); }
    this.run();
  }
  scale() { const s0 = REST / R; return s0 + (1 - s0) * Math.max(0, this.sp.p.x); }
  renderVals() {
    const S = this.state, sp = this.sp, sticky = S.sticky, p = Math.max(0, sp.p.x), a = sp.a.x, ia = mod(Math.round(a)), on = TOOLS.includes(S.tool) || S.tool === 'Export';
    const dialOn = p > 0.02 || !!this.g || sticky, h = this.h, near = (k) => k + T * Math.round((a - k) / T);   // where a tool stands round the ring, nearest the window
    const circle = (r) => `position: absolute; left: ${R - r}px; top: ${R - r}px; width: ${2 * r}px; height: ${2 * r}px; border-radius: 50%`;
    const ring = TOOLS.map((name, k) => {
      const th = AT - (near(k) - a) * STEP, rad = (th * Math.PI) / 180, vis = th > 168 && th < 282, here = k === ia;
      return { name, label: name.toUpperCase(), pick: () => { if (this.state.sticky && !this.g?.moved) { this.click(); this.choose(near(k)); } },
        style: `position: absolute; left: ${(R + TEXT * Math.cos(rad)).toFixed(2)}px; top: ${(R + TEXT * Math.sin(rad)).toFixed(2)}px; transform: translate(-50%, -50%) rotate(${(th + 90).toFixed(2)}deg); padding: 8px 10px; white-space: nowrap; font-size: ${here ? 11 : 10}px; font-weight: 600; letter-spacing: 0.14em; color: ${here ? '#f2efe8' : '#80848a'}; opacity: ${vis ? 1 : 0}; pointer-events: ${sticky && vis ? 'auto' : 'none'}` };
    });
    // the tools sliding by over the panel: the one or two in view, each with its sections, the one it is on lit
    const f = Math.floor(a);
    const face = (q) => {
      const name = TOOLS[mod(q)], told = this.sec[name], subs = told?.faces?.length ? told.faces : SUBS[name], cur = told?.label || '', y = (q - a) * h;
      return { name: name.toUpperCase(), subs: subs.map((s) => ({ label: String(s).toUpperCase(), ink: s === cur ? '#f2efe8' : '#6a6e73' })),
        box: `position: absolute; left: 0; top: 0; width: 412px; height: ${h}px; padding: 0 0 ${Math.round(h * 0.18)}px 26px; box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 10px; background: #232525 url(/lab/editor/assets/plate.webp) 0 0 / 412px 340px no-repeat; transform: translateY(${y.toFixed(1)}px)` };
    };
    const faces = [f, f + 1].filter((q) => Math.abs(a - q) < 1).map(face);
    const kick = Math.max(0, sp.k.x), wrad = (AT * Math.PI) / 180, told = this.sec[S.tool];
    return {
      shown: on ? 'block' : 'none', ring, faces, closed: String(!dialOn),
      veil: `position: absolute; left: 0; right: 0; top: 0; bottom: ${h}px; background: rgba(0,0,0,${(0.42 * Math.min(1, p)).toFixed(3)}); pointer-events: ${sticky ? 'auto' : 'none'}`,
      plates: `position: absolute; left: 0; right: 0; bottom: 0; height: ${h}px; overflow: hidden; background: #0b0c0d; opacity: ${Math.min(1, p * 3).toFixed(3)}; visibility: ${dialOn ? 'visible' : 'hidden'}; pointer-events: ${sticky ? 'auto' : 'none'}`,
      dialBox: `position: absolute; right: ${-R}px; bottom: ${-R}px; width: ${2 * R}px; height: ${2 * R}px; transform: scale(${this.scale().toFixed(4)}); visibility: ${dialOn ? 'visible' : 'hidden'}; pointer-events: ${sticky ? 'auto' : 'none'}; touch-action: none`,
      knurl: `${circle(R)}; background: repeating-conic-gradient(from ${(a * STEP).toFixed(2)}deg, #4a4d50 0deg 1.2deg, #0e0f10 1.2deg 2.4deg); box-shadow: 0 0 0 1px rgba(0,0,0,0.9), 0 0 ${(36 * p).toFixed(1)}px rgba(0,0,0,${(0.75 * p).toFixed(3)})`,
      face: `${circle(R - 8)}; background: ${METAL}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(0,0,0,0.6)`,
      labels: `position: absolute; inset: 0; opacity: ${Math.max(0, Math.min(1, (p - 0.45) / 0.4)).toFixed(3)}`,
      win: `position: absolute; left: ${(R + TEXT * Math.cos(wrad)).toFixed(2)}px; top: ${(R + TEXT * Math.sin(wrad)).toFixed(2)}px; width: 88px; height: 28px; margin: -14px 0 0 -44px; border-radius: 7px; pointer-events: none; transform: rotate(${AT + 90}deg) scale(${(1 + 0.04 * kick).toFixed(4)}, ${(1 + 0.16 * kick).toFixed(4)}); box-shadow: inset 0 0 0 ${(1.5 + kick).toFixed(2)}px rgba(232,32,42,0.95), 0 0 ${(12 * kick).toFixed(1)}px rgba(232,32,42,${(0.45 * kick).toFixed(3)})`,
      rest: `position: absolute; right: 0; bottom: 0; width: ${REST}px; height: ${REST}px; border-radius: ${REST}px 0 0 0; touch-action: none; pointer-events: ${sticky ? 'none' : 'auto'}; opacity: ${(1 - Math.min(1, p * 2.2)).toFixed(3)}`,
      restFace: `position: absolute; right: 0; bottom: 0; width: ${REST - 10}px; height: ${REST - 10}px; border-radius: ${REST - 10}px 0 0 0; background: ${METAL}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 0 0 1px rgba(0,0,0,0.85)`,
      restKnurl: `position: absolute; right: -${REST}px; bottom: -${REST}px; width: ${2 * REST}px; height: ${2 * REST}px; border-radius: 50%; background: repeating-conic-gradient(from ${(a * STEP).toFixed(2)}deg, #4a4d50 0deg 1.6deg, #0e0f10 1.6deg 3.2deg)`,
      toolUp: S.tool.toUpperCase(), sectionUp: (told?.label || '').toUpperCase(),
      restLabel: `Tools: ${S.tool}${told?.label ? `, ${told.label}` : ''}. Hold and slide up for the next tool, down for the one before; tap to open the dial`,
      close: () => this.shut(),
      down: (e) => { if (this.g || (e.button ?? 0) > 0) return; this.hold(e, e.currentTarget, false); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* followed while over it */ } this.open(); this.setState({ sticky: false }); this.run(); this.click(); },
      move: (e) => this.follow(e),
      up: (e) => {
        const g = this.g; if (!g || e.pointerId !== g.id) return;
        this.g = null;
        if (!g.moved) { if (!g.sticky) { this.setState({ sticky: true }); this.run(); } return; }   // a tap: it stays open, to tap or slide
        this.choose(g.idx); this.run();
      },
      cancel: () => this.shut(),
      // open after a tap: a finger on it slides it too, and lets go on a tool; a tap on a name picks that one
      sdown: (e) => { if (!this.state.sticky || this.g || (e.button ?? 0) > 0) return; this.hold(e, e.currentTarget, true); },
      key: (e) => {
        const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); const i = mod(TOOLS.indexOf(this.last) + d); this.sp.a.to = Math.round(this.sp.a.x) + d; this.click(); this.run(); if (TOOLS[i] !== S.tool) document.dispatchEvent(new CustomEvent('editor:open', { detail: TOOLS[i] })); }
        else if (e.key === 'Escape') this.shut();
      },
      tapKey: (e) => { if (e.detail === 0 && !this.state.sticky) { this.open(); this.setState({ sticky: true }); this.run(); } },   // Enter or Space: open it, to tap a tool
    };
  }
}
