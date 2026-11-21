// @ts-check
// An app's frame in front keeps the settled window's height in px (MUSIC.md §5.10): on the phone home's
// window goes 731 → 759 → 731 at every keyboard open and close (Chrome's bar hides while the keyboard is
// up), which would resize the app's window each time. The frame's height moves only on a real change: a
// new width (orientation), or a height that lasts SETTLE_MS with no keyboard over home.

const SETTLE_MS = 300;
/** Home's visual viewport this much shorter than its window: a keyboard is up. */
const KEYBOARD_PX = 150;

/** @type {HTMLIFrameElement|null} */
let held = null;
let height = 0, width = 0, timer = 0, checks = 0;
/** The settled height last held at each width (an orientation), so a front with the keyboard up takes this one's. @type {Map<number, number>} */
const settled = new Map();

/**
 * The height a frame takes as it comes to the front: the window's, unless a keyboard is up; then the one
 * held last at this width (this orientation), never another orientation's; with none, the window's.
 * @param {Map<number, number>} byWidth @param {number} w @param {number} h @param {boolean} keyboard
 */
export function frontHeight(byWidth, w, h, keyboard) {
  return keyboard ? byWidth.get(w) ?? h : h;
}

const keyboardUp = () => {
  const vv = window.visualViewport;
  return Boolean(vv) && innerHeight - /** @type {VisualViewport} */ (vv).height * /** @type {VisualViewport} */ (vv).scale > KEYBOARD_PX;
};

/** @param {number} h */
function apply(h) {
  height = h; width = innerWidth;
  if (!keyboardUp()) settled.set(width, h);
  if (held) held.style.height = `${h}px`;
}

function changed() {
  if (!held) return;
  clearTimeout(timer);
  if (innerWidth !== width && !keyboardUp()) { apply(innerHeight); return; }
  const seen = innerHeight;
  timer = window.setTimeout(() => {
    checks++;
    if (held?.parentElement) held.parentElement.dataset.heightChecks = String(checks);
    if (held && innerHeight === seen && !keyboardUp() && seen !== height) apply(seen);
  }, SETTLE_MS);
}

globalThis.addEventListener?.('resize', changed);
globalThis.visualViewport?.addEventListener('resize', changed);

/**
 * The frame in front (its height held), or null when none is (the frame back to its shell's height).
 * @param {HTMLIFrameElement|null} frame
 */
export function holdHeight(frame) {
  if (frame === held) return;
  if (held) held.style.removeProperty('height');
  held = frame;
  clearTimeout(timer);
  if (!frame) return;
  // At the front: the window now, unless a keyboard is up (then this orientation's settled height, if any).
  apply(frontHeight(settled, innerWidth, innerHeight, keyboardUp()));
}
