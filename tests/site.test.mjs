// Static checks that run without a browser: links resolve, no outside hosts, the page fits
// the strict Content-Security-Policy, and nothing secret is committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES } from '../scripts/site-config.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(REPO, 'frontend');
const SIGNIN_PAGES = ['signin/index.html', 'setup/index.html', 'recover/index.html', 'import/index.html'];
const PAGES = ['index.html', '404.html', '.well-known/change-password/index.html', ...SIGNIN_PAGES];

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
    for (let [, ref] of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
      ref = ref.split('?')[0];
      if (ref === '/' || ref.startsWith('http://www.w3.org/')) continue;
      if (APP_ROUTES.some(r => ref === `/${r}/`)) continue; // stage.mjs gives each app route its copy of the shell
      assert.ok(ref.startsWith('/'), `${page}: "${ref}" must start with / so app routes like /music/ still find it`);
      assert.ok(existsSync(join(SITE, ref)), `${page} loads missing ${ref}`);
    }
  }
});

// The as-is ported apps (and the old files they load) have their own host allowlist, checked in
// tests/ported.test.mjs (SECURITY.md §4.4); everything else may reach no outside host at all.
const PORTED = JSON.parse(await readFile(join(SITE, 'ported.json'), 'utf8'));
const portedFile = rel => Object.values(PORTED.folders).some(f => rel in f.files) || rel in PORTED.shared;

test('no outside hosts anywhere in the site', async () => {
  for (const f of (await files(SITE)).filter(f => /\.(html|css|js|json)$/.test(f) && !portedFile(relative(SITE, f)) && !f.endsWith('ported.json'))) {
    const text = await readFile(f, 'utf8');
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'()<>]+/g)) {
      if (url.startsWith('http://www.w3.org/')) continue;
      // Study's reader reads the private bucket through signed links (STUDY.md §2.2): its own page's
      // CSP names the R2 host, and nothing else does.
      if (relative(SITE, f) === 'study/index.html' && url === 'https://*.r2.cloudflarestorage.com;') continue;
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
  const shell = (await readFile(join(SITE, 'ui/csp.txt'), 'utf8')).trim();
  const signin = (await readFile(join(SITE, 'ui/csp-signin.txt'), 'utf8')).trim();
  for (const csp of [shell, signin]) {
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self';/);
  }
  // SECURITY.md §4.1: the sign-in pages talk only to the API (filled in at stage time) and allow no inline styles.
  assert.match(signin, /connect-src 'none';/);
  assert.doesNotMatch(signin, /unsafe-inline/);
  for (const page of PAGES) {
    const csp = SIGNIN_PAGES.includes(page) ? signin : shell;
    const html = await readFile(join(SITE, page), 'utf8');
    const head = html.slice(html.indexOf('<head>') + 6).trim().split('\n');
    assert.equal(head[0], '<meta charset="utf-8">', page);
    assert.equal(head[1], `<meta http-equiv="Content-Security-Policy" content="${csp}">`, `${page}: CSP must come right after charset and match ui/${SIGNIN_PAGES.includes(page) ? 'csp-signin' : 'csp'}.txt`);
  }
});

test('sign-in pages have no style attributes (their CSP allows none) and every module import resolves', async () => {
  for (const page of SIGNIN_PAGES) assert.doesNotMatch(await readFile(join(SITE, page), 'utf8'), /\sstyle=/, page);
  for (const f of (await files(SITE)).filter(f => f.endsWith('.js'))) {
    const text = await readFile(f, 'utf8');
    for (const [, spec] of text.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\('([^']+)'\)/gm)) {
      if (!spec) continue;
      const path = spec.split('?')[0];
      const target = path.startsWith('/') ? join(SITE, path) : join(f, '..', path);
      assert.ok(existsSync(target), `${relative(REPO, f)} imports missing ${spec}`);
    }
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
