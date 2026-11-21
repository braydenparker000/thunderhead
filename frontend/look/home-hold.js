// @ts-check
// Ink and Lamp's places to hold for the ring (the owner, 2026-11-21: "A few more gaps to press and
// hold to open apps"). Home opens the ring on a hold only where nothing of its own is under the
// finger (apps/home/home.js, blocked()), and asks with `th:hold` before it refuses: under the look a
// hold is the ring's also on the day's picture and its verse block, on the header line (all but
// the rec switch, so also over a message scrolled up under it), and in the conversation's outer
// 16 px each side. A hold on a message's text elsewhere still selects it, and on a button, a link
// or a field it is still theirs. The hold time and slop are home's own.

/** Whether a hold at (x, y) on `el` is free for the ring under the look.
 * @param {Element} el @param {number} x @param {number} y */
export function free(el, x, y) {
  if (el.closest('button,a,input,textarea,select,[role="button"],[role="switch"],.lk-rec,#ask,#opts,.dock')) return false;
  if (el.closest('.lk-front')) return true;
  const head = document.querySelector('#home > .lk-head')?.getBoundingClientRect();
  if (head && y >= head.top && y < head.bottom && x >= head.left && x < head.right) return true;
  const convo = document.getElementById('convo');
  if (!convo?.contains(el)) return false;
  const c = convo.getBoundingClientRect();
  return x < c.left + 16 || x >= c.right - 16;
}

export function hold() {
  const ask = (/** @type {Event} */ e) => {
    const p = /** @type {CustomEvent<PointerEvent>} */ (e).detail;
    if (p?.target instanceof Element && free(p.target, p.clientX, p.clientY)) e.preventDefault();
  };
  document.addEventListener('th:hold', ask);
  return () => document.removeEventListener('th:hold', ask);
}
