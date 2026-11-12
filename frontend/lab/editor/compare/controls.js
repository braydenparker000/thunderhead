// @ts-check
// The compare page's controls: a chip per method (its dot fills once every tile in view is ready), the zoom
// buttons, Split with its divider, Difference, Blind with "I prefer this one", and the status line. A blind pick
// is kept on this device as a mark (tiles.js `cleanMarks`): where and how far zoomed, which two methods by kind,
// and which was picked; never the photo's or a file's name.
import { S, bus, changed, label, method, other } from './state.js';
import { KEEP, cleanMarks } from './tiles.js';
import { progress, pump, ready, show } from './render.js';
import * as view from './view.js';

const MARKS = 'th.compare.marks';
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const chips = /** @type {Map<string, HTMLButtonElement>} */ (new Map());
let note = '';

/** Says something in the status line until the next tile starts (a file that cannot be read). @param {string} text */
export function say(text) { note = text; draw(); }

/** Shows a method: it becomes A, and the one shown before it B. @param {string} id */
export function pick(id) {
  const m = method(id);
  if (!m || m.off) return;
  if (id !== S.a) { S.b = S.a; S.a = id; }
  S.shown = id;
  pump(); changed();   // the order of what is left to make changes; nothing new is made
}
/** A tap on the photo: the other of the two shows, at once. */
export function flip() { S.shown = other(); show(); pump(); changed(); }

/** The marks kept on this device (none where storage is refused). */
export function marks() { try { return cleanMarks(JSON.parse(localStorage.getItem(MARKS) || '[]')); } catch { return []; } }
/** Keeps a blind pick: the method shown is preferred over the other of the two, whose names then show. */
function prefer() {
  const a = method(S.a), b = method(S.b), shown = method(S.shown);
  if (!S.blind || !a || !b || !shown || a === b) return;
  const c = view.centre(), round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  const mark = { at: Date.now(), x: round(c.x), y: round(c.y), zoom: round(view.zoom()), a: a.kind, b: b.kind, picked: shown.kind };
  try { localStorage.setItem(MARKS, JSON.stringify(cleanMarks([...marks(), mark]).slice(-KEEP))); } catch {}
  S.revealed.add(a.id); S.revealed.add(b.id);
  say(`Kept: ${shown.name} over ${(shown === a ? b : a).name}`);
}

/** Draws the chips, toggles and status line from the page's state. */
export function draw() {
  const row = $('chips');
  for (const m of S.methods) {
    let c = chips.get(m.id);
    if (!c) {
      c = document.createElement('button'); c.type = 'button'; c.className = 'chip'; c.dataset.method = m.id;
      c.append(Object.assign(document.createElement('span'), { className: 'dot' }), Object.assign(document.createElement('span'), { className: 'name' }), Object.assign(document.createElement('span'), { className: 'role' }));
      c.addEventListener('click', () => pick(m.id));
      row.append(c); chips.set(m.id, c);
    }
    c.disabled = !!m.off;
    c.setAttribute('aria-pressed', String(m.id === S.shown));
    /** @type {HTMLElement} */ (c.querySelector('.name')).textContent = label(m);
    /** @type {HTMLElement} */ (c.querySelector('.role')).textContent = m.id === S.a ? 'A' : m.id === S.b ? 'B' : '';
    /** @type {HTMLElement} */ (c.querySelector('.dot')).classList.toggle('full', !m.off && ready(m.id));
  }
  for (const [id, on] of /** @type {[string, boolean][]} */ ([['split', S.split], ['diff', S.diff], ['blind', S.blind]])) $(id).setAttribute('aria-pressed', String(on));
  for (const b of document.querySelectorAll('[data-zoom]')) b.setAttribute('aria-pressed', String(Math.abs(view.zoom() - Number(/** @type {HTMLElement} */ (b).dataset.zoom)) < 0.01));
  $('divider').hidden = !S.split || S.diff;
  $('divider').style.left = `${S.cut * 100}%`;
  /** @type {HTMLButtonElement} */ ($('prefer')).disabled = !S.blind || S.a === S.b;
  $('prefer').hidden = !S.blind;
  const busy = method(S.busy);
  if (busy) note = '';
  const p = busy ? progress(busy.id) : null;
  $('status').textContent = busy && p ? `${label(busy)}: ${p.done} of ${p.of} tiles` : note || (S.methods.length ? 'Ready' : '');
}

/** Wires the controls once a photo is open. */
export function wire() {
  bus.addEventListener('change', draw);
  for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => view.zoomTo(Number(/** @type {HTMLElement} */ (b).dataset.zoom)));
  $('split').addEventListener('click', () => { S.split = !S.split; show(); changed(); });
  $('diff').addEventListener('click', () => { S.diff = !S.diff; show(); changed(); });
  $('blind').addEventListener('click', () => { S.blind = !S.blind; S.revealed.clear(); note = ''; changed(); });
  $('prefer').addEventListener('click', prefer);
  // the split's divider follows the finger along the viewport
  const bar = $('divider'), vp = $('viewport');
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); e.stopPropagation(); });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = vp.getBoundingClientRect();
    S.cut = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); show(); draw();
  });
  for (const t of ['pointerup', 'pointercancel']) bar.addEventListener(t, (e) => { dragging = false; e.stopPropagation(); });
  draw();
}
