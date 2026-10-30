// @ts-check
// Find in today (HOME.md §4.10): pulled down from the top of the conversation, a field that marks
// every match in today's turns with the CSS Custom Highlight API (the text itself is never
// changed), says "2 of 5", and steps through them with ↑ ↓ or Enter, newest first; ✕ or Escape
// closes it. Loaded on the first pull.

/** @type {HTMLElement | null} */
let bar = null;

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {Record<string, string>} [attrs] */
function el(tag, attrs = {}) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** @param {string} label @param {string} icon */
function iconButton(label, icon) {
  const b = el('button', { type: 'button', 'aria-label': label });
  b.innerHTML = `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${icon}"/></svg>`;
  return b;
}

/** Every place `q` (lower case) appears in the text under `root`, outside the reply slot. @param {Element} root @param {string} q */
export function matches(root, q) {
  /** @type {Range[]} */
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.slot,.ractions') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = /** @type {string} */ (n.nodeValue);
    const low = text.toLowerCase();
    if (low.length !== text.length) continue;
    for (let at = low.indexOf(q); at >= 0; at = low.indexOf(q, at + q.length)) {
      const r = new Range();
      r.setStart(n, at);
      r.setEnd(n, at + q.length);
      out.push(r);
    }
  }
  return out;
}

export function openFind() {
  if (bar) return void bar.querySelector('input')?.focus();
  const talk = /** @type {HTMLElement} */ (document.querySelector('#talk'));
  const convo = /** @type {HTMLElement} */ (document.querySelector('#convo'));
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'search', placeholder: 'Find in today', 'aria-label': 'Find in today', enterkeyhint: 'search', autocomplete: 'off' }));
  const count = el('span', { class: 'fcount', 'aria-live': 'polite' });
  const up = iconButton('Earlier match', 'caret-right');
  const down = iconButton('Later match', 'caret-right');
  const close = iconButton('Close find', 'x');
  up.classList.add('up');
  down.classList.add('down');
  const box = el('div', { class: 'findbar', role: 'search' });
  box.append(input, count, up, down, close);
  bar = box;
  convo.parentElement?.append(box);
  /** @type {Range[]} */
  let hits = [];
  let at = 0;
  const show = () => {
    count.textContent = input.value.trim().length < 2 ? '' : hits.length ? `${at + 1} of ${hits.length}` : 'No match';
    if (!('highlights' in CSS)) return;
    CSS.highlights.set('find', new Highlight(...hits));
    if (hits[at]) {
      CSS.highlights.set('find-now', new Highlight(hits[at]));
      const r = hits[at].getBoundingClientRect();
      const c = convo.getBoundingClientRect();
      convo.scrollBy({ top: r.top - c.top - c.height / 3, behavior: 'smooth' });
    } else CSS.highlights.delete('find-now');
  };
  const run = () => {
    const q = input.value.trim().toLowerCase();
    hits = q.length >= 2 ? matches(talk, q) : [];
    at = Math.max(0, hits.length - 1);
    show();
  };
  const step = (/** @type {number} */ d) => {
    if (!hits.length) return;
    at = (at + d + hits.length) % hits.length;
    show();
  };
  const end = () => {
    if ('highlights' in CSS) {
      CSS.highlights.delete('find');
      CSS.highlights.delete('find-now');
    }
    box.remove();
    bar = null;
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') end();
    else if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? 1 : -1);
    }
  });
  up.addEventListener('click', () => step(-1));
  down.addEventListener('click', () => step(1));
  close.addEventListener('click', end);
  requestAnimationFrame(() => box.classList.add('in'));
  input.focus();
}
