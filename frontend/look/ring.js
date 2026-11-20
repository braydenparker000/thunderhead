// @ts-check
// Ink and Lamp's behaviour on the ring: builder B's. It runs only while the look is on (whileOn).
// Home (apps/home/home.js) opens, moves and closes the ring as ever; this dresses what it draws: each
// app's woodcut emblem on its key, and what shows the choice, the hand by day (Ink) and the light by
// night (Lamp), both in one element at the ring's centre that turns on the springs to the app chosen
// (th:ring) and goes when nothing is chosen or the ring is let go. The veil behind the ring is centred
// on it (ring.css). Only transform and opacity move.
import { whileOn, LOOK } from './look.js';
import { animator, springs } from '/th/motion.js';

// The registry's icons (th/registry/apps.js) and the emblem each app wears.
const EMBLEM = /** @type {Record<string, string>} */ ({ 'music-notes-simple': 'harp', microphone: 'trumpet', 'monitor-play': 'star', guitar: 'lute', 'book-bookmark': 'book', aperture: 'picture', 'youtube-logo': 'chest' });

/** Puts its emblem on each key not yet dressed. @param {Element} ring */
function emblems(ring) {
  for (const face of ring.querySelectorAll('.pet .face')) {
    if (face.querySelector('.lk-r-em')) continue;
    const icon = (face.querySelector('use')?.getAttribute('href') ?? '').split('#')[1]?.replace(/-fill$/, '') ?? '';
    const name = EMBLEM[icon];
    if (!name) continue;
    // One on the face, which home fades; on Ink a second over the key, whole while the ring is out.
    const em = `<svg class="lk-r-em" aria-hidden="true"><use href="${LOOK}emblems.svg#em-${name}"/></svg>`;
    face.insertAdjacentHTML('beforeend', em);
    face.insertAdjacentHTML('afterend', em.replace('lk-r-em', 'lk-r-em lk-r-up'));
  }
}

whileOn(() => {
  const ring = document.getElementById('ring'), scrim = document.getElementById('scrim');
  if (!ring || !scrim) return;
  emblems(ring);
  const aim = document.createElement('div');
  aim.className = 'lk-r-aim';
  aim.setAttribute('aria-hidden', 'true');
  aim.innerHTML = `<i class="lk-r-beam"></i><img class="lk-r-hand" src="${LOOK}art/hand.webp" alt="" decoding="async">`;
  const lens = Object.assign(document.createElement('i'), { className: 'lk-r-lens' });
  ring.prepend(aim, lens);
  const turn = animator((v) => { aim.style.transform = `rotate(${v}deg)`; });
  // A choice: the angle of the key now on (0 is up, clockwise), reached the short way round.
  const chose = (/** @type {Event} */ e) => queueMicrotask(() => {
    const pets = [...ring.querySelectorAll('.pet')], i = pets.findIndex((p) => p.classList.contains('on'));
    if (!(/** @type {CustomEvent} */ (e).detail) || i < 0) { aim.classList.remove('on'); return; }
    const to = i * 360 / pets.length;
    if (!aim.classList.contains('on')) { turn.set(to); aim.classList.add('on'); return; }
    turn.to(turn.value + ((to - turn.value) % 360 + 540) % 360 - 180, { spring: springs.pop });
  });
  document.addEventListener('th:ring', chose);
  // Let go (the scrim leaves at once) or opened again: nothing is chosen.
  const watch = new MutationObserver(() => {
    if (!scrim.classList.contains('show')) aim.classList.remove('on');
    scrim.style.setProperty('--lk-rx', ring.style.left || '50%');
    scrim.style.setProperty('--lk-ry', ring.style.top || '50%');
    emblems(ring);
  });
  watch.observe(scrim, { attributes: true, attributeFilter: ['class'] });
  watch.observe(ring, { attributes: true, attributeFilter: ['style'], childList: true });
  return () => {
    document.removeEventListener('th:ring', chose);
    watch.disconnect(); turn.stop(); aim.remove(); lens.remove();
    for (const n of ring.querySelectorAll('.lk-r-em')) n.remove();
    scrim.style.removeProperty('--lk-rx'); scrim.style.removeProperty('--lk-ry');
  };
});
