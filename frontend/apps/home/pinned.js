// Home is a chat: its top scrolls out of reach (owner, 2026-10-31). While the owner scrolls back
// through the day, a chip says when the topmost turn in view was said, and fades once the scrolling
// stops (like a messaging app's floating date). It moves no layout: it only fades and slides.
// (The voice line it once pinned is gone: home says something only when something is off.)
const $ = (s) => document.querySelector(s);

export function startPinned() {
  const convo = $('#convo');
  const home = $('#home');
  if (!convo || !home) return;
  const chip = document.createElement('div');
  chip.className = 'timechip';
  chip.setAttribute('aria-hidden', 'true');
  home.append(chip);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let quiet;
  convo.addEventListener('scroll', () => {
    // Only once scrolled back from the newest, never at the bottom where the times are in view.
    const away = convo.scrollHeight - convo.scrollTop - convo.clientHeight > 120;
    const top = convo.getBoundingClientRect().top + 8;
    /** @type {HTMLElement | null} */
    let turn = null;
    for (const t of /** @type {NodeListOf<HTMLElement>} */ (convo.querySelectorAll('.turn[data-at]'))) {
      if (t.getBoundingClientRect().bottom > top) { turn = t; break; }
    }
    const at = turn?.dataset.at;
    if (!at || !away || home.classList.contains('pastview')) return void chip.classList.remove('show');
    chip.textContent = at;
    chip.classList.add('show');
    clearTimeout(quiet);
    quiet = setTimeout(() => chip.classList.remove('show'), 1200);
  }, { passive: true });
}
