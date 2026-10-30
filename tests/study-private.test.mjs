// Study's books stay out of GitHub Actions (STUDY.md §2.1, §3.3): Actions logs are public and its
// token has no access to the private bucket, so no workflow names the library's routes, the books'
// keys or the bucket. The mind reads books in its own session only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

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
