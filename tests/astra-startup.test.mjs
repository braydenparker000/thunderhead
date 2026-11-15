// Astra's page preloads exactly the modules its start-up imports (frontend/astra/index.html): one too
// few costs a request hop on a cold start, one too many downloads the player before it is wanted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASTRA = fileURLToPath(new URL('../frontend/astra/', import.meta.url));

/** Every module reached from `entry` by static imports of relative paths (a dynamic import() loads later, by design). */
function startup(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(join(ASTRA, file), 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      const to = m[1] || m[2];
      if (to.startsWith('.')) walk(normalize(join(dirname(file), to)));
    }
  };
  walk(entry);
  seen.delete(entry);
  return [...seen].map((f) => relative('.', f)).sort();
}

test('index.html preloads exactly the modules the app needs to start', () => {
  const html = readFileSync(join(ASTRA, 'index.html'), 'utf8');
  const preloaded = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(preloaded, startup('src/main.js'));
});

test('the player, the engine and the vendored libraries are not part of start-up', () => {
  const heavy = startup('src/main.js').filter((f) => /^src\/(engine\/(?!languages\.js)|enhance\/|subtitles\/(?!charset\.js))|^vendor\//.test(f) || /^src\/player\/(?!prefs\.js|external\.js)/.test(f));
  assert.deepEqual(heavy, []);
});
