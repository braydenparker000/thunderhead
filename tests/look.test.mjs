// Ink and Lamp's folder, without a browser (frontend/look/, scripts/look-config.mjs): the setting and
// its default, every file the look's sheets name, a licence beside every typeface, every emblem, no
// outside host, every selector scoped to the look, and the folder published under its own hash and
// kept out of the release's precache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS } from '../shared/contract/settings.ts';
import { lookTag, precached, themeJs } from '../scripts/site-config.mjs';

const LOOK = fileURLToPath(new URL('../frontend/look/', import.meta.url));
const all = readdirSync(LOOK, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
  .map((e) => relative(LOOK, join(e.parentPath, e.name)).replaceAll('\\', '/')).sort();
const text = (p) => readFileSync(join(LOOK, p), 'utf8');
const sheets = all.filter((p) => p.endsWith('.css'));
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** A selector list's selectors: its commas outside brackets. */
const selectors = (list) => {
  const out = [''];
  let depth = 0;
  for (const c of list) {
    depth += '([' .includes(c) ? 1 : ')]'.includes(c) ? -1 : 0;
    if (c === ',' && !depth) out.push(''); else out[out.length - 1] += c;
  }
  return out.map((s) => s.trim());
};

test('the setting: Look, Classic by default, Ink and Lamp on <html data-look>, kept on the phone', () => {
  const s = SETTINGS.find((x) => x.key === 'appearance.look');
  assert.ok(s, 'appearance.look is in the catalogue');
  assert.deepEqual([s.group, s.scope, s.kind, s.default, s.attr, s.label], ['appearance', 'phone', 'choice', 'classic', 'data-look', 'Look']);
  assert.deepEqual(s.options.map((o) => [o.value, o.label]), [['classic', 'Classic'], ['ink-lamp', 'Ink and Lamp']]);
});

test('every file the look names exists, and every picture of the kit is named', () => {
  const named = new Set();
  for (const p of sheets)
    for (const [, ref] of bare(text(p)).matchAll(/url\(\s*"?([^")]+)"?\s*\)/g)) {
      const to = join(dirname(join(LOOK, p)), ref);
      assert.ok(!/^([a-z]+:|\/)/.test(ref), `${p}: "${ref}" is relative to its sheet`);
      assert.ok(existsSync(to), `${p} names missing ${ref}`);
      named.add(relative(LOOK, to).replaceAll('\\', '/'));
    }
  for (const p of all.filter((f) => f.startsWith('kit/') || f.endsWith('.woff2') || (f.endsWith('.css') && f !== 'look.css')))
    assert.ok(named.has(p), `${p} is named by a sheet`);
  for (const p of all.filter((f) => f.endsWith('.js')))
    for (const [, ref] of text(p).matchAll(/from '(\.[^']+)'/g)) assert.ok(existsSync(join(dirname(join(LOOK, p)), ref)), `${p} imports missing ${ref}`);
});

test('every typeface has its licence beside it', () => {
  const faces = all.filter((p) => p.endsWith('.woff2'));
  assert.ok(faces.length >= 6);
  for (const f of faces) {
    // its own, or its family's (eb-garamond-italic.woff2 beside eb-garamond.OFL.txt)
    const licence = [f.replace(/\.woff2$/, '.OFL.txt'), f.replace(/-italic\.woff2$/, '.OFL.txt')].find((l) => all.includes(l));
    assert.ok(licence, `${f} has its licence beside it`);
    assert.match(text(licence), /SIL Open Font License, Version 1\.1/);
  }
});

test('the emblems: the seven of the ring and the Lamb, each a symbol in currentColor', () => {
  const svg = text('emblems.svg');
  for (const id of ['harp', 'trumpet', 'star', 'lute', 'book', 'picture', 'chest', 'lamb']) {
    const sym = new RegExp(`<symbol id="em-${id}" viewBox="[^"]+">([\\s\\S]*?)</symbol>`).exec(svg);
    assert.ok(sym, `em-${id}`);
    assert.match(sym[1], new RegExp(`<rect [^>]*fill="currentColor" mask="url\\(#em-${id}-cut\\)"/>`), `em-${id} takes currentColor`);
  }
});

test('nothing under look/ names an outside host', () => {
  for (const p of all.filter((f) => /\.(css|js|svg|json|html)$/.test(f)))
    for (const [url] of text(p).matchAll(/https?:\/\/[^\s"'()<>]+/g)) assert.equal(url, 'http://www.w3.org/2000/svg', `${p} reaches ${url}`);
});

test("every rule of the look's sheets is scoped to the look; each file stays under 300 lines", () => {
  for (const p of all.filter((f) => /\.(css|js)$/.test(f))) assert.ok(text(p).split('\n').length <= 300, `${p} is over 300 lines`);
  for (const p of sheets) {
    const css = bare(text(p)).replace(/@import [^;]+;/g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
    for (const [, prelude] of css.matchAll(/([^{};]*)\{/g)) {
      const head = prelude.trim();
      if (/^@(media|supports|container|layer)\b/.test(head)) continue;
      for (const sel of selectors(head)) assert.ok(sel.startsWith(':root[data-look="ink-lamp"]'), `${p}: "${sel}" is not scoped to the look`);
    }
  }
});

test('the look is published under the hash of its files, left out of the precache and named once in ui/theme.js', () => {
  const tag = lookTag(LOOK);
  assert.match(tag, /^[0-9a-f]{10}$/);
  assert.equal(lookTag(LOOK), tag, 'the same files, the same name');
  for (const p of ['look/look.css', `look/${tag}/look.css`, `look/${tag}/fonts/eb-garamond.woff2`]) assert.equal(precached(p), false, p);
  const theme = readFileSync(new URL('../frontend/ui/theme.js', import.meta.url), 'utf8');
  assert.match(themeJs(theme, tag), new RegExp(`const LOOK = '/look/${tag}/';`));
  assert.equal(theme.match(/'\/look\/'/g).length, 1, 'ui/theme.js names the folder in one place');
  const sw = readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /path\.startsWith\('\/look\/'\)\) \{ event\.respondWith\(vendor\(req\)\)/, 'the worker keeps look/ for good, as vendor/');
});
