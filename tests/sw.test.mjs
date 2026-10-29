// The service worker's release list, the safe-update rule, the icon sprite and the install
// manifest, without a browser (ARCHITECTURE.md §8, DESIGN-SYSTEM.md §13, TESTING.md §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES, PORTED, precached, swJs } from '../scripts/site-config.mjs';
import { buildSprite } from '../scripts/icons.mjs';
import { checkDue, safeToApply, CHECK_EVERY_MS } from '../frontend/th/update-rules.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(REPO, 'frontend');

test('precache.json leaves out vendor/, the route stubs, the ported folders and the worker scripts', () => {
  for (const p of ['index.html', 'signin/index.html', 'setup/setup.js', 'ui/icons.svg', 'config.js', 'manifest.webmanifest', '.well-known/change-password/index.html'])
    assert.ok(precached(p), p);
  for (const p of ['vendor/x-1/x.js', 'music/index.html', 'astra/sw.js', 'assets/config.js', 'sw.js', 'sw-kill.js', 'precache.json', 'ui/csp.txt', ...APP_ROUTES.map((r) => `${r}/index.html`)])
    assert.ok(!precached(p), p);
});

test('sw.js and site-config.mjs name the same ported folders', () => {
  const sw = readFileSync(join(SITE, 'sw.js'), 'utf8');
  const list = JSON.parse(/const PORTED = (\[[^\]]*\]);/.exec(sw)[1].replaceAll("'", '"'));
  assert.deepEqual(list, PORTED.map((p) => `/${p}/`));
  // every shell route the worker answers with the shell is a stubbed route (or home)
  const shell = JSON.parse(/const SHELL = (\[[^\]]*\]);/.exec(sw)[1].replaceAll("'", '"'));
  for (const r of shell) if (r !== '/') assert.ok(APP_ROUTES.includes(r.slice(1, -1)) && !PORTED.includes(r.slice(1, -1)), r);
});

test('stage writes the build into sw.js and a precache list whose sizes match the staged files', () => {
  assert.throws(() => swJs('nothing here', 3));
  assert.match(swJs('const BUILD = 0;\nx', 412), /^const BUILD = 412;$/m);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  execFileSync(process.execPath, ['scripts/stage.mjs', sha], { cwd: REPO, env: { ...process.env, WORKER_URL: 'https://thunderhead-api.example.workers.dev' }, stdio: 'pipe' });
  const out = join(REPO, '.deploy/site');
  const { build, files } = JSON.parse(readFileSync(join(out, 'precache.json'), 'utf8'));
  assert.ok(build > 0);
  assert.match(readFileSync(join(out, 'sw.js'), 'utf8'), new RegExp(`^const BUILD = ${build};$`, 'm'));
  assert.match(readFileSync(join(out, 'config.js'), 'utf8'), new RegExp(`"build":${build}`));
  assert.ok(files.length > 20);
  for (const { path, size } of files) {
    assert.ok(precached(path), path);
    assert.equal(statSync(join(out, path)).size, size, path);
  }
  for (const page of ['index.html', 'signin/index.html', 'setup/index.html', 'recover/index.html', '404.html'])
    assert.ok(files.some((f) => f.path === page), page);
});

test('an update applies only when nothing plays, nothing is typed and nothing is open', () => {
  const calm = { visible: true, playing: false, typing: false, overlay: false };
  assert.equal(safeToApply(calm), true);
  for (const key of ['playing', 'typing', 'overlay']) assert.equal(safeToApply({ ...calm, [key]: true }), false, key);
  assert.equal(safeToApply({ ...calm, visible: false }), false);
  assert.equal(checkDue(0, CHECK_EVERY_MS - 1), false);
  assert.equal(checkDue(0, CHECK_EVERY_MS), true);
});

test('the kill switch clears th-* caches and unregisters (OPERATIONS.md §3.3)', () => {
  const kill = readFileSync(join(SITE, 'sw-kill.js'), 'utf8');
  assert.match(kill, /startsWith\('th-'\)/);
  assert.match(kill, /registration\.unregister\(\)/);
});

test('ui/icons.svg is built from ui/icons.txt, within budget, and the shell draws no inline paths', () => {
  const sprite = readFileSync(join(SITE, 'ui/icons.svg'), 'utf8');
  assert.equal(sprite, buildSprite(), 'ui/icons.svg is stale: run node scripts/icons.mjs');
  assert.ok(Buffer.byteLength(sprite) <= 30_000, `sprite is ${Buffer.byteLength(sprite)} bytes`);
  for (const f of ['index.html', 'apps/home/home.js'])
    assert.doesNotMatch(readFileSync(join(SITE, f), 'utf8'), /<path\b/, `${f} still draws an inline icon`);
  for (const [, name] of readFileSync(join(SITE, 'index.html'), 'utf8').matchAll(/icons\.svg#([a-z-]+)/g))
    assert.match(sprite, new RegExp(`<symbol id="${name}"`), name);
});

test('the install manifest has scope /, and every icon it names exists', () => {
  const m = JSON.parse(readFileSync(join(SITE, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.scope, '/');
  assert.equal(m.start_url, '/');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(SITE, i.src)), i.src);
  for (const page of ['index.html', 'signin/index.html', 'setup/index.html', 'recover/index.html'])
    assert.match(readFileSync(join(SITE, page), 'utf8'), /<link rel="manifest" href="\/manifest.webmanifest">/, page);
});
