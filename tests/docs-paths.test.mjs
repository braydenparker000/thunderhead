// The documents say what is true (audit 2026-11-20): every repository path, `npm run` script and workflow file
// named in README.md, AGENTS.md, docs/engineering/TESTING.md and docs/process/STATUS.md exists. Allowed without a
// file (tests/fixtures/docs-paths-allow.json): what is made locally and git-ignored (`generated`), and what is
// genuinely planned (`planned`), which the line naming it must call planned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DOCS = ['README.md', 'AGENTS.md', 'docs/engineering/TESTING.md', 'docs/process/STATUS.md'];
const allow = JSON.parse(readFileSync(new URL('./fixtures/docs-paths-allow.json', import.meta.url), 'utf8'));
const TOP = /^(\.github|frontend|backend|shared|scripts|tests|mind|docs|engine)\//;

/** What a document names: [kind, name, line] for each repository path, `npm run` script and workflow file. */
export function named(doc, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      for (const tok of m[1].split(/\s+/)) {
        const p = tok.replace(/[),.;:]+$/, '').replace(/:\d+(-\d+)?$/, '');
        if (/[<>*{}$]/.test(p)) continue;
        if (TOP.test(p)) out.push(['path', p, i + 1]);
        else if (/^[\w.-]+\.ya?ml$/.test(p)) out.push(['workflow', p, i + 1]);
      }
    }
    for (const m of line.matchAll(/npm run ([\w:-]+)(?:\s+-w\s+([\w-]+))?/g)) out.push(['script', m[2] ? `${m[2]}:${m[1]}` : m[1], i + 1]);
    for (const m of line.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (!/^[a-z]+:/i.test(m[1])) out.push(['path', normalize(join(dirname(doc), m[1])).replace(/\\/g, '/'), i + 1]);
    }
  });
  return out;
}

const scripts = (dir) => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts ?? {};
function exists([kind, name]) {
  if (kind === 'workflow') return existsSync(join(ROOT, '.github/workflows', name)) || existsSync(join(ROOT, name));
  if (kind === 'script') {
    const [ws, s] = name.includes(':') && !(name in scripts('.')) && existsSync(join(ROOT, name.split(':')[0], 'package.json')) ? [name.split(':')[0], name.split(':').slice(1).join(':')] : ['.', name];
    return s in scripts(ws);
  }
  return existsSync(join(ROOT, name.replace(/\/$/, '')));
}

test('the extractor finds paths, scripts, workflows and links, and skips patterns', () => {
  const found = named('docs/x/A.md', 'Run `npm run test:mind` and `scripts/a.mjs:12`, see `ci.yml`, [B](../y/B.md#z), `tests/<page>.test.mjs`, `npm run dev -w backend`.');
  assert.deepEqual(found.map(([k, n]) => `${k} ${n}`), ['path scripts/a.mjs', 'workflow ci.yml', 'script test:mind', 'script backend:dev', 'path docs/y/B.md']);
});

test('every path, npm script and workflow the core documents name exists', () => {
  const missing = [];
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    const lines = text.split('\n');
    for (const item of named(doc, text)) {
      if (exists(item)) continue;
      const [kind, name, line] = item;
      if (kind === 'path' && allow.generated.includes(name)) continue;
      if (allow.planned.includes(name) && /\bplanned\b/i.test(lines[line - 1])) continue;
      missing.push(`${doc}:${line} ${kind} ${name}`);
    }
  }
  assert.deepEqual(missing, [], 'fix the document, or list a genuinely planned one (and say "planned" on its line)');
});

test('what is allowed as generated is git-ignored, so it is never committed', () => {
  for (const p of allow.generated) {
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT }), `${p} is git-ignored`);
  }
});
