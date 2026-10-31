// @ts-check
// A tapped reply's actions (HOME.md §4.3): Copy, Shorter, Say more and Ask about this, in a row
// that slides out under it, one row at a time; a second tap closes it. Shorter and Say more go
// as the owner's message answering that reply (reply_to); Ask about this puts a quote of it over
// the ask bar, and the next message answers it. Loaded on the first tap.
import { toast } from '../ui.js';

const ASKS = /** @type {[string, string][]} */ ([
  ['Shorter', 'Shorter, please.'],
  ['Say more', 'Say more about that.'],
]);

/** The reply's text, flat and short, for the quote. @param {string} s */
const excerpt = (s) => {
  const t = s.replace(/\[\[book:[^\]]*\]\]/g, '').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
};

/** @param {string} label @param {() => void} fn */
function button(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

/**
 * @param {HTMLElement} node the reply's keyed node in the turn
 * @param {{ id: string, body: string }} m
 * @param {{ send: (text: string, replyTo: string) => void }} o
 */
export function toggle(node, m, o) {
  const had = node.nextElementSibling?.classList.contains('ractions');
  for (const r of document.querySelectorAll('.ractions')) r.remove();
  if (had) return;
  const row = document.createElement('div');
  row.className = 'ractions';
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', 'Reply actions');
  const done = (/** @type {() => void} */ fn) => () => {
    row.remove();
    fn();
  };
  row.append(
    button(
      'Copy',
      done(async () => {
        try {
          await navigator.clipboard.writeText(m.body);
          toast('Copied');
        } catch {
          toast("Couldn't copy. Hold the text to select it.");
        }
      }),
    ),
    ...ASKS.map(([label, text]) => button(label, done(() => o.send(text, m.id)))),
    button('Ask about this', done(() => about(m))),
  );
  node.after(row);
}

/** "Ask about this": the quote over the ask bar, with ✕; home's send reads and clears it. @param {{ id: string, body: string }} m */
export function about(m) {
  document.querySelector('#about')?.remove();
  const chip = document.createElement('div');
  chip.id = 'about';
  chip.dataset.id = m.id;
  const text = document.createElement('span');
  text.textContent = `About: ${excerpt(m.body)}`;
  const x = button('', () => chip.remove());
  x.setAttribute('aria-label', 'Not about this');
  x.innerHTML = '<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#x"/></svg>';
  chip.append(text, x);
  document.querySelector('#ask')?.before(chip);
  // The conversation's end, a docked card and the toasts keep above the quote while it shows (audit
  // fix 8: it covered the newest turn), and come back down once it goes (sent or ✕).
  const lift = () => document.documentElement.style.setProperty('--about-h', chip.isConnected ? `${chip.offsetHeight + 8}px` : '0px');
  if (chip.parentElement) new MutationObserver((_, o) => {
    if (chip.isConnected) return;
    lift();
    o.disconnect();
  }).observe(chip.parentElement, { childList: true });
  lift();
  /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'))?.focus();
}
