#!/usr/bin/env node
// Which checks a branch needs, from the paths it changes (docs/engineering/TESTING.md §2, "Scopes"; audit 2026-11-21:
// a change to a doc ran every suite). Test's `scope` job (.github/workflows/ci.yml) runs it and passes its verdict to
// checks.yml. It prints `all`, or a word and then the test files to run:
//   lab …      a lab or Astra change, as scripts/lab-scope.mjs decides it
//   docs …     only docs/** and the root *.md files: the tests that read the docs, no browser, no Worker
//   backend …  only backend/** and shared/** (docs may go with them): the Worker's job, the contract check and the
//              tests that read the Worker or the contract, no browser
//   mind …     only mind/** (docs may go with it): the mind's tests and the tests that read mind/, no browser, no Worker
// A changed file that a check the scope skips reads (a browser test or a fixture it loads naming it, a shared file a browser
// test imports, a doc or mind file the Worker's tests read when the Worker's job is skipped), any other path, a
// deleted or renamed file, or any doubt is `all`. Only `all` gives Test's job `record` the name `Scope: full`, the
// one Deploy accepts in place of its own checks (scripts/tree-tested.mjs).
// Usage: node scripts/test-scope.mjs <base>   (e.g. origin/main; compared from the merge base)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { labVerdict } from './lab-scope.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Each narrowed scope's paths. A root `*.md` is a doc; `mind/**` keeps its own Markdown (its prompt and skills). */
export const GROUPS = /** @type {Record<string, (p: string) => boolean>} */ ({
  docs: (p) => /^docs\/./.test(p) || /^[^/]+\.md$/.test(p),
  backend: (p) => /^(backend|shared)\/./.test(p),
  mind: (p) => /^mind\/./.test(p),
});
/** Always run for its scope: the docs' own check, the contract's. */
export const ALWAYS = /** @type {Record<string, string[]>} */ ({
  docs: ['tests/docs-paths.test.mjs'],
  backend: ['tests/contract-gen.test.mjs', 'tests/contract.test.mjs'],
  mind: [],
});
/** What in a test's source says it reads a scope's files. */
const READS = /** @type {Record<string, RegExp>} */ ({ docs: /\bdocs\/|\b(AGENTS|README|CLAUDE)\.md\b/, backend: /\b(backend|shared)\//, mind: /\bmind\// });

const isTest = (/** @type {string} */ f) => /^(tests|mind\/tests)\/[^/]+\.test\.mjs$/.test(f);
/** A test that opens a browser (by name, or by importing Playwright, as tests/lightcraft-lab.test.mjs does). */
export const browser = (/** @type {string} */ f, /** @type {string} */ text = '') => /-browser\.test\.mjs$/.test(f) || /from ['"]playwright['"]/.test(text);

/** The repository paths a source names, as globs (`mind/evals/injection/*.json`) or folders (`shared/contract/`). A bare
 * top folder (`mind/` in prose) names no file a check could read. */
const mentions = (/** @type {string} */ text) => [...text.matchAll(/\b(?:backend|shared|mind|docs)\/[\w.*/-]*/g)].map((m) => m[0].replace(/\.+$/, '')).filter((m) => /\/[^/]/.test(m));
/** Whether a source names a root Markdown file (`'README.md'`, not `engine/x/README.md`). @param {string} text @param {string} p */
const namesRoot = (text, p) => new RegExp(`(?<![\\w/.-])${p.replace(/\./g, '\\.')}`).test(text);
/** The fixtures the browser tests load, and what those load in turn (by file name). @param {string[]} tests @param {Record<string, string>} sources */
function fixturesOf(tests, sources) {
  const all = Object.keys(sources).filter((f) => f.startsWith('tests/fixtures/')), seen = new Set(), todo = [...tests];
  while (todo.length) {
    const text = sources[/** @type {string} */ (todo.pop())];
    for (const f of all) if (!seen.has(f) && text.includes(f.slice(f.lastIndexOf('/') + 1))) { seen.add(f); todo.push(f); }
  }
  return [...seen];
}
/** Whether a named path or glob covers `p`. @param {string} named @param {string} p */
export function covers(named, p) {
  if (named.endsWith('/')) return p.startsWith(named);
  const re = new RegExp(`^${named.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}(/.*)?$`);
  return re.test(p);
}

/** The shared files reachable from what `text` names: each named shared file and what it imports, file by file.
 * @param {string} text @param {Record<string, string>} sources */
function sharedReached(text, sources) {
  const seen = new Set(), todo = mentions(text).filter((m) => m.startsWith('shared/') && m in sources);
  while (todo.length) {
    const f = /** @type {string} */ (todo.pop());
    if (seen.has(f) || !(f in sources)) continue;
    seen.add(f);
    const dir = f.slice(0, f.lastIndexOf('/') + 1);
    for (const [, rel] of sources[f].matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) todo.push(dir + rel.slice(2));
  }
  return seen;
}

/** The narrowed scope for a list of changed (added or edited) paths, or null: run everything.
 * @param {string[]} paths @param {Record<string, string>} sources repository file → text: the test files, tests/fixtures/,
 * backend/ and shared/ @returns {{ word: string, tests: string[] } | null} */
export function testScope(paths, sources) {
  if (!paths.length) return null;
  const groups = new Set();
  for (const p of paths) {
    const g = Object.keys(GROUPS).find((k) => GROUPS[k](p));
    if (!g) return null;
    groups.add(g);
  }
  if (groups.has('backend') && groups.has('mind')) return null;
  const word = groups.has('backend') ? 'backend' : groups.has('mind') ? 'mind' : 'docs';
  // what reads a changed file without being run by this scope: with it, every suite runs
  const browsers = Object.keys(sources).filter((f) => isTest(f) && browser(f, sources[f]));
  const skipped = [...browsers, ...fixturesOf(browsers, sources), ...Object.keys(sources).filter((f) => word !== 'backend' && /^(backend|shared)\//.test(f))];
  for (const f of skipped) {
    const named = mentions(sources[f]), reached = sharedReached(sources[f], sources);
    if (paths.some((p) => reached.has(p) || named.some((n) => covers(n, p)) || (/^[^/]+\.md$/.test(p) && namesRoot(sources[f], p)))) return null;
  }
  const quick = Object.keys(sources).filter((f) => isTest(f) && !browser(f, sources[f]));
  const tests = new Set([...ALWAYS.docs.filter(() => groups.has('docs')), ...ALWAYS[word]]);
  for (const g of groups) for (const f of quick) if (READS[g].test(sources[f]) || (g === 'mind' && f.startsWith('mind/tests/'))) tests.add(f);
  return { word, tests: [...tests].sort() };
}

/** Every text file under `dir`, relative to the repository root. @param {string} dir */
const textFiles = (dir) => readdirSync(`${ROOT}${dir}`, { recursive: true, encoding: 'utf8' })
  .map((f) => `${dir}/${f}`).filter((f) => !f.includes('node_modules/') && /\.(m?js|ts|json|jsonl|sql)$/.test(f) && statSync(`${ROOT}${f}`).isFile());

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let out = 'all';
  try {
    const base = process.argv[2] || 'origin/main';
    const git = (/** @type {string[]} */ ...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
    const lines = git('diff', '--name-status', `${git('merge-base', base, 'HEAD')}..HEAD`).split('\n').filter(Boolean);
    const lab = labVerdict(lines);
    if (lab !== 'all') out = lab;
    // a deleted or renamed file could be one another file loads: run everything
    else if (lines.every((l) => /^[AM]\t/.test(l))) {
      const files = ['tests', 'mind/tests', 'tests/fixtures', 'backend', 'shared'].flatMap((d) => (d.endsWith('tests') ? readdirSync(`${ROOT}${d}`).filter((f) => f.endsWith('.test.mjs')).map((f) => `${d}/${f}`) : textFiles(d)));
      const sources = Object.fromEntries([...new Set(files)].map((f) => [f, readFileSync(`${ROOT}${f}`, 'utf8')]));
      const scope = testScope(lines.map((l) => l.slice(2)), sources);
      if (scope) out = `${scope.word} ${scope.tests.join(' ')}`;
    }
  } catch (err) { console.error(`test-scope: ${err}`); }
  console.log(out);
}
