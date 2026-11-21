// @ts-check
// Home for a screen reader (audit, 2026-11-21), watched from here so home.js keeps its size:
// - the closed + sheet is out of the reading and Tab order (inert) until it opens;
// - the ring says the app the finger is on through one polite live line (the ring itself is hidden),
//   empty again once it has closed;
// - the Briefing's or the menu's heading takes the focus as it opens, and the ask bar as it closes,
//   if the focus was in it. After a touch the bar takes it without raising the keyboard (inputmode
//   none until the next tap on the bar), so a swipe home never opens the keyboard.

const $ = (/** @type {string} */ id) => /** @type {HTMLElement | null} */ (document.getElementById(id));

export function heard() {
  const opts = $('opts'), ring = $('ring'), lbl = $('lbl'), say = $('ringsay');
  const q = /** @type {HTMLTextAreaElement | null} */ ($('q'));
  const brief = $('brief'), side = $('side');
  if (opts) {
    const shut = () => { opts.inert = !opts.classList.contains('show'); };
    shut();
    new MutationObserver(shut).observe(opts, { attributes: true, attributeFilter: ['class'] });
  }
  if (say && lbl && ring) {
    // home.js names the app right after it says th:ring; the label is read once it has.
    document.addEventListener('th:ring', (e) => queueMicrotask(() => {
      say.textContent = /** @type {CustomEvent} */ (e).detail && ring.classList.contains('show') ? lbl.textContent ?? '' : '';
    }));
    // Closed, with or without a choice, the line is empty again.
    new MutationObserver(() => { if (!ring.classList.contains('show') || !ring.classList.contains('active')) say.textContent = ''; })
      .observe(ring, { attributes: true, attributeFilter: ['class'] });
  }
  let touch = false;
  document.addEventListener('pointerdown', (e) => { touch = e.pointerType !== 'mouse'; }, true);
  document.addEventListener('keydown', () => { touch = false; }, true);
  const typing = () => q?.removeAttribute('inputmode');
  q?.addEventListener('pointerdown', typing);
  q?.addEventListener('blur', typing);
  /** @param {HTMLElement} page @param {string} heading */
  const watch = (page, heading) => {
    let was = page.inert;
    new MutationObserver(() => {
      if (page.inert === was) return;
      was = page.inert;
      if (!was) return void /** @type {HTMLElement | null} */ (page.querySelector(heading))?.focus({ preventScroll: true });
      const at = document.activeElement;
      if (!q || (at && at !== document.body && !page.contains(at))) return;
      if (touch) q.setAttribute('inputmode', 'none');
      q.focus({ preventScroll: true });
    }).observe(page, { attributes: true, attributeFilter: ['inert'] });
  };
  if (brief) watch(brief, '#bdate');
  if (side) watch(side, '.sidetitle');
}

heard();
