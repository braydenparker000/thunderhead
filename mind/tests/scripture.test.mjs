// The mind's side of the scripture parser (STUDY.md §3.3 step 8, §7.5; SETUP.md O2): a page's refs
// and their weights, found in book context with the invented table of tests/study/table.json; and
// the import script, which refuses the owner's files when they sit inside the repository.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeIndex} from '../../frontend/apps/study/scripture/parse.js';
import {blocksOf} from '../jobs/study-blocks.mjs';
import {pageIn} from '../jobs/study-ingest.mjs';
import {refsOf} from '../jobs/study-refs.mjs';
import {outside, parseArgs} from '../jobs/scripture-import.mjs';
import {parseArgs as pagesArgs} from '../jobs/study-pages.mjs';

const TABLE = fileURLToPath(new URL('../../tests/study/table.json', import.meta.url));
const ix = makeIndex(JSON.parse(readFileSync(TABLE, 'utf8')));
const pick = (refs) => refs.map((r) => [r.block, `${r.book_code} ${r.chapter}:${r.v_start ?? ''}-${r.v_end ?? ''}`, r.weight, r.in_heading]);

test('weights: 3 in a heading or the first sentence, 2 the only verse a block names, 1 one of several', () => {
  const text = [
    'On Book A 3:12\nThe heading names the verse; the paragraph under it goes on at some length about it.',
    'A long first sentence that names nothing at all, and keeps going for a while longer than most. Then 2 Bet. 4:7 comes up, and again 2 Bet. 4:7 later on.',
    'A paragraph about several things that runs on for long enough to be a block of its own. It lists Book A 3:10–14; 4:2 and Epsilon 2:3 together.',
    'The first sentence cites S&N 4:2 and goes on. More words follow it here, enough to make this a block of its own.',
  ].join('\n\n');
  const blocks = blocksOf(text);
  assert.equal(blocks.length, 4);
  assert.deepEqual(pick(refsOf(text, blocks, ix)), [
    [1, 'a 3:12-12', 3, true],
    [2, '2-beta 4:7-7', 2, false],
    [3, 'a 3:10-14', 1, false],
    [3, 'a 4:2-2', 1, false],
    [3, 'epsilon 2:3-3', 1, false],
    [4, 'sn 4:2-2', 3, false],
  ]);
});

test('book context: a common-word book’s whole chapter only in parentheses, after "see", or in a list', () => {
  const at = (t) => pick(refsOf(t, blocksOf(t), ix)).map((r) => r[1]);
  assert.deepEqual(at('Gamma 10 people came to the long meeting in the hall that evening, and stayed late.'), []);
  assert.deepEqual(at('Gamma 10 tells of the long meeting in the hall that evening, and they stayed late.'), []);
  assert.deepEqual(at('The long meeting in the hall that evening is told at length (Gamma 10) by the writer.'), ['gamma 10:-']);
  assert.deepEqual(at('The long meeting in the hall that evening is told at length, see Gamma 10 for the rest.'), ['gamma 10:-']);
  assert.deepEqual(at('Nothing here names a verse: 3:16 alone, or a link https://example.test/Book-A-3:12 or `Gamma 10`.'), []);
});

test('pageIn: no table, no refs; with it, each block’s refs', () => {
  const line = {pdf_page: 2, page_label: '2', text: 'Book A 3:12 is the heart of the matter, said at the start of a block.'};
  assert.deepEqual(pageIn(line).refs, []);
  assert.deepEqual(pageIn(line, ix).refs, [{block: 1, book_code: 'a', chapter: 3, v_start: 12, v_end: 12, weight: 3, in_heading: false}]);
});

test('the import refuses files inside the repository, and needs a table', () => {
  assert.throws(() => outside(TABLE), /outside the repository/);
  assert.throws(() => outside(fileURLToPath(new URL('../../', import.meta.url))), /outside the repository/);
  const dir = mkdtempSync(join(tmpdir(), 'scripture-'));
  try {
    writeFileSync(join(dir, 't.json'), '{}');
    assert.equal(outside(join(dir, 't.json')).endsWith('t.json'), true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
  assert.throws(() => parseArgs([]), /--table/);
  assert.throws(() => parseArgs(['--bogus']), /unknown/);
  assert.deepEqual(parseArgs(['--table', 'a', '--text', 'b']), {table: 'a', text: 'b'});
  assert.throws(() => pagesArgs(['--book', 'not-an-id', '--out', 'x']), /required/);
  assert.equal(pagesArgs(['--book', '0190c8a2-7d1e-7abc-8def-0123456789ab', '--out', 'x']).out, 'x');
});
