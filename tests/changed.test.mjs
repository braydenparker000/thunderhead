// scripts/changed.mjs: only files that differ from the live copy are picked for upload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles } from '../scripts/changed.mjs';

const md5 = (s) => createHash('md5').update(s).digest('base64');
const script = fileURLToPath(new URL('../scripts/changed.mjs', import.meta.url));

test('same bytes and type are skipped; new, changed, retyped and MD5-less files are picked', () => {
  const html = 'text/html; charset=utf-8';
  const live = [
    { name: 'same.html', md5: md5('a'), type: html },
    { name: 'edited.html', md5: md5('old'), type: html },
    { name: 'retyped.json', md5: md5('{}'), type: 'application/octet-stream' },
    { name: 'big.wasm', md5: null, type: 'application/wasm' },
  ];
  const staged = [
    { path: 'same.html', md5: md5('a'), type: html },
    { path: 'edited.html', md5: md5('new'), type: html },
    { path: 'retyped.json', md5: md5('{}'), type: 'application/json' },
    { path: 'big.wasm', md5: md5('w'), type: 'application/wasm' },
    { path: 'new/page.html', md5: md5('n'), type: html },
  ];
  assert.deepEqual(changedFiles(live, staged).map((f) => f.path), ['edited.html', 'retyped.json', 'big.wasm', 'new/page.html']);
});

test('the script links the changed files into the changed folder with their paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changed-'));
  const site = join(dir, 'site');
  mkdirSync(join(site, 'apps'), { recursive: true });
  writeFileSync(join(site, 'index.html'), 'home');
  writeFileSync(join(site, 'apps', 'a.js'), 'js v2');
  writeFileSync(join(dir, 'live.json'), JSON.stringify([
    { n: 'index.html', m: md5('home'), t: 'text/html; charset=utf-8' },
    { n: 'apps/a.js', m: md5('js v1'), t: 'text/javascript; charset=utf-8' },
  ]));
  const out = execFileSync('node', [script, join(dir, 'live.json'), site, join(dir, 'changed')], { encoding: 'utf8' });
  assert.match(out, /changed: 1 of 2 files/);
  assert.equal(readFileSync(join(dir, 'changed', 'apps', 'a.js'), 'utf8'), 'js v2');
  assert.equal(existsSync(join(dir, 'changed', 'index.html')), false);
  assert.equal(readFileSync(join(dir, 'changed.txt'), 'utf8'), 'apps/a.js\n');
});
