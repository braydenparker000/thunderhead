// @ts-check
// The island follows the finger (HOME §12.1); let go, distance and speed decide. Reduced motion: thresholds only.
import { haptic, motionReduced, springs } from '../motion.js';
import { prefOn } from '../pref.js';
import { st, control, collapse, wide } from './island.js';
import { aim, clamp, go, ms, pulse, shape, surface, token } from './shape.js';
/** A rubber band past lo..hi, at most k further. @param {number} v @param {number} lo @param {number} hi @param {number} k */
const rubber = (v, lo, hi, k) => v > hi ? hi + (v - hi) * k / (v - hi + k) : v < lo ? lo - (lo - v) * k / (lo - v + k) : v;
/** A smoothed speed in px/s. @param {number} v @param {number} d @param {number} dt */
const speed = (v, d, dt) => .6 * d * 1000 / Math.max(8, dt) + .4 * v;
const unpress = () => { if (pulse.value < 0) go('island:press', pulse, 0, { spring: springs.pop }); };

/** @param {HTMLElement} b */
export function grip(b) {
  /** @type {{x:number,y:number,lx:number,ly:number,t:number,vx:number,vy:number,p:number,axis:string}|null} */
  let g = null, hold = 0;
  const strip = () => /** @type {HTMLElement[]} */ ([...b.querySelectorAll('.title:not(.ghost),.art:not(.ghost)')]);
  b.addEventListener('pointerdown', e => {
    st.touching = true; st.c.touch(); st.held = false; st.c.marquee(-1);
    g = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: e.timeStamp, vx: 0, vy: 0, p: 0, axis: '' };
    if (!motionReduced() && !st.expanded) pulse.set(-25);
    clearTimeout(hold);
    if (!st.expanded) hold = setTimeout(() => { if (g && !g.axis) { st.held = true; unpress(); void wide(true); } }, 450);
  });
  b.addEventListener('pointermove', e => {
    if (!g) return;
    const dt = e.timeStamp - g.t, dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.vx = speed(g.vx, e.clientX - g.lx, dt); g.vy = speed(g.vy, e.clientY - g.ly, dt);
    g.lx = e.clientX; g.ly = e.clientY; g.t = e.timeStamp;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      g.axis = !st.expanded && prefOn('island.swipe') && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      st.held = true; clearTimeout(hold); unpress();
      b.setPointerCapture(e.pointerId);
      g.y = e.clientY; g.p = shape.value;
    } else if (motionReduced()) { if (g.axis === 'y' && Math.abs(dy) > 30) { g = null; void wide(dy > 0); } }
    // Its bottom edge under the finger; title and art 1:1 sideways.
    else if (g.axis === 'y') shape.set(rubber(g.p + dy / 144, 0, 1, .12));
    else for (const n of strip()) n.style.translate = `${rubber(dx, -24, 24, 24)}px 0`;
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!st.touching) return;
    st.touching = false; clearTimeout(hold); unpress();
    const h = g, dx = e.clientX - (h?.x ?? 0), late = e.timeStamp - (h?.t ?? 0) > 90, vy = late ? 0 : h?.vy ?? 0;
    g = null;
    if (h?.axis === 'y') { if (!motionReduced()) void wide(shape.value + vy / 720 > .5, vy / 144); }
    else if (h?.axis === 'x') {
      if (Math.abs(dx) > 36 || !late && Math.abs(h.vx) > 500 && h.vx * dx > 0) {
        haptic('choose');
        st.from = parseFloat(strip()[0]?.style.translate) || 0;
        control(dx < 0 ? 'next' : 'previous');
      }
      // The rest springs back, held until its animation has a frame.
      for (const n of strip()) if (n.style.translate) n.animate([{ translate: n.style.translate }, { translate: '0 0' }], { duration: ms('quick'), easing: token('--pop'), fill: 'forwards' }).onfinish = a => { n.style.translate = ''; /** @type {Animation} */ (a.target).cancel(); };
    }
    st.c.touch(); if (!st.expanded) st.c.marquee();
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
  b.addEventListener('contextmenu', e => e.preventDefault());
}

/** @type {{x:number,y:number,fy:number,t:number,dy:number,vy:number,on:boolean}|null} */
let d = null;
/** The app `dy` px down: smaller, rounder, under the finger. @param {number} dy @param {number} fy */
function card(dy, fy) {
  const y = rubber(dy, 0, 160, 80), s = 1 - .3 * y / 160, w = innerWidth * s;
  return [(innerWidth - w) / 2, fy * innerHeight * (1 - s) + y, w, innerHeight * s, 40 * clamp(y / 120)];
}
/** A touch on the app in front, from its bottom or Podcasts' players; p is null for a second finger.
 * @param {string} kind @param {any} w @param {any} e @param {any} p */
export function pull(kind, w, e, p) {
  const l = st.layer, r = motionReduced();
  if (kind === 'down') {
    const zone = w.document.getElementById('mini-player') ? e.target?.closest?.('#mini-player,.podcast-nav') : p?.clientY > w.innerHeight - 150;
    d = zone && p ? { x: p.clientX, y: p.clientY, fy: p.clientY / innerHeight, t: e.timeStamp, dy: 0, vy: 0, on: false } : null;
  } else if (d && l && p && kind === 'move') {
    // On the screen: the app's own pixels under its zoom (a test's touch has no screenY).
    const [X, Y, W] = d.on && !r ? card(d.dy, d.fy) : [0, 0, innerWidth], k = W / innerWidth, dy = Y + p.clientY * k - d.y;
    d.vy = speed(d.vy, dy - d.dy, e.timeStamp - d.t); d.dy = dy; d.t = e.timeStamp;
    if (!d.on && (dy < 10 || dy < Math.abs(X + p.clientX * k - d.x) * 1.2)) return;
    d.on = true;
    if (!r) surface(l, card(dy, d.fy), 0);
    else if (dy > 56) { d = null; void collapse('swipe down'); }
  } else if (d && l) {
    const h = d, vy = e.timeStamp - h.t > 90 ? 0 : h.vy, D = card(h.dy, h.fy), V = card(h.dy + vy / 60, h.fy).map((n, k) => (n - D[k]) * 60);
    d = null;
    if (!h.on || r) return;
    if (kind === 'up' && h.dy + vy * .25 > 90) void collapse('swipe down', D, V);
    else aim(0, D, V, 'island:back');
  }
}
