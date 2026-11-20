// @ts-check
// Ink and Lamp's behaviour on the island: builder B's. It runs only while the look is on (whileOn).
// The island's own modules (th/island/) draw and move it; this only dresses what they render: a
// five-dot level meter in place of the bars (the capsule), the lamp with the app's name (the expanded
// card), and, where what plays has no artwork (or Island › Artwork is off), two tape reels in the
// artwork's place and the tape deck on the card; with artwork the island's own picture shows, as the
// owner asked (2026-11-20), and `.lk-i-art` on the island says so. island.css draws them. While
// something plays the reels turn (the take-up faster) and the meter shows a level: the sound's, read
// from the heights the island writes on its bars while Music's analyser drives them (.live), else a
// level of its own. Only what shows moves, by transform and opacity; under reduced motion nothing.
import { whileOn } from './look.js';
import { motionReduced } from '/th/motion.js';

/** A span of `n` <i>, aria-hidden. @param {string} name @param {number} n @param {string} [more] */
const part = (name, n, more = '') => Object.assign(document.createElement('span'), { className: `lk-i-${name}`, ariaHidden: 'true', innerHTML: '<i></i>'.repeat(n) + more });
// The meter's own level, a step every 180 ms; dot k is lit while the level is k or more.
const LEVELS = [3, 4, 2, 5, 3, 1, 4, 2];
/** @param {number} k */
const blink = (k) => [...LEVELS.map((l, i) => ({ offset: i / LEVELS.length, opacity: +(l >= k), easing: 'steps(1, end)' })), { offset: 1, opacity: +(LEVELS.at(-1) >= k) }];

/** The island sizes its capsule by its title as drawn (th/island/capsule.js, again on a resize): once
 * the look's type has come, or gone, or the artwork has, it measures again. */
const remeasure = () => { if (document.querySelector('body > .th-island:not([hidden])')) dispatchEvent(new Event('resize')); };

/** Dresses one island; returns what takes it all away again. @param {HTMLElement} is */
function dress(is) {
  const compact = is.querySelector('.compact'), bars = is.querySelector('.bars'), details = is.querySelector('.details'), art = is.querySelector('.art');
  if (!compact || !bars || !details || !art) return () => {};
  const reels = part('reels', 2), meter = part('meter', 5), head = part('head', 0, '<i class="lk-i-lamp"></i><span class="lk-i-app"></span>'), deck = part('deck', 2);
  compact.prepend(reels);
  bars.after(meter);
  details.prepend(head, deck);
  const app = /** @type {HTMLElement} */ (head.lastElementChild), dots = [...meter.children].slice(1);
  /** @type {Map<Element, Animation>} */
  const moving = new Map();
  /** Starts or stops one element's loop. @param {Element} el @param {boolean} go @param {() => Animation} start */
  const loop = (el, go, start) => {
    if (go && !moving.has(el)) moving.set(el, start());
    else if (!go) { moving.get(el)?.cancel(); moving.delete(el); }
  };
  const sync = () => {
    app.textContent = (is.dataset.app ?? '').toLowerCase();
    const live = is.classList.contains('live'), on = is.classList.contains('playing') && !motionReduced(), wide = is.dataset.state === 'expanded';
    // Its artwork, where it has one: the capsule is then narrower, so the island measures it again.
    const pictured = art.classList.contains('has-art') && document.documentElement.dataset.islandArt !== 'false';
    if (pictured !== is.classList.contains('lk-i-art')) { is.classList.toggle('lk-i-art', pictured); remeasure(); }
    if (!live) delete meter.dataset.level;
    [...reels.children, ...deck.children].forEach((el, i) => loop(el, on && !pictured && wide === i > 1, () => el.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: i % 2 ? 3200 : 4800, iterations: Infinity })));
    dots.forEach((el, i) => loop(el, on && !wide && !live, () => el.animate(blink(i + 2), { duration: 180 * LEVELS.length, iterations: Infinity, pseudoElement: '::after' })));
  };
  sync();
  const own = new MutationObserver(sync);
  own.observe(is, { attributes: true, attributeFilter: ['data-app', 'class', 'data-state'] });
  own.observe(art, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('th:setting', sync);
  // While the sound drives the bars: their mean height (.15 to 1) lights one to five dots.
  const heights = /** @type {HTMLElement[]} */ ([...bars.children]);
  const sound = new MutationObserver(() => {
    if (!is.classList.contains('live')) return;
    const sum = heights.reduce((n, b) => n + Number(/scaleY\(([\d.]+)\)/.exec(b.style.transform)?.[1] ?? .15), 0);
    const n = String(Math.max(1, Math.min(5, Math.round(sum / heights.length * 5))));
    if (meter.dataset.level !== n) meter.dataset.level = n;
  });
  for (const b of heights) sound.observe(b, { attributes: true, attributeFilter: ['style'] });
  return () => {
    own.disconnect(); sound.disconnect(); document.removeEventListener('th:setting', sync);
    for (const a of moving.values()) a.cancel();
    for (const n of [reels, meter, head, deck]) n.remove();
    is.classList.remove('lk-i-art');
  };
}

whileOn(() => {
  let alive = true;
  const css = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[data-look]'));
  const sheet = css && !css.sheet ? new Promise((r) => css.addEventListener('load', r, { once: true })) : Promise.resolve();
  void sheet.then(() => document.fonts.ready).then(() => requestAnimationFrame(() => { if (alive) remeasure(); }));
  /** @type {(() => void) | null} */
  let undress = null;
  const find = () => {
    if (undress) return;
    const is = /** @type {HTMLElement | null} */ (document.querySelector('body > .th-island'));
    if (is) { undress = dress(is); arrive.disconnect(); }
  };
  // The capsule is made the first time it is needed (th/island/capsule.js), straight into <body>.
  const arrive = new MutationObserver(find);
  arrive.observe(document.body, { childList: true });
  find();
  return () => { alive = false; arrive.disconnect(); undress?.(); undress = null; remeasure(); };
});
