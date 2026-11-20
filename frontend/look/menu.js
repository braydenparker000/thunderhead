// @ts-check
// Ink and Lamp's behaviour on the menu (builder C; design S-Menu-*): it runs only while the look is
// on (whileOn) and, turned off, takes away all it added. The Lamb, the Thunderhead's own mark, at the
// right of the title line; Settings' key as the kit's small dial with its legend; Now's count of
// messages set apart from its date ("Thursday 29 October · 6 messages": the date in his face, the
// count in the legend face at the right), kept so as the menu redraws it (convos/menu.js drawNow).
import { LOOK, whileOn } from './look.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Now's line split at its " · ", once each time the menu writes it. @param {Element} now */
function split(now) {
  const sub = now.querySelector('.sub');
  if (!sub || sub.querySelector('.lk-n')) return;
  const text = sub.textContent ?? '';
  const at = text.indexOf(' · ');
  if (at < 0) return;
  const sep = document.createElement('span');
  sep.className = 'lk-sep';
  sep.textContent = ' · ';
  const n = document.createElement('span');
  n.className = 'lk-n';
  n.textContent = text.slice(at + 3);
  // The text reads the same (the menu compares it), the count only drawn apart.
  sub.replaceChildren(text.slice(0, at), sep, n);
}

whileOn(() => {
  const scroll = document.getElementById('sidescroll');
  const settings = document.getElementById('settings');
  const now = document.getElementById('now');
  /** @type {Element[]} */
  const added = [];
  if (scroll) {
    const lamb = document.createElementNS(SVG, 'svg');
    lamb.setAttribute('class', 'lk-lamb');
    lamb.setAttribute('role', 'img');
    lamb.setAttribute('aria-label', 'The Lamb');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `${LOOK}emblems.svg#em-lamb`);
    lamb.append(use);
    scroll.querySelector('.sidetitle')?.after(lamb);
    added.push(lamb);
  }
  if (settings) {
    const dial = document.createElement('span');
    dial.className = 'lk-dial lk-dial--small';
    const leg = document.createElement('span');
    leg.className = 'lk-leg';
    leg.textContent = 'settings';
    for (const n of [dial, leg]) n.setAttribute('aria-hidden', 'true');
    settings.append(dial, leg);
    added.push(dial, leg);
  }
  const watch = new MutationObserver(() => now && split(now));
  if (now) {
    split(now);
    watch.observe(now, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    watch.disconnect();
    for (const n of added) n.remove();
    for (const n of document.querySelectorAll('#now :is(.lk-sep,.lk-n)')) n.replaceWith(n.textContent ?? '');
    now?.querySelector('.sub')?.normalize();
  };
});
