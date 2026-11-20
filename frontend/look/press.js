// @ts-check
// Ink and Lamp: a key's pressed picture the moment a finger is on it. The browser's own :active comes
// late on a phone, or not at all where a page takes the touch (the island), so while the look is on
// the key under a pointer that goes down carries `.lk-down` (the sheets press on `:is(:active,.lk-down)`)
// until the pointer is lifted or cancelled (a scroll began), or slides more than 12 px off the key
// (then the tap would not be a click either). Rows of a list keep the browser's own, so a scroll that
// starts on one never flashes it. Nothing is read per move but the pointer's own coordinates.

const KEYS = 'button,[role="button"],[role="radio"],.seg-option';
const SLOP = 12;

export function press() {
  /** @type {{ el: Element, id: number, box: DOMRect } | null} */
  let down = null;
  const lift = () => {
    if (down) { down.el.classList.remove('lk-down'); if (!down.el.classList.length) down.el.removeAttribute('class'); }
    down = null;
  };
  const start = (/** @type {PointerEvent} */ e) => {
    lift();
    if (!e.isPrimary || e.button > 0) return;
    const el = /** @type {Element | null} */ (/** @type {Element} */ (e.target).closest?.(KEYS) ?? null);
    if (!el || /** @type {HTMLButtonElement} */ (el).disabled || el.matches('.row:not([data-action="reset"]),.tile')) return;
    down = { el, id: e.pointerId, box: el.getBoundingClientRect() };
    el.classList.add('lk-down');
  };
  const move = (/** @type {PointerEvent} */ e) => {
    if (!down || e.pointerId !== down.id) return;
    const b = down.box, x = e.clientX, y = e.clientY;
    const near = x > b.left - SLOP && x < b.right + SLOP && y > b.top - SLOP && y < b.bottom + SLOP;
    down.el.classList.toggle('lk-down', near);
    if (!down.el.classList.length) down.el.removeAttribute('class');
  };
  const end = (/** @type {PointerEvent} */ e) => { if (down && e.pointerId === down.id) lift(); };
  const seen = () => { if (document.hidden) lift(); };
  const opts = { capture: true, passive: true };
  document.addEventListener('pointerdown', start, opts);
  document.addEventListener('pointermove', move, opts);
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, /** @type {EventListener} */ (end), opts);
  window.addEventListener('blur', lift);
  document.addEventListener('visibilitychange', seen);
  return () => {
    lift();
    document.removeEventListener('pointerdown', start, opts);
    document.removeEventListener('pointermove', move, opts);
    for (const t of ['pointerup', 'pointercancel']) document.removeEventListener(t, /** @type {EventListener} */ (end), opts);
    window.removeEventListener('blur', lift);
    document.removeEventListener('visibilitychange', seen);
  };
}
