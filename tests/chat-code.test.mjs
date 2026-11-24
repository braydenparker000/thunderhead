// A reply's code blocks as parsed (frontend/th/chat/rich.js): the language from the fence, the text
// kept exactly, a block still arriving (streamed) marked open, and the fence edge cases. Invented text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parse } = await import('../frontend/th/chat/rich.js');

test('a fenced block keeps its language and its text exactly', () => {
  assert.deepEqual(parse('```js title="a.js"\nconst a = 1;\n```'), [{ t: 'pre', text: 'const a = 1;', lang: 'js' }]);
  assert.deepEqual(parse('```\n\t<b>x</b> **not bold** `nor this`\n```'), [{ t: 'pre', text: '\t<b>x</b> **not bold** `nor this`' }]);
  // Blank lines inside, also the first, stay; Windows line ends read as plain ones.
  assert.deepEqual(parse('```\r\n\r\na\r\n\r\nb\r\n```'), [{ t: 'pre', text: '\na\n\nb' }]);
  // The fence's first word is the language when it looks like one; anything else gives none.
  assert.deepEqual(parse('```this is not a language!\nx\n```'), [{ t: 'pre', text: 'x', lang: 'this' }]);
  assert.deepEqual(parse('```!!\nx\n```'), [{ t: 'pre', text: 'x' }]);
});

test('a block still arriving is open, without the first backticks of its closing fence', () => {
  const out = parse('Here:\n\n```py\nfor x in y:\n    print(x)');
  assert.deepEqual(out.map((b) => b.t), ['p', 'pre']);
  assert.deepEqual(out[1], { t: 'pre', text: 'for x in y:\n    print(x)', lang: 'py', open: true });
  assert.deepEqual(parse('```\na\n``'), [{ t: 'pre', text: 'a', open: true }]);
  assert.deepEqual(parse('```\necho `date`'), [{ t: 'pre', text: 'echo `date`', open: true }]);
  assert.deepEqual(parse('```'), [{ t: 'pre', text: '', open: true }]);
});

test('fence edge cases: one line, words after the close, a longer fence, an indented fence', () => {
  assert.deepEqual(parse('```npm test```\nThen go.'), [{ t: 'pre', text: 'npm test' }, { t: 'p', lines: [[{ text: 'Then go.' }]] }]);
  assert.deepEqual(parse('```\nx\n``` and then this.'), [{ t: 'pre', text: 'x' }, { t: 'p', lines: [[{ text: 'and then this.' }]] }]);
  // A fence with a language inside a block is code, not its end; a longer fence holds a shorter one.
  assert.deepEqual(parse('```\n```js\n```'), [{ t: 'pre', text: '```js' }]);
  assert.deepEqual(parse('````md\n```js\ncode\n```\n````\nAfter.').map((b) => (b.t === 'pre' ? [b.text, b.lang] : b.t)), [['```js\ncode\n```', 'md'], 'p']);
  // An indented fence (as in a list) takes its indent off each line.
  assert.deepEqual(parse('  ```\n  if (a) {\n    b();\n  }\n  ```'), [{ t: 'pre', text: 'if (a) {\n  b();\n}' }]);
  // Markdown after a block reads as Markdown again.
  assert.deepEqual(parse('```\nx\n```\n- one\n- two').map((b) => b.t), ['pre', 'ul']);
});
