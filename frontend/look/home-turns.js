// @ts-check
// Ink and Lamp's initials (approved screens R-Grey / R-Dark): each of the Thunderhead's messages
// opens with its first letter in Jacquard 24 in rubric, a drop initial two lines tall for a message
// of two or more lines, a raised one for a one-line message. The letter itself is CSS's
// ::first-letter (look/chat.css), so the text is never split (Find in today and a screen reader read
// it whole); this only says which kind, by a class on the reply: `lk-drop` or `lk-raise`. A reply gets
// none unless it opens with a paragraph whose first character, after an opening mark (¿ ¡ « “ ‘ " ',
// which ::first-letter carries with it), is a Latin letter in plain text or emphasis: a list, a heading, a quotation, code, a
// table, a number, an emoji or a link opens with no initial. Also the ask bar's words: off the record
// they say so, and a line longer than the bar fades at its left edge.

const MARKS = /^[\s¿¡«“‘"']*/u;
const LETTER = /^\p{Script=Latin}/u;
const PLAIN = new Set(['B', 'STRONG', 'I', 'EM', 'SPAN']);

/** Whether the reply may open with an initial. @param {HTMLElement} r */
export function eligible(r) {
  if (r.classList.contains('progress')) return false;
  const p = r.firstElementChild;
  if (!p || p.tagName !== 'P') return false;
  // The first thing in the paragraph: text, or plain emphasis (a word-reveal span included).
  for (let n = p.firstChild; n; n = n.firstChild) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!n.textContent?.trim()) return false;
      break;
    }
    if (n.nodeType !== Node.ELEMENT_NODE || !PLAIN.has(/** @type {Element} */ (n).tagName)) return false;
  }
  return LETTER.test((p.textContent ?? '').replace(MARKS, ''));
}

/** The kind of initial a reply takes, measured as it is drawn. @param {HTMLElement} r */
function mark(r) {
  r.classList.remove('lk-drop', 'lk-raise');
  if (!r.isConnected || !eligible(r)) return;
  const p = /** @type {HTMLElement} */ (r.firstElementChild);
  const line = parseFloat(getComputedStyle(p).lineHeight) || 26;
  // Two lines or more in its opening paragraph: a drop; a one-line paragraph (alone, or before a
  // list or a table) is never cut into by one: a raised initial.
  r.classList.add(p.getBoundingClientRect().height > line * 1.5 ? 'lk-drop' : 'lk-raise');
}

export function turns() {
  const convo = document.getElementById('convo');
  if (!convo) return;
  const all = () => convo.querySelectorAll('.reply').forEach((r) => mark(/** @type {HTMLElement} */ (r)));
  /** @type {Set<HTMLElement>} */
  const due = new Set();
  let queued = 0;
  const flush = () => { queued = 0; for (const r of due) mark(r); due.clear(); };
  const seen = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.matches('.reply')) due.add(n);
      n.querySelectorAll('.reply').forEach((r) => due.add(/** @type {HTMLElement} */ (r)));
      const up = n.parentElement?.closest('.reply');
      if (up) due.add(/** @type {HTMLElement} */ (up));
    }
    if (due.size && !queued) queued = requestAnimationFrame(flush);
  });
  seen.observe(convo, { childList: true, subtree: true });
  all();
  document.fonts.ready.then(all, () => {});
  // A new width or text size can make a one-line message two lines, or the other way.
  let width = convo.clientWidth;
  const sized = new ResizeObserver(() => { if (convo.clientWidth !== width) { width = convo.clientWidth; all(); } });
  sized.observe(convo);
  const size = new MutationObserver(() => requestAnimationFrame(all));
  size.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text'] });

  // Off the record the bar says "Ask, off the record" (th/record says "Off the record").
  const q = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('q'));
  const OWN = 'Off the record', OURS = 'Ask, off the record';
  const words = () => { if (q?.placeholder === OWN) q.placeholder = OURS; };
  const ph = new MutationObserver(words);
  if (q) { ph.observe(q, { attributes: true, attributeFilter: ['placeholder'] }); words(); }

  // The words run on to the left on one line; once they do, their left edge fades.
  const ask = document.getElementById('ask');
  const over = () => ask?.classList.toggle('lk-over', (q?.scrollLeft ?? 0) > 0);
  q?.addEventListener('scroll', over, { passive: true });
  q?.addEventListener('input', over);

  return () => {
    q?.removeEventListener('scroll', over);
    q?.removeEventListener('input', over);
    ask?.classList.remove('lk-over');
    seen.disconnect();
    sized.disconnect();
    ph.disconnect();
    cancelAnimationFrame(queued);
    size.disconnect();
    convo.querySelectorAll('.lk-drop, .lk-raise').forEach((r) => r.classList.remove('lk-drop', 'lk-raise'));
    if (q?.placeholder === OURS) q.placeholder = OWN;
  };
}
