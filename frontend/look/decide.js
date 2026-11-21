// @ts-check
// Ink and Lamp's decision strip, opened: closed, the strip shows the question on one line and keeps
// the card's smaller lines (the why, the odds, what happens if it is ignored: th/decide/card.js `.dx`)
// out of sight; a tap on the question opens the strip in place to show the whole question and those
// lines, and a second tap, or an answer, closes it. The question's words go into a real button
// (`.lk-q`, aria-expanded, naming the lines it shows), so the keyboard and a screen reader can open it;
// the card's own question element, its id and its label stay as they are. Off, the words go back.
import { whileOn } from './look.js';

/** @param {HTMLElement} card */
function opener(card) {
  const q = /** @type {HTMLElement | null} */ (card.querySelector(':scope>.q'));
  if (!q || q.querySelector('.lk-q')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lk-q';
  b.textContent = q.textContent;
  b.setAttribute('aria-expanded', 'false');
  const dx = [...card.querySelectorAll(':scope>.dx')];
  dx.forEach((d, i) => { if (!d.id) d.id = `${q.id || 'q'}-dx${i}`; });
  if (dx.length) b.setAttribute('aria-controls', dx.map((d) => d.id).join(' '));
  q.replaceChildren(b);
}

/** @param {HTMLElement} card @param {boolean} open */
const set = (card, open) => {
  card.classList.toggle('lk-open', open);
  card.querySelector('.lk-q')?.setAttribute('aria-expanded', String(open));
};

function decide() {
  const home = document.getElementById('home');
  if (!home) return;
  // The cards come and go in the decision's slot, which the page docks once (th/decide/dock.js).
  const dress = () => document.querySelectorAll('#decision .card.decision').forEach((c) => opener(/** @type {HTMLElement} */ (c)));
  const cards = new MutationObserver(dress);
  /** @type {HTMLElement | null} */
  let slot = null;
  const find = () => {
    const s = document.getElementById('decision');
    if (s !== slot) { cards.disconnect(); slot = s; if (slot) cards.observe(slot, { childList: true }); }
    dress();
  };
  const docks = new MutationObserver(find);
  docks.observe(home, { childList: true });
  find();
  const click = (/** @type {MouseEvent} */ e) => {
    const t = /** @type {Element} */ (e.target);
    const card = /** @type {HTMLElement | null} */ (t.closest?.('#decision .card.decision') ?? null);
    if (!card) return;
    if (t.closest('.lk-q')) set(card, !card.classList.contains('lk-open'));
    else if (t.closest('.decide button')) set(card, false);
  };
  home.addEventListener('click', click);
  return () => {
    cards.disconnect();
    docks.disconnect();
    home.removeEventListener('click', click);
    document.querySelectorAll('#decision .card.decision').forEach((c) => {
      const card = /** @type {HTMLElement} */ (c);
      card.classList.remove('lk-open');
      const b = card.querySelector('.lk-q');
      if (b) b.replaceWith(b.textContent ?? '');
    });
  };
}

whileOn(decide);
