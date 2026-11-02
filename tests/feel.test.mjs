// The shell uses motion and type tokens. This checks the CSS shape, never the values of tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FILES = [
  'ui/tokens.css', 'ui/shell.css', 'ui/forms.css', 'ui/auth.css', 'ui/plain.css', 'ui/fonts.css',
  'apps/home/home.css', 'apps/home/chat.css', 'apps/home/menu.css', 'apps/home/blocks.css',
  'apps/settings/settings.css', 'apps/study/study.css',
  'th/island/island.css', 'th/attach/attach.css', 'th/reply/tools.css',
];

function inspect(css, tokens = false) {
  const lines = css.split('\n');
  const lineAt = offset => css.slice(0, offset).split('\n').length;
  const exemptions = new Set();
  // Keep offsets and newlines intact. Strings (including URLs) and comments are not CSS values.
  const source = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, (text, offset) => {
    if (/^\/\*\s*T1:/.test(text)) {
      for (let line = lineAt(offset); line <= lineAt(offset + text.length - 1); line++) exemptions.add(line);
    }
    return text.replace(/[^\n]/g, ' ');
  });
  const found = new Map();
  function flag(offset, rule) {
    const line = lineAt(offset);
    if (!exemptions.has(line)) found.set(`${line}:${rule}`, { line, rule, text: lines[line - 1].trim() });
  }
  if (!tokens) {
    for (const m of source.matchAll(/(?<![\w-])(?:cubic-bezier|linear)\s*\(/gi)) flag(m.index, 'curve');
  }
  // A declaration starts after a brace or semicolon. Masked strings cannot supply delimiters.
  for (const m of source.matchAll(/(?:^|(?<=[;{}]))\s*([\w-]+)\s*:([^;{}]*)/g)) {
    const property = m[1].toLowerCase(), value = m[2];
    const valueAt = m.index + m[0].indexOf(':') + 1;
    const propertyAt = m.index + m[0].indexOf(m[1]);
    if (/^(?:transition|animation)(?:-|$)/.test(property)) {
      for (const time of value.matchAll(/(?<![\w.-])[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?(ms|s)(?![\w-])/gi)) {
        const ms = Math.abs(parseFloat(time[0])) * (time[1].toLowerCase() === 's' ? 1000 : 1);
        if (ms > 0 && ms < 2000) flag(valueAt + time.index, 'duration');
      }
      if (!tokens && /^(?:transition|animation)(?:-timing-function)?$/.test(property)) {
        for (const easing of value.matchAll(/(?<![\w-])(?:ease-in-out|ease-in|ease-out|ease|linear)(?![\w-]|\s*\()/gi)) {
          flag(valueAt + easing.index, 'easing keyword');
        }
      }
    }
    if (!tokens && (property === 'font-size' || (property === 'font' && !/^var\(\s*--t-[\w-]+\s*[,)]/.test(value.trim())))) {
      flag(propertyAt, 'type');
    }
  }
  return { violations: [...found.values()].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule)), exemptions: exemptions.size };
}

test('shell motion and type use tokens; exceptions stay visible', async t => {
  const violations = [];
  let exemptions = 0;
  for (const file of FILES) {
    const css = await readFile(new URL(`../frontend/${file}`, import.meta.url), 'utf8');
    const result = inspect(css, file === 'ui/tokens.css');
    exemptions += result.exemptions;
    violations.push(...result.violations.map(v => `frontend/${file}:${v.line}: ${v.text} (${v.rule})`));
  }
  t.diagnostic(`T1 exempt lines: ${exemptions}`);
  assert.equal(violations.length, 0, violations.join('\n'));
});

test('feel scanner accepts token references, ambient times, gradients and quoted text', () => {
  assert.deepEqual(inspect(`
    .example{font:var(--t-body);font-weight:600;transition:opacity var(--d-fast) var(--ease-out) 0ms;
      animation:drift 2s var(--ease-ambient) infinite;animation-delay:-2s;
      background:linear-gradient(red,blue);content:"font-size:12px; animation:.3s ease"}
    .other{transition-delay:calc(var(--d-rise) * -.2);animation-timing-function:var(--ease-linear);
      animation-name:ease;--example-url:url("linear(0, 1).svg")}
    /* .ignored{font:12px sans-serif;transition:1ms linear} */
  `).violations, []);
});

test('feel scanner catches durations, delays and calc fallbacks without matching token names', () => {
  const result = inspect(`.example{
    transition:opacity .15s var(--ease-out);
    transition-duration:160ms;
    animation:turn var(--d-page) var(--settle);
    animation-delay:calc(var(--i) * -30ms);
    transition-delay:var(--delay, 1e-2s);
    transition-duration:var(--d-150ms);
    animation-duration:2s;
    transition-delay:-0ms;
  }`);
  assert.deepEqual(result.violations.map(v => [v.line, v.rule]), [
    [2, 'duration'], [3, 'duration'], [5, 'duration'], [6, 'duration'],
  ]);
});

test('feel scanner catches curves, easing keywords and non-token type shorthands', () => {
  const result = inspect(`.example{
    transition:opacity var(--d-fast) ease-in-out;
    animation-timing-function:linear;
    transition:transform var(--d-fast) cubic-bezier(.2,.8,.2,1);
    --local-curve:linear(0,1);
    font:500 13px/1.4 var(--ui);
    font-size:var(--size);
    font:inherit;
  }`);
  assert.deepEqual(result.violations.map(v => [v.line, v.rule]), [
    [2, 'easing keyword'], [3, 'easing keyword'], [4, 'curve'], [5, 'curve'],
    [6, 'type'], [7, 'type'], [8, 'type'],
  ]);
});

test('feel exemptions apply to their own lines, including multiline declarations', () => {
  const result = inspect(`.example{transition:
    opacity .1s ease, /* T1: no token within 15% */
    transform .2s linear;
    font-size:14px; /* T1: line-height off-ramp */
    font:500 13px var(--ui);
  }`);
  assert.equal(result.exemptions, 2);
  assert.deepEqual(result.violations.map(v => [v.line, v.rule]), [
    [3, 'duration'], [3, 'easing keyword'], [5, 'type'],
  ]);
  assert.equal(result.violations[0].text, 'transform .2s linear;');
});

test('the token file is free to define type and curves, without fixed-value assertions', () => {
  assert.deepEqual(inspect(`:root{
    --d-example:127ms;--ease-example:ease;--curve-example:linear(0,1);
    --t-example:400 17px/1.5 sans-serif;
  }`, true).violations, []);
});
