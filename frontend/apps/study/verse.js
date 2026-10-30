// @ts-check
// A verse (STUDY.md §7.6), at `/study/?verse=<code>/<ch>[/<v>[-<v>]]`: the reference as the owner's
// table names it, the verse text from the owner's own copy, Open in the scripture app (from the
// private link template; a new tab, no opener, no referrer), "Cited in your books" (10 at most,
// then Show all N) and the owner's highlights and notes on it. The table and the text are private:
// they come after sign-in and the table stays on this phone for offline use. Ask about this verse
// comes with step 6.
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el } from '/th/ui.js';
import * as data from './data.js';
import { back as goBack, go } from './nav.js';
import { display, findRefs, linkFor, makeIndex, splitRef, validRef } from './scripture/parse.js';
import { pageName } from './words.js';

/** @typedef {import('./scripture/parse.js').Index} Index */
/** @typedef {import('../../../shared/contract/library.ts').Book} Book */
/** @typedef {import('../../../shared/contract/library.ts').CitedBlock} CitedBlock */
/** @typedef {import('../../../shared/contract/library.ts').Highlight} Highlight */

/** @type {{ table: object, index: Index } | null} */
let held = null;

/** The owner's table ready for the parser, or null before the mind has stored one. @returns {Promise<Index | null>} */
export async function scriptureIndex() {
  const table = await data.scripture();
  if (!table) return (held = null);
  if (held?.table !== table) held = { table, index: makeIndex(table) };
  return held.index;
}

/** The verse page's address for a ref. @param {string} ref */
export const verseQuery = (ref) => `?verse=${ref.slice('verse:'.length)}`;

/** Verse cards for the refs a search names (STUDY.md §6): first, the text search still runs.
 * @param {string} q @param {Index | null} ix @returns {HTMLElement[]} */
export function verseCards(q, ix) {
  if (!ix) return [];
  const seen = new Set();
  return findRefs(q, ix)
    .filter((f) => !seen.has(f.ref) && seen.add(f.ref))
    .slice(0, 3)
    .map((f) => {
      const card = el('button', { type: 'button', class: 'vcard' }, [
        el('small', { text: 'Verse' }),
        el('b', { text: display(f.ref, ix) }),
      ]);
      card.addEventListener('click', () => go(verseQuery(f.ref)));
      return card;
    });
}

/** @param {HTMLElement} main @param {string} place `<code>/<ch>[/<v>[-<v>]]` */
export async function verseScreen(main, place) {
  const back = el('button', { type: 'button', class: 'back', text: '‹ Back' });
  const body = el('div', { class: 'verse' });
  main.replaceChildren(el('div', { class: 'lib' }, [back, body]));
  back.addEventListener('click', goBack);
  const ix = await scriptureIndex();
  const ref = `verse:${place}`;
  if (!ix) return body.replaceChildren(el('p', { class: 'note', text: 'Verses open here once your scripture books are set up.' }));
  if (!validRef(ref, ix)) return body.replaceChildren(el('p', { class: 'note', text: "That verse isn't in your scripture books." }));
  const p = /** @type {NonNullable<ReturnType<typeof splitRef>>} */ (splitRef(ref));
  const text = el('div', { class: 'vtext' });
  const cited = el('div');
  const marks = el('div');
  const link = linkFor(ref, ix);
  body.replaceChildren(
    el('h1', { text: display(ref, ix) }),
    text,
    ...(link ? [el('a', { class: 'link out', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Open in the scripture app' })] : []),
    cited,
    marks,
  );
  /** @type {Book[]} */
  const known = (await data.local.get('books')) ?? [];
  const titles = new Map(known.map((b) => [b.id, b.title]));
  showText(text, p, await data.verseText(p.code, p.chapter));
  try {
    const r = await data.verse(p.code, p.chapter, p.v_start, p.v_end, false);
    showCited(cited, r.cited, r.total, async () => (await data.verse(p.code, p.chapter, p.v_start, p.v_end, true)).cited);
    showMarks(marks, r.highlights, titles);
  } catch (e) {
    cited.replaceChildren(el('p', { class: 'note', text: lineFor(failure(e)) }));
  }
}

/** The verses asked for (the whole chapter for a chapter), numbered, from the owner's copy.
 * @param {HTMLElement} box @param {{ v_start: number | null, v_end: number | null }} p @param {Record<string, string> | null} verses */
function showText(box, p, verses) {
  const nums = Object.keys(verses ?? {})
    .map(Number)
    .filter((v) => p.v_start === null || (v >= p.v_start && v <= /** @type {number} */ (p.v_end)))
    .sort((a, b) => a - b);
  if (!verses || !nums.length)
    return box.replaceChildren(el('p', { class: 'note', text: "Your copy of this verse isn't stored yet." }));
  box.replaceChildren(
    ...nums.map((v) => el('p', {}, [...(nums.length > 1 || p.v_start === null ? [el('sup', { text: String(v) })] : []), verses[String(v)]])),
  );
}

/** @param {HTMLElement} box @param {CitedBlock[]} first @param {number} total @param {() => Promise<CitedBlock[]>} more */
function showCited(box, first, total, more) {
  const list = el('div', { class: 'cited' });
  const draw = (/** @type {CitedBlock[]} */ rows) =>
    list.replaceChildren(
      ...rows.map((c) => {
        const row = el('button', { type: 'button', class: 'hit' }, [
          el('b', { text: `${c.title} · ${pageName(c.pdf_page, c.page_label)}` }),
          el('p', { text: c.line }),
        ]);
        row.addEventListener('click', () => go(`?book=${c.book_id}&p=${c.pdf_page}&b=${c.block}`));
        return row;
      }),
    );
  draw(first);
  /** @type {HTMLElement[]} */
  const kids = [el('h2', { class: 'sec', text: `Cited in your books (${total})` })];
  if (!total) kids.push(el('p', { class: 'note', text: 'None of your books cite this verse yet.' }));
  else kids.push(list);
  if (total > first.length) {
    const all = el('button', { type: 'button', class: 'link', text: `Show all ${total}` });
    all.addEventListener('click', async () => {
      all.setAttribute('disabled', '');
      try {
        draw(await more());
        all.remove();
      } catch (e) {
        all.removeAttribute('disabled');
        all.textContent = lineFor(failure(e));
      }
    });
    kids.push(all);
  }
  box.replaceChildren(...kids);
}

/** @param {HTMLElement} box @param {Highlight[]} marks @param {Map<string, string>} titles */
function showMarks(box, marks, titles) {
  if (!marks.length) return box.replaceChildren();
  box.replaceChildren(
    el('h2', { class: 'sec', text: 'Your highlights and notes' }),
    el(
      'div',
      { class: 'cited' },
      marks.map((h) => {
        const row = el('button', { type: 'button', class: `hit mark ${h.color}` }, [
          el('p', { text: h.quote }),
          ...(h.note ? [el('p', { class: 'hnote', text: h.note })] : []),
          el('small', { text: `${titles.get(h.book_id) ?? 'A book'} · ${pageName(h.pdf_page, null)}` }),
        ]);
        row.addEventListener('click', () => go(`?book=${h.book_id}&p=${h.pdf_page}`));
        return row;
      }),
    ),
  );
}
