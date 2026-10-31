// Home is a chat: its top scrolls out of reach (owner, 2026-10-31). Two things keep it in sight:
// 1. His line pinned: once the voice line has scrolled up out of view, a small copy of it sits at
//    the top (a tap brings the line back); it follows the line as it changes.
// 2. The time while scrolling: a chip under it says when the topmost turn in view was said, and
//    fades once the scrolling stops (like a messaging app's floating date).
// Nothing here moves layout: the pinned line and the chip only fade and slide (transform, opacity).
const $ = (s) => document.querySelector(s);

export function startPinned() {
  const convo = $('#convo');
  const say = $('#say');
  const home = $('#home');
  if (!convo || !say || !home) return;
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pinline';
  pin.setAttribute('aria-label', 'Back to the top of today');
  const chip = document.createElement('div');
  chip.className = 'timechip';
  chip.setAttribute('aria-hidden', 'true');
  home.append(pin, chip);
  const text = () => [...say.querySelectorAll('.ln')].map((l) => l.textContent?.trim()).filter(Boolean).join(' ');
  const copy = () => { pin.textContent = text(); };
  copy();
  new MutationObserver(copy).observe(say, { childList: true, subtree: true, characterData: true });
  let away = false;
  // Shown, the pin also deepens the fade at the conversation's top edge (home.css), so text never
  // reads through it.
  const show = () => {
    const on = away && !home.classList.contains('pastview') && Boolean(pin.textContent);
    pin.classList.toggle('show', on);
    if (home.classList.contains('pinned') !== on) home.classList.toggle('pinned', on);
  };
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      away = !e.isIntersecting && e.boundingClientRect.bottom < (e.rootBounds?.top ?? 0) + 1;
      show();
    }
  }, { root: convo, threshold: 0 }).observe(say);
  new MutationObserver(show).observe(home, { attributes: true, attributeFilter: ['class'] });
  pin.addEventListener('click', () => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    convo.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
  });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let quiet;
  convo.addEventListener('scroll', () => {
    const top = convo.getBoundingClientRect().top + 8;
    /** @type {HTMLElement | null} */
    let turn = null;
    for (const t of /** @type {NodeListOf<HTMLElement>} */ (convo.querySelectorAll('.turn[data-at]'))) {
      if (t.getBoundingClientRect().bottom > top) { turn = t; break; }
    }
    const at = turn?.dataset.at;
    if (!at || !away) return void chip.classList.remove('show');
    chip.textContent = at;
    chip.classList.add('show');
    clearTimeout(quiet);
    quiet = setTimeout(() => chip.classList.remove('show'), 1200);
  }, { passive: true });
}
