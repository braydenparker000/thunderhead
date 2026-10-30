// The scripture-reference parser (STUDY.md §7) on the invented table: every case of
// tests/study/refs.txt (at least 300, positives and negatives), with no false positive and at least
// 98% of the positives found; the table's own checks; refs validated, shown and linked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTable, display, findRefs, hint, linkFor, makeIndex, onlyRefs, splitRef, validRef } from '../frontend/apps/study/scripture/parse.js';

const table = JSON.parse(readFileSync(new URL('./study/table.json', import.meta.url), 'utf8'));
const ix = makeIndex(table);
const cases = readFileSync(new URL('./study/refs.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [input, want] = l.split(' => ');
    const book = input.startsWith('[book] ');
    return { text: book ? input.slice(7) : input, context: book ? 'book' : 'ask', want: want === '-' ? [] : want.split(' ') };
  });

test('the fixture: 300+ invented cases; no false positive; 98%+ of the positives found exactly', () => {
  assert.ok(cases.length >= 300, `${cases.length} cases`);
  const wrong = [];
  let positives = 0;
  let found = 0;
  for (const c of cases) {
    const got = findRefs(c.text, ix, /** @type {any} */ (c.context)).map((f) => f.ref);
    if (!c.want.length) {
      if (got.length) wrong.push(`false positive: ${c.text} → ${got.join(' ')}`);
      continue;
    }
    positives++;
    if (JSON.stringify(got) === JSON.stringify(c.want)) found++;
    else wrong.push(`${c.text} → ${got.join(' ') || '-'} (want ${c.want.join(' ')})`);
  }
  const falsePositives = wrong.filter((w) => w.startsWith('false positive'));
  assert.deepEqual(falsePositives, []);
  assert.ok(found / positives >= 0.98, `${found} of ${positives}:\n${wrong.join('\n')}`);
});

test('the table checks itself: counts per chapter, no name twice, the published totals', () => {
  assert.deepEqual(checkTable(table), []);
  const bad = structuredClone(table);
  bad.books[0].verses.pop();
  bad.books[1].aliases = ['Book A'];
  bad.totals.alpha += 1;
  const problems = checkTable(bad);
  assert.ok(problems.some((p) => /one verse count per chapter/.test(p)));
  assert.ok(problems.some((p) => /"book a" names a and 1-beta/.test(p)));
  assert.ok(problems.some((p) => /alpha: .* published total/.test(p)));
});

test('refs: validated against the table, shown as the owner writes them, linked from the template', () => {
  assert.ok(validRef('verse:a/3/12', ix));
  assert.ok(validRef('verse:a/3/12-24', ix));
  assert.ok(validRef('verse:gamma/10', ix));
  for (const r of ['verse:a/0/1', 'verse:a/3/25', 'verse:a/3/14-12', 'verse:a/6', 'verse:zeta/1/1', 'book:x#p0', 'verse:a/3/0'])
    assert.equal(validRef(r, ix), false, r);
  assert.deepEqual(splitRef('verse:2-beta/4/7'), { code: '2-beta', chapter: 4, v_start: 7, v_end: 7 });
  assert.equal(display('verse:a/3/12-14', ix), 'Book A 3:12–14');
  assert.equal(display('verse:delta/1/3', ix), 'Delta 3');
  assert.equal(display('verse:gamma/10', ix), 'Gamma 10');
  assert.equal(linkFor('verse:a/3/12', ix), 'https://scripture.example/alpha/book-a/3?id=p12#p12');
  assert.equal(linkFor('verse:a/3/12-14', ix), 'https://scripture.example/alpha/book-a/3?id=p12-p14#p12');
  assert.equal(linkFor('verse:gamma/10', ix), 'https://scripture.example/alpha/gamma/10');
});

test('the ask bar: text that is only a reference opens the verse page; a verse that isn’t there gets a hint', () => {
  assert.deepEqual(onlyRefs('2 Bet 4:7', ix)?.map((f) => f.ref), ['verse:2-beta/4/7']);
  assert.deepEqual(onlyRefs(' Book A 3:12, 17–19. ', ix)?.map((f) => f.ref), ['verse:a/3/12', 'verse:a/3/17-19']);
  assert.equal(onlyRefs('what does Book A 3:12 mean', ix), null);
  assert.equal(hint('Book A 3:30', ix), 'Book A 3 has 24 verses.');
  assert.equal(hint('Epsilon 9:1', ix), 'Epsilon has 3 chapters.');
  assert.equal(hint('Book A 3:12', ix), null);
});
