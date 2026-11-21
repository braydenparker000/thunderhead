// @ts-check
// A search hit's words marked on the page it opens (STUDY.md §5.2): in the page's text layer, every
// occurrence of a word the search matched there (accents and case ignored), wrapped in a <mark>
// that tints the page under it.

const fold = (/** @type {string} */ s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Marks `words` in a rendered text layer; returns how many were marked.
 * @param {HTMLElement} layer @param {string[]} words */
export function markWords(layer, words) {
  const wanted = [...new Set(words.map(fold).filter((w) => w.length >= 2))];
  if (!wanted.length) return 0;
  let n = 0;
  for (const span of layer.querySelectorAll('span')) {
    const node = span.firstChild;
    if (span.childNodes.length !== 1 || !node || node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent ?? '';
    // Folding keeps each letter in place for these scripts, so offsets in the folded text hold.
    const folded = fold(text);
    if (folded.length !== text.length) continue;
    /** @type {[number, number][]} */
    const at = [];
    for (const w of wanted) for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + w.length)) at.push([i, i + w.length]);
    if (!at.length) continue;
    at.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let end = 0;
    for (const [a, b] of at) {
      if (a < end) continue;
      frag.append(text.slice(end, a));
      const m = document.createElement('mark');
      m.className = 'hitw';
      m.textContent = text.slice(a, b);
      frag.append(m);
      end = b;
      n++;
    }
    frag.append(text.slice(end));
    span.replaceChildren(frag);
  }
  return n;
}
