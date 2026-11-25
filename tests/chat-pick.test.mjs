// A pick the mind offers in a reply, as parsed (frontend/th/chat/rich.js): the token
// `(pick:<MusicBrainz id>)` becomes a pick part (drawn as a Play button for its preview, th/chat/pick.js),
// and everything else is left as it was. Invented text and ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parse } = await import('../frontend/th/chat/rich.js');

const ID = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';

test('a pick token is a pick part, in place of the token', () => {
  assert.deepEqual(parse(`Harbour Lights (2006) by Invented Artist 0 (pick:${ID})`), [
    { t: 'p', lines: [[{ text: 'Harbour Lights (2006) by Invented Artist 0 ' }, { pick: ID }]] },
  ]);
  // In a list, beside other marks, and two in one reply.
  assert.deepEqual(parse(`- **Night Orchard** (pick:${ID})\n- Another one (pick:${ID.replace('0f', 'aa')})`), [
    { t: 'ul', start: 1, items: [[{ b: 'Night Orchard' }, { text: ' ' }, { pick: ID }], [{ text: 'Another one ' }, { pick: ID.replace('0f', 'aa') }]] },
  ]);
});

test('anything else stays as it was: not an id, upper case, in code, a plain bracket', () => {
  for (const text of ['Not a pick (pick:12345)', `Upper case (pick:${ID.toUpperCase()})`, `Missing its bracket pick:${ID}`, 'Just (brackets) here.']) {
    assert.deepEqual(parse(text), [{ t: 'p', lines: [[{ text }]] }], text);
  }
  assert.deepEqual(parse(`Write \`(pick:${ID})\` like this`), [{ t: 'p', lines: [[{ text: 'Write ' }, { code: `(pick:${ID})` }, { text: ' like this' }]] }]);
  assert.deepEqual(parse(`See https://example.com/a (pick:${ID})`), [
    { t: 'p', lines: [[{ text: 'See ' }, { href: 'https://example.com/a', label: 'example.com/a' }, { text: ' ' }, { pick: ID }]] },
  ]);
});
