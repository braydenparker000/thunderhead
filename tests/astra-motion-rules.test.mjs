// FEEL.md rule 2: only `transform` and `opacity` move. Every stylesheet of Astra's (the app's, the
// player's and the lab's) is read; a `transition` or a `@keyframes` that moves a layout property
// (width, height, top, left, margin, padding and their kin) fails, unless it is on the short list
// below, each entry with the area that is to fix it. The list only shrinks: an entry that no longer
// matches anything fails too, so a fixed one is taken off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASTRA = fileURLToPath(new URL('../frontend/astra/', import.meta.url));
const LAYOUT = /^(all|width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|inset(-.*)?|margin(-.*)?|padding(-.*)?|gap|row-gap|column-gap|flex(-basis|-grow|-shrink)?|grid-template-(rows|columns)|font-size|line-height|border(-(top|right|bottom|left))?-width)$/;

// [file, selector, property, note]: offenders that were here before rule 2, to be fixed by their area.
const ALLOWED = [
  ['src/player/player.css', '.ap-track', 'height', 'to be fixed by the player: the seek bar thickens by a transform'],
  ['src/player/player.css', '.ap-skip', 'bottom', 'to be fixed by the player: the button moves by a transform'],
  ['src/player/player.css', '.ap-next', 'bottom', 'to be fixed by the player: the button moves by a transform'],
];

/** The CSS files under frontend/astra (vendored libraries aside). */
function sheets() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(join(dir, e.name)); } else if (e.name.endsWith('.css')) out.push(join(dir, e.name));
    }
  };
  walk(ASTRA);
  return out;
}

/** Top-level comma split (commas inside parentheses stay). */
function splitTop(value) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
  }
  return [...parts, cur].map((s) => s.trim()).filter(Boolean);
}

/** Properties a `transition` (or `transition-property`) value moves. */
export function transitioned(prop, value) {
  if (/^\s*none\s*$/.test(value)) return [];
  return splitTop(value).map((part) => {
    if (prop === 'transition-property') return part;
    const first = part.split(/\s+/)[0];
    return /^[\d.]+m?s$/.test(first) || /^(var|cubic-bezier|linear|steps)\(/.test(first) || /^(ease|ease-in|ease-out|ease-in-out|linear)$/.test(first) ? 'all' : first;
  });
}

/** Every [selector, property] that moves a layout property in one stylesheet. */
export function offenders(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { stack.push(text.slice(start, i).trim().split(/[;}]/).pop().trim()); start = i + 1; }
    else if (text[i] === '}') {
      const prelude = stack.pop(), body = text.slice(start, i);
      start = i + 1;
      const frames = stack.find((p) => p.startsWith('@keyframes'));
      for (const decl of body.split(';')) {
        const m = decl.match(/^\s*([a-z-]+)\s*:\s*([\s\S]+)$/);
        if (!m) continue;
        const [, prop, value] = m;
        if (frames && LAYOUT.test(prop)) found.push([frames, prop]);
        else if (!frames && (prop === 'transition' || prop === 'transition-property'))
          for (const p of transitioned(prop, value)) if (LAYOUT.test(p)) found.push([prelude, p]);
      }
    }
  }
  return found;
}

test('the parser finds layout in a transition and in a keyframe, and nothing in transform or opacity', () => {
  assert.deepEqual(offenders('.a { transition: transform 1s, width 2s var(--e); } .b { transition: opacity 1s; }'), [['.a', 'width']]);
  assert.deepEqual(offenders('@keyframes k { from { top: 0; opacity: 0 } to { top: 4px } }'), [['@keyframes k', 'top'], ['@keyframes k', 'top']]);
  assert.deepEqual(offenders('@media (x) { .c { transition: 200ms; } }'), [['.c', 'all']]);
  assert.deepEqual(offenders('.d { transition: none; transition-property: opacity, transform; }'), []);
});

test("no stylesheet of Astra's moves a layout property (FEEL.md rule 2), but for the listed ones", () => {
  const seen = new Set();
  const bad = [];
  for (const file of sheets()) {
    const rel = relative(ASTRA, file);
    for (const [selector, prop] of offenders(readFileSync(file, 'utf8'))) {
      const allowed = ALLOWED.find(([f, s, p]) => f === rel && s === selector && p === prop);
      if (allowed) seen.add(allowed);
      else bad.push(`${rel} › ${selector} › ${prop}`);
    }
  }
  assert.deepEqual(bad, [], 'only transform and opacity move: use a transform, or fade');
  assert.deepEqual(ALLOWED.filter((a) => !seen.has(a)).map((a) => a.slice(0, 3).join(' › ')), [], 'fixed: take it off the list');
});
