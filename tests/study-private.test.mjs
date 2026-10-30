// Study's books stay out of GitHub Actions (STUDY.md §2.1, §3.3): Actions logs are public and its
// token has no access to the private bucket, so no workflow names the library's routes, the books'
// keys or the bucket. The mind reads books in its own session only. And the owner's scripture book
// table, its link template and verse text live only in the private bucket (STUDY.md §7.1, §7.6;
// owner rulings 2026-10-27 and 2026-10-28): the repository holds the invented test table alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = new URL('../.github/workflows/', import.meta.url);

test('no workflow touches the library, the books or the private bucket', () => {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 3, 'found the workflows');
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    for (const banned of ['/v1/library/', 'books/', 'thunderhead-private'])
      assert.ok(!text.includes(banned), `${f} mentions ${banned}`);
  }
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', '.wrangler', 'vendor', 'test-results']);
const BINARY = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.mp3', '.m4a', '.zip', '.gz', '.sqlite']);

/** Every file in the checkout a commit could carry (tracked or not), as [path, text]. */
function* files(dir = ROOT) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) yield* files(path);
    } else if (e.isFile() && !BINARY.has(extname(e.name).toLowerCase()) && statSync(path).size < 8 * 1024 * 1024)
      yield [relative(ROOT, path).split('\\').join('/'), readFileSync(path, 'utf8')];
  }
}

const tableLike = (v) => Array.isArray(v?.books) && v.books.some((b) => Array.isArray(b?.verses) && typeof b?.chapters === 'number');
const textLike = (v) =>
  v && typeof v === 'object' && v.chapters && typeof v.chapters === 'object' && !Array.isArray(v.chapters) &&
  Object.values(v.chapters).some((ch) => ch && typeof ch === 'object' && Object.values(ch).some((t) => typeof t === 'string'));

test('no real scripture table, link template or verse text is in the repository', () => {
  let seen = 0;
  for (const [path, text] of files()) {
    seen++;
    // A link template ({volume}/{book}/{chapter}) only on the invented host.
    for (const m of text.matchAll(/https?:\/\/([^/\s"'`]+)[^\s"'`]*(?<!\$)\{(?:volume|book)\}/g))
      assert.equal(m[1], 'scripture.example', `${path}: a link template on ${m[1]}`);
    if (extname(path) !== '.json') continue;
    let v;
    try {
      v = JSON.parse(text);
    } catch {
      continue;
    }
    assert.ok(!textLike(v), `${path}: verse text`);
    if (tableLike(v)) {
      assert.equal(path, 'tests/study/table.json', `${path}: a scripture table`);
      assert.match(v.source, /invented/);
    }
  }
  assert.ok(seen > 200, `walked ${seen} files`);
});
