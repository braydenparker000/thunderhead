// Static checks that run without a browser: links resolve, only allowed outside hosts, nothing secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(REPO, 'frontend');
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.deploy', 'test-results'].includes(e.name)) continue;
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await files(p) : [p]));
  }
  return out;
}

test('every local file the pages load exists', async () => {
  for (const page of ['index.html', '404.html']) {
    const html = await readFile(join(SITE, page), 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
      if (/^(https?:)?\/\//.test(ref) || ref === '/') continue;
      assert.ok(existsSync(join(SITE, ref)), `${page} loads missing ${ref}`);
    }
  }
});

test('pages only reach allowed outside hosts', async () => {
  for (const f of (await files(SITE)).filter(f => /\.(html|css|js)$/.test(f))) {
    const text = await readFile(f, 'utf8');
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'()<>]+/g)) {
      if (url.startsWith('http://www.w3.org/')) continue;
      assert.ok(ALLOWED_HOSTS.has(new URL(url).hostname), `${relative(REPO, f)} reaches ${url}`);
    }
  }
});

test('no credentials in the repository', async () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{20,}\b/, /\bxox[abp]-[A-Za-z0-9-]{10,}\b/, /AccountKey=[A-Za-z0-9+/=]{20,}/, /\bsig=[A-Za-z0-9%]{20,}/];
  for (const f of await files(REPO)) {
    if (f.endsWith('package-lock.json') || /\.(png|ico|woff2?)$/.test(f)) continue;
    const text = await readFile(f, 'utf8');
    for (const p of patterns) assert.ok(!p.test(text), `${relative(REPO, f)} matches ${p}`);
  }
});

test('home page has the basics', async () => {
  const html = await readFile(join(SITE, 'index.html'), 'utf8');
  assert.match(html, /<title>Thunderhead<\/title>/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
});
