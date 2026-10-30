// A page's blocks (STUDY.md §3.3 step 7): the text split on blank lines, blocks under 80
// characters merged into the next, blocks over 1,500 split at the sentence end nearest the middle
// (or a space, or plainly), numbered 1..n by their order. Each block is [start, end) into the
// page's own text, trimmed of the white space around it, so a citation `book:<id>#p<n>.b<k>`
// points at exact characters.

export const MIN_BLOCK = 80;
export const MAX_BLOCK = 1_500;

/** @param {string} text @returns {[number, number][]} */
export function blocksOf(text) {
  /** @type {[number, number][]} */
  const paras = [];
  const gap = /\n[ \t]*\n\s*/g;
  let from = 0;
  for (const m of text.matchAll(gap)) {
    paras.push([from, m.index]);
    from = m.index + m[0].length;
  }
  paras.push([from, text.length]);
  const trimmed = paras.map(([a, b]) => trim(text, a, b)).filter(([a, b]) => b > a);
  /** @type {[number, number][]} */
  const merged = [];
  for (const [a, b] of trimmed) {
    const last = merged.at(-1);
    if (last && last[1] - last[0] < MIN_BLOCK) last[1] = b;
    else merged.push([a, b]);
  }
  // A short last block joins the one before it.
  if (merged.length > 1 && merged.at(-1)[1] - merged.at(-1)[0] < MIN_BLOCK) merged.splice(-2, 2, [merged.at(-2)[0], merged.at(-1)[1]]);
  return merged.flatMap(([a, b]) => split(text, a, b));
}

/** @param {string} text @param {number} a @param {number} b @returns {[number, number]} */
function trim(text, a, b) {
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return [a, b];
}

/** @param {string} text @param {number} a @param {number} b @returns {[number, number][]} */
function split(text, a, b) {
  if (b - a <= MAX_BLOCK) return [[a, b]];
  const mid = a + Math.floor((b - a) / 2);
  const ends = [...text.slice(a, b).matchAll(/[.!?]["”’)]?\s+/g)].map((m) => a + m.index + m[0].length);
  let cut = ends.length ? ends.reduce((best, e) => (Math.abs(e - mid) < Math.abs(best - mid) ? e : best)) : -1;
  if (cut <= a + MIN_BLOCK || cut >= b - MIN_BLOCK) {
    const space = text.lastIndexOf(' ', mid);
    cut = space > a + MIN_BLOCK ? space + 1 : mid;
  }
  const left = trim(text, a, cut);
  const right = trim(text, cut, b);
  return [...split(text, ...left), ...split(text, ...right)];
}
