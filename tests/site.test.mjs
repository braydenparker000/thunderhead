// Static checks that run without a browser: links resolve, no outside hosts, the page fits
// the strict Content-Security-Policy, and nothing secret is committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(REPO, 'frontend');
const PAGES = ['index.html', '404.html'];

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.deploy', 'test-results', '.wrangler', '.dev.vars'].includes(e.name)) continue;
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await files(p) : [p]));
  }
  return out;
}

test('every file the pages load exists, by a root-absolute path', async () => {
  for (const page of PAGES) {
    const html = await readFile(join(SITE, page), 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
      if (ref === '/' || ref.startsWith('http://www.w3.org/')) continue;
      assert.ok(ref.startsWith('/'), `${page}: "${ref}" must start with / so app routes like /music/ still find it`);
      assert.ok(existsSync(join(SITE, ref)), `${page} loads missing ${ref}`);
    }
  }
});

test('no outside hosts anywhere in the site', async () => {
  for (const f of (await files(SITE)).filter(f => /\.(html|css|js|json)$/.test(f))) {
    const text = await readFile(f, 'utf8');
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'()<>]+/g)) {
      if (url.startsWith('http://www.w3.org/')) continue;
      assert.fail(`${relative(REPO, f)} reaches ${url}`);
    }
  }
});

test('pages fit the CSP: no inline scripts, no <style> blocks, no inline event handlers', async () => {
  for (const page of PAGES) {
    const html = await readFile(join(SITE, page), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page} has an inline <script>`);
    assert.doesNotMatch(html, /<style[\s>]/, `${page} has a <style> block`);
    assert.doesNotMatch(html, /\son[a-z]+=/, `${page} has an inline event handler`);
  }
});

test('every page carries the CSP as the first tag after charset (Azure Storage sends no headers)', async () => {
  const csp = (await readFile(join(SITE, 'ui/csp.txt'), 'utf8')).trim();
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self';/);
  for (const page of PAGES) {
    const html = await readFile(join(SITE, page), 'utf8');
    const head = html.slice(html.indexOf('<head>') + 6).trim().split('\n');
    assert.equal(head[0], '<meta charset="utf-8">', page);
    assert.equal(head[1], `<meta http-equiv="Content-Security-Policy" content="${csp}">`, `${page}: CSP must come right after charset and match ui/csp.txt`);
  }
});

test('home page has the basics', async () => {
  const html = await readFile(join(SITE, 'index.html'), 'utf8');
  assert.match(html, /<title>Thunderhead<\/title>/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test('no credentials in the repository', async () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{20,}\b/, /\bxox[abp]-[A-Za-z0-9-]{10,}\b/, /AccountKey=[A-Za-z0-9+/=]{20,}/, /\bsig=[A-Za-z0-9%]{20,}/, /\bth(?:1|m|s|c|w|fp)_[A-Za-z0-9_-]{20,}/];
  for (const f of await files(REPO)) {
    if (f.endsWith('package-lock.json') || /\.(png|ico|woff2?)$/.test(f)) continue;
    const text = await readFile(f, 'utf8');
    for (const p of patterns) assert.ok(!p.test(text), `${relative(REPO, f)} matches ${p}`);
  }
});
