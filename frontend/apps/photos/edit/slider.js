// @ts-check
// One slider at a time (PHOTOS.md, the editor): the control's name, its value in words and as a
// number, a track that fills from its default, and a thumb. Drag anywhere to move it (the finger's
// travel, so a press never jumps); a tap beside the thumb nudges it one step that way; a double tap
// puts it back; the arrow keys step it. Temperature runs on a log scale, as kelvin do.
import { el } from '/th/ui.js';
import { NUMBERS, words } from './fields.js';

const DOUBLE_MS = 300;
const TAP_PX = 6;

/**
 * @param {import('./fields.js').Control} c
 * @param {{ get: () => number, set: (v: number, done: boolean) => void, def?: number, min?: number, max?: number }} o
 */
export function slider(c, o) {
  const [min0, max0, def0] = NUMBERS[c.key] ?? [-100, 100, 0];
  const min = o.min ?? min0, max = o.max ?? max0, def = o.def ?? def0;
  const log = c.unit === 'K';
  const toPos = (/** @type {number} */ v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (/** @type {number} */ p) => {
    const q = Math.min(1, Math.max(0, p));
    const v = log ? min * (max / min) ** q : min + q * (max - min);
    return Math.round(v / c.step) * c.step;
  };
  const clamp = (/** @type {number} */ v) => Math.min(max, Math.max(min, Math.round(v / c.step) * c.step));
  const name = el('span', { class: 'sname', text: c.label });
  const said = el('span', { class: 'swords' });
  const num = el('span', { class: 'snum' });
  const fill = el('span', { class: 'sfill' });
  const thumb = el('span', { class: 'sthumb' });
  const track = el('div', { class: 'strack', role: 'slider', tabindex: '0', 'aria-label': c.label, 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, [el('span', { class: 'srail' }), fill, thumb]);
  const box = el('div', { class: 'slider', 'data-key': c.key }, [el('div', { class: 'shead' }, [name, said, num]), track]);
  const show = () => {
    const v = o.get();
    const p = toPos(v), z = toPos(Math.min(max, Math.max(min, def)));
    thumb.style.left = `${p * 100}%`;
    fill.style.left = `${Math.min(p, z) * 100}%`;
    fill.style.width = `${Math.abs(p - z) * 100}%`;
    const w = words(c, v, def);
    num.textContent = w.number;
    said.textContent = w.words;
    track.setAttribute('aria-valuenow', String(v));
    track.setAttribute('aria-valuetext', `${num.textContent}, ${said.textContent}`);
  };
  const set = (/** @type {number} */ v, /** @type {boolean} */ done) => { o.set(clamp(v), done); show(); };
  let start = 0, startV = 0, moved = false, lastTap = 0, id = -1;
  track.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    track.setPointerCapture(id);
    start = e.clientX; startV = o.get(); moved = false;
  });
  track.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - start;
    if (!moved && Math.abs(dx) < TAP_PX) return;
    moved = true;
    set(fromPos(toPos(startV) + dx / track.getBoundingClientRect().width), false);
  });
  const up = (/** @type {PointerEvent} */ e) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (moved) { set(o.get(), true); return; }
    const now = e.timeStamp;
    if (now - lastTap < DOUBLE_MS) { lastTap = 0; set(def, true); return; }
    lastTap = now;
    const r = thumb.getBoundingClientRect();
    if (e.clientX < r.left) set(o.get() - c.step, true);
    else if (e.clientX > r.right) set(o.get() + c.step, true);
  };
  track.addEventListener('pointerup', up);
  track.addEventListener('pointercancel', up);
  track.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (k) { e.preventDefault(); set(o.get() + k * c.step, true); }
    else if (e.key === 'Home' || e.key === 'Delete') { e.preventDefault(); set(def, true); }
  });
  show();
  return { el: box, show };
}

/** A row of choices, one pressed. @param {{ id: string, label: string }[]} items @param {string} on @param {(id: string) => void} pick */
export function segments(items, on, pick) {
  const row = el('div', { class: 'segs', role: 'group' });
  for (const it of items) {
    const b = el('button', { type: 'button', class: `seg${it.id === on ? ' on' : ''}`, 'aria-pressed': String(it.id === on), 'data-id': it.id, text: it.label });
    b.addEventListener('click', () => {
      for (const x of row.children) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
      pick(it.id);
    });
    row.append(b);
  }
  return row;
}

/** A grading wheel: drag the dot for hue (its angle) and saturation (its distance from the middle).
 * @param {() => { hue: number, sat: number }} get @param {(hue: number, sat: number, done: boolean) => void} set */
export function wheel(get, set) {
  const dot = el('span', { class: 'wdot' });
  const pad = el('div', { class: 'wheel', role: 'group', 'aria-label': 'Hue and saturation' }, [dot]);
  const show = () => {
    const { hue, sat } = get();
    const a = (hue * Math.PI) / 180, r = sat / 100;
    dot.style.left = `${50 + Math.cos(a) * r * 50}%`;
    dot.style.top = `${50 - Math.sin(a) * r * 50}%`;
  };
  const at = (/** @type {PointerEvent} */ e, /** @type {boolean} */ done) => {
    const b = pad.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5, y = 0.5 - (e.clientY - b.top) / b.height;
    const hue = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    set(hue === 360 ? 0 : hue, Math.round(Math.min(1, Math.hypot(x, y) * 2) * 100), done);
    show();
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); at(e, false); });
  pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) at(e, false); });
  pad.addEventListener('pointerup', (e) => at(e, true));
  pad.addEventListener('dblclick', () => { set(0, 0, true); show(); });
  show();
  return { el: pad, show };
}
