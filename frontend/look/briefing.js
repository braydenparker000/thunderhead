// @ts-check
// Ink and Lamp's behaviour on the Briefing (builder C; design S-Briefing-*): it runs only while the
// look is on (whileOn) and, turned off, takes away all it added. A head over the page, as a book of
// hours opens: the round back key (it presses the page's own Back home) and its legend, the weekday's
// name in Jacquard 24 with the date and time in italic, the day's verse with a red drop initial and
// its reference (the plate of the day, look/plates.js, the same as home's), then j.j. The page's own
// date stays for a screen reader. In "Today", a line's time is set apart into the left column.
import { whileOn } from './look.js';
import { plateFor } from './plates.js';

const SVG = 'http://www.w3.org/2000/svg';
const BACK = 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z';
const TIME = /^(\d{1,2}:\d{2}) (.+)$/s;

/** @param {string} tag @param {string} cls @param {string} [text] */
const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** The verse as the plate gives it: a drop initial (its first letter), the rest, the reference.
 * @param {HTMLElement} host @param {{ verse: string, ref: string } | null} p */
function verse(host, p) {
  if (!p?.verse) { host.hidden = true; return; }
  const at = p.verse.search(/\p{L}/u);
  const lead = p.verse.slice(0, Math.max(0, at));
  const ini = make('span', 'lk-ini', p.verse.charAt(at).toUpperCase());
  const rest = make('span', 'lk-vt', lead + p.verse.slice(at + 1));
  for (const n of [ini, rest]) n.setAttribute('aria-hidden', 'true');
  const ref = make('span', 'lk-ref', p.ref);
  ref.setAttribute('aria-hidden', 'true');
  host.setAttribute('aria-label', `${p.verse} ${p.ref}`);
  host.replaceChildren(ini, rest, ref);
  host.hidden = false;
}

/** "Today"'s lines that begin with a time: the time in its own span (the text reads the same).
 * @param {Element} grid */
function times(grid) {
  for (const v of grid.querySelectorAll('.tile.cal > .v, .tile.cal > .s')) {
    if (v.querySelector('.lk-t')) continue;
    const m = TIME.exec(v.textContent ?? '');
    if (m) v.replaceChildren(make('span', 'lk-t', m[1]), ` ${m[2]}`);
  }
}

whileOn(() => {
  const page = document.getElementById('brief');
  if (!page) return;
  const back = make('button', 'lk-round lk-back');
  Object.assign(back, { type: 'button' });
  back.setAttribute('aria-label', 'Back home');
  const caret = document.createElementNS(SVG, 'svg');
  caret.setAttribute('viewBox', '0 0 256 256');
  caret.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', BACK);
  caret.append(path);
  back.append(caret);
  back.addEventListener('click', () => document.getElementById('bback')?.click());
  const here = make('span', 'lk-here', 'briefing');
  here.append(make('i', ''));
  const top = make('div', 'lk-top');
  const leg = make('span', 'lk-leg', 'home');
  for (const n of [leg, here]) n.setAttribute('aria-hidden', 'true');
  top.append(back, leg, here);
  const weekday = make('span', 'lk-wd');
  const date = make('span', 'lk-dt');
  const day = make('div', 'lk-day');
  day.setAttribute('aria-hidden', 'true');
  day.append(weekday, date);
  const quote = /** @type {HTMLElement} */ (make('blockquote', 'lk-verse'));
  quote.hidden = true;
  const jj = make('div', 'lk-jj', 'j.j.');
  jj.setAttribute('aria-hidden', 'true');
  const head = make('div', 'lk-bh');
  head.append(top, day, quote, jj);
  page.prepend(head);

  // The day and the time, each minute; the verse again when the day or the theme (its set) turns.
  let shown = '';
  const clock = () => {
    const now = new Date();
    weekday.textContent = now.toLocaleDateString('en-GB', { weekday: 'long' });
    const hm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    date.textContent = `${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · ${hm}`;
    const key = `${now.toDateString()}|${document.documentElement.dataset.theme}`;
    if (key !== shown) {
      shown = key;
      void plateFor(now).then((p) => { if (shown === key) verse(quote, p); });
    }
  };
  clock();
  const tick = setInterval(clock, 15_000);
  const themed = new MutationObserver(clock);
  themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-day'] });
  const grid = page.querySelector('.grid');
  const drawn = new MutationObserver(() => grid && times(grid));
  if (grid) {
    times(grid);
    drawn.observe(grid, { childList: true });
  }
  return () => {
    clearInterval(tick);
    themed.disconnect();
    drawn.disconnect();
    head.remove();
    for (const t of page.querySelectorAll('.lk-t')) {
      const v = t.parentElement;
      t.remove();
      if (v) v.textContent = `${t.textContent}${v.textContent}`;
    }
  };
});
