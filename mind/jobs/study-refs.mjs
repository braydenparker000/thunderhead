// A page's verse refs (STUDY.md §3.3 step 8, §7.5), found by the same parser the phone and the
// Worker use, in book context (a common-word book's whole-chapter form only in parentheses, after
// "see"/"cf." or in a list). Each ref is weighed for "Cited in your books": 3 in a heading or the
// block's first sentence, 2 when it is the only verse the block names, 1 when it is one of several.
// A heading is a block's short first line (at most 80 characters, no closing stop) with more after.
import {findRefs} from '../../frontend/apps/study/scripture/parse.js';

export const REFS_PER_PAGE = 400;
const HEADING = 80;

/** Where the block's first sentence ends; stops inside a ref ("2 Bet. 4:7") don't count. */
function firstSentenceEnd(block, found) {
  let s = block;
  for (const f of found) s = s.slice(0, f.start) + 'x'.repeat(f.end - f.start) + s.slice(f.end);
  const m = /[.!?]["”’)]?(?:\s|$)/.exec(s);
  return m ? m.index + 1 : block.length;
}

/**
 * @param {string} text the page's text
 * @param {[number, number][]} blocks
 * @param {import('../../frontend/apps/study/scripture/parse.js').Index | null} ix null before the table is stored
 */
export function refsOf(text, blocks, ix) {
  if (!ix) return [];
  const out = [];
  blocks.forEach(([a, z], i) => {
    const block = text.slice(a, z);
    const found = findRefs(block, ix, 'book');
    if (!found.length) return;
    const nl = block.indexOf('\n');
    const head = nl > 0 && nl <= HEADING && !/[.!?:;,]\s*$/.test(block.slice(0, nl)) ? nl : 0;
    const first = head || firstSentenceEnd(block, found);
    const only = new Set(found.map((f) => f.ref)).size === 1;
    const seen = new Set();
    for (const f of found) {
      if (seen.has(f.ref)) continue;
      seen.add(f.ref);
      out.push({
        block: i + 1,
        book_code: f.code,
        chapter: f.chapter,
        v_start: f.v_start,
        v_end: f.v_end,
        weight: f.start < first ? 3 : only ? 2 : 1,
        in_heading: f.start < head,
      });
    }
  });
  return out.slice(0, REFS_PER_PAGE);
}
