// Movements on home that used to animate layout, redone so no frame of them lays the page out again.
// - A card folding away (a decision, the working card, What's new, a notice): its own fold is drawn by
//   home.css (it fades to .97 and is cut away from the bottom, a docked one sliding down as its height
//   closed). The moment it starts, the card stops taking room, once.
// - A fold opening or closing (a menu group, a reply's "How I got this"): it takes its new height at
//   once, and what it opens is uncovered from the top on the same clock.
// Either way what moved is drawn back where it was and slid to its new place on the movement's own
// duration and curve (a FLIP), so it looks as it did and costs no layout while it plays. Watched from
// here rather than called, so the modules that own the cards and folds keep saying only a class.

/** @type {WeakMap<Element, Animation>} */
const slides = new WeakMap();
const done = new WeakSet();
const tops = (/** @type {Element[]} */ els) => els.map((e) => e.getBoundingClientRect().top);
const token = (/** @type {string} */ n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** A slide still playing is let go, so the next one is measured from the layout. @param {Element[]} els */
const halt = (els) => els.forEach((e) => slides.get(e)?.cancel());

/** Slides each element from `dy` px off to its place. @param {Element[]} els @param {number[]} dys @param {KeyframeAnimationOptions} time */
function slide(els, dys, time) {
  els.forEach((e, i) => {
    if (Math.abs(dys[i]) < 0.5) return;
    try {
      slides.set(e, e.animate([{ transform: `translateY(${dys[i]}px)` }, { transform: 'none' }], { ...time, fill: 'backwards' }));
    } catch {}
  });
}

/** The docked cards' places, as th/decide/dock.js keeps them, set at once rather than a frame late. */
function restack() {
  let under = 0;
  for (const id of ['decision', 'working']) {
    const slot = /** @type {HTMLElement | null} */ (document.getElementById(id));
    if (!slot) continue;
    slot.style.setProperty('--under', `${under}px`);
    if (slot.offsetHeight) under += slot.offsetHeight + 10;
  }
  document.documentElement.style.setProperty('--dock-h', `${under}px`);
}

/** What can move when `el` changes size, inside the scroller: it and each of its ancestors, with
 * their siblings; and how far each moved, less what its parent's own slide already carries.
 * @param {Element} el @param {Element} scroller */
function around(el, scroller) {
  /** @type {Element[]} */
  const els = [];
  for (let e = el; e.parentElement && e !== scroller; e = e.parentElement) els.push(...e.parentElement.children);
  return els.filter((e) => !(e instanceof HTMLElement && e.offsetParent === null && e.style.position !== 'fixed'));
}
/** @param {Element[]} els @param {number[]} was */
function moved(els, was) {
  const now = tops(els);
  const abs = els.map((e, i) => was[i] - now[i]);
  return els.map((e, i) => abs[i] - (abs[els.indexOf(/** @type {Element} */ (e.parentElement))] ?? 0));
}

/** @param {HTMLElement} card */
function fold(card) {
  done.add(card);
  const convo = document.getElementById('convo');
  const slot = card.parentElement;
  if (!convo || !slot) return;
  const docked = slot.classList.contains('dock');
  // What moves when the card stops taking room: the conversation, the working card over a decision.
  const els = docked ? [...convo.children, ...(slot.id === 'decision' ? [document.getElementById('working')] : [])].filter((e) => e !== null) : around(card, convo).filter((e) => e !== card);
  const was = tops(els);
  halt(els);
  const h = card.offsetHeight;
  if (docked) {
    // The dock is held by its bottom: the card hangs above it and the dock closes to nothing.
    card.style.marginTop = `${-h}px`;
    restack();
  } else {
    const room = h + (parseFloat(getComputedStyle(card).marginTop) || 0);
    // While it is still drawn the card holds the scroll's length, and the conversation would drop only
    // as it goes: scrolled near the end, the end comes up now, as it did while the old fold closed.
    const end = convo.scrollHeight - room - convo.clientHeight;
    card.style.marginBottom = `${-room}px`;
    if (convo.scrollTop > end) convo.scrollTop = Math.max(0, end);
  }
  const css = getComputedStyle(card);
  const duration = parseFloat(css.animationDuration) * 1000 || 0;
  const dys = moved(els, was);
  if (duration) slide(els, dys, { duration, delay: parseFloat(css.animationDelay) * 1000 || 0, easing: token('--settle') || 'ease' });
}

/** A fold has opened or closed (its class is already changed): measured as it was, then as it is.
 * @param {HTMLElement} box @param {string} cls @param {Element | null} body @param {Element | null} scroller */
function disclose(box, cls, body, scroller) {
  if (!body || !scroller) return;
  const on = box.classList.contains(cls);
  const els = around(box, scroller);
  box.classList.toggle(cls, !on);
  const was = tops(els);
  box.classList.toggle(cls, on);
  halt(els);
  const dys = moved(els, was);
  const duration = parseFloat(token('--d-base')) || 0;
  if (!duration) return;
  const time = { duration, easing: token('--settle') || 'ease' };
  slide(els, dys, time);
  // Opening, what it holds is uncovered from the top down as its height grows (closing hid it at once).
  if (body.classList.contains('gbody') ? !on : on) {
    try {
      body.animate([{ clipPath: 'inset(0 0 100%)' }, { clipPath: 'inset(0 0 0)' }], time);
    } catch {}
  }
}

/** Watches home and the menu for a card that starts to fold and a fold that opens or closes. */
export function watchFolds() {
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      const c = /** @type {HTMLElement} */ (m.target);
      const was = m.oldValue ?? '';
      if (c.classList.contains('card')) {
        if ((c.classList.contains('gone') || c.classList.contains('fold')) && !done.has(c)) fold(c);
      } else if (c.classList.contains('cg') && c.classList.contains('closed') !== /\bclosed\b/.test(was)) {
        disclose(c, 'closed', c.querySelector(':scope > .gbody'), c.closest('.sidescroll'));
      } else if (c.classList.contains('how') && c.classList.contains('open') !== /\bopen\b/.test(was)) {
        disclose(c, 'open', c.querySelector(':scope > .howin'), c.closest('#convo'));
      }
    }
    mo.takeRecords(); // (its own measuring toggles)
  });
  for (const id of ['home', 'side']) {
    const root = document.getElementById(id);
    if (root) mo.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }
}
