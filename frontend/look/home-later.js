// @ts-check
// Ink and Lamp's decision strip (approved screens R-Grey / R-Dark): the docked decision keeps all its
// own behaviour (th/decide/card.js); the look adds the small dial for "later". It is local to this
// phone and new: a tap on the dial hides the decision on show for the time the dial says (1 h at
// first); turning or dragging it, or its arrow keys, step through 1 h, 3 h, tonight (20:00, or
// tomorrow 08:00 once past 20:00) and tomorrow (08:00). The decision comes back by itself when the
// time is up, and at once when the look is turned off. Nothing is sent to the Worker and nothing about
// how a decision is answered changes; with several waiting, the page shows one at a time as it does,
// and a hidden one keeps its place (the strip steps aside until it is due). The times are kept on
// this phone under one key, `th.p.later` ({ [proposal id]: until, in ms }), wiped at sign-out with the
// rest of th.p.*.
import { animator, haptic, springs } from '/th/motion.js';
import { clock } from '/th/pref.js';

const KEY = 'th.p.later';
const HOUR = 3_600_000;
/** @param {number} now @param {number} h the hour of the day it comes back, today or after */
const at = (now, h, next = false) => {
  const d = new Date(now);
  if (next || d.getHours() >= h) d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};
/** The dial's stops: its legend, its words, when it comes back, the pointer's angle. */
export const STOPS = [
  { legend: '1 h', words: 'in one hour', until: (/** @type {number} */ now) => now + HOUR, turn: 60 },
  { legend: '3 h', words: 'in three hours', until: (/** @type {number} */ now) => now + 3 * HOUR, turn: 120 },
  { legend: 'tonight', words: 'tonight', until: (/** @type {number} */ now) => (new Date(now).getHours() >= 20 ? at(now, 8) : at(now, 20)), turn: 180 },
  { legend: 'tomorrow', words: 'tomorrow', until: (/** @type {number} */ now) => at(now, 8, new Date(now).getHours() >= 8), turn: 240 },
];

/** @returns {Record<string, number>} */
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
/** @param {Record<string, number>} v */
const write = (v) => { try { Object.keys(v).length ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {} };

/** The ticks round Lamp's dial (28, as drawn on the approved screen). */
const TICKS = `<svg class="lk-ticks" viewBox="0 0 54 54" aria-hidden="true"><g stroke-width="1.4" stroke-linecap="round">${
  Array.from({ length: 28 }, (_, i) => `<path d="M27 2.4v3" transform="rotate(${(i * 360 / 28).toFixed(3)} 27 27)"/>`).join('')}</g></svg>`;

export function later() {
  const home = document.getElementById('home');
  if (!home) return;
  let stop = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {HTMLElement | null} */
  let slot = null;

  /** The strip steps aside while the decision on show is put off. */
  const apply = () => {
    clearTimeout(timer);
    const card = /** @type {HTMLElement | null} */ (slot?.querySelector('.card.decision:not(.gone)') ?? null);
    const now = Date.now();
    const kept = read();
    for (const [id, t] of Object.entries(kept)) if (t <= now) delete kept[id];
    write(kept);
    const until = card ? kept[card.dataset.id ?? ''] ?? 0 : 0;
    slot?.classList.toggle('lk-later', until > now);
    const next = Math.min(...Object.values(kept));
    if (Number.isFinite(next)) timer = setTimeout(apply, Math.min(next - now + 50, 2 ** 31 - 1));
    if (card && !card.querySelector('.lk-later-b')) dial(card);
  };

  /** The dial on one decision card. @param {HTMLElement} card */
  function dial(card) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lk-later-b';
    b.innerHTML = `<span class="lk-ring" aria-hidden="true">${TICKS}<span class="lk-dial lk-dial--small"></span></span><span class="lk-lh" aria-hidden="true"></span>`;
    const face = /** @type {HTMLElement} */ (b.querySelector('.lk-dial'));
    const lh = /** @type {HTMLElement} */ (b.querySelector('.lk-lh'));
    const turn = animator((v) => face.style.setProperty('--turn', `${v}deg`), { unit: 'scalar' });
    const show = (/** @type {boolean} */ moving) => {
      const s = STOPS[stop];
      lh.textContent = s.legend;
      b.setAttribute('aria-label', `Decide later, ${s.words}`);
      if (moving) turn.to(s.turn, { spring: springs.pop });
      else turn.set(s.turn);
    };
    show(false);
    const step = (/** @type {number} */ by) => {
      const n = Math.max(0, Math.min(STOPS.length - 1, stop + by));
      if (n === stop) return;
      stop = n;
      haptic('choose');
      show(true);
    };
    /** @type {{ x: number, y: number, moved: boolean, steps: number } | null} */
    let drag = null;
    let turned = false;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // a turn of the dial is never the page's swipe
      drag = { x: e.clientX, y: e.clientY, moved: false, steps: 0 };
      turned = false;
      try { b.setPointerCapture(e.pointerId); } catch {}
    });
    b.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // Right or up turns it on, left or down back (a dial turned under the thumb).
      const d = (e.clientX - drag.x) - (e.clientY - drag.y);
      if (Math.abs(d) > 8) drag.moved = turned = true;
      const steps = Math.trunc(d / 24);
      if (steps !== drag.steps) { step(steps - drag.steps); drag.steps = steps; }
    });
    const end = () => { drag = null; };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('keydown', (e) => {
      const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (by) { e.preventDefault(); step(by); }
    });
    b.addEventListener('click', () => {
      if (turned) { turned = false; return; }
      const id = card.dataset.id;
      if (!id) return;
      const s = STOPS[stop];
      const until = s.until(Date.now());
      write({ ...read(), [id]: until });
      haptic('commit');
      import('/th/ui.js').then((u) => u.toast(`Put off on this phone until ${stop > 1 ? `${s.words} at ` : ''}${clock(until)}.`), () => {});
      apply();
    });
    card.append(b);
  }

  const cards = new MutationObserver(apply);
  const find = () => {
    const s = document.getElementById('decision');
    if (s === slot) return;
    cards.disconnect();
    slot = s;
    if (slot) cards.observe(slot, { childList: true });
    apply();
  };
  const docks = new MutationObserver(find);
  docks.observe(home, { childList: true });
  find();
  const seen = () => { if (!document.hidden) apply(); };
  document.addEventListener('visibilitychange', seen);

  return () => {
    clearTimeout(timer);
    cards.disconnect();
    docks.disconnect();
    document.removeEventListener('visibilitychange', seen);
    slot?.classList.remove('lk-later');
    if (slot && !slot.classList.length) slot.removeAttribute('class');
    document.querySelectorAll('.lk-later-b').forEach((b) => b.remove());
  };
}
