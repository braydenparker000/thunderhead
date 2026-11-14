#!/usr/bin/env node
// Whether a branch changes only test pages (frontend/lab/<page>/, the engine builds they load, engine/, and
// those pages' own tests), so Test can run the lab checks instead of every suite (docs/engineering/TESTING.md §1, "Lab
// changes"; owner, 2026-11-09). Prints `all`, or `lab` and then the test files to run: the static
// site checks (which read every page, labs included) and each changed page's own tests
// (tests/<page>-lab*.test.mjs, a test naming /lab/<page>/). Any other path, a deleted file, or any
// doubt is `all`.
// Usage: node scripts/lab-scope.mjs <base>   (e.g. origin/main; compared from the merge base)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Always run for a lab change: the static checks every page must pass (outside hosts, CSP, imports, credentials). */
export const ALWAYS = ['tests/site.test.mjs'];
/** engine/<folder> builds a lab page's files. */
const ENGINE_PAGE = /** @type {Record<string, string>} */ ({ 'lightcraft-web': 'lightcraft', raw: 'engine' });

/** Files that go with a lab change without being a page's own, and the tests that read them: the table CI deals
 * its parts by, and the page budgets (the lab checks stage the site themselves, and tests/site.test.mjs is always run). */
export const WITH = /** @type {Record<string, string[]>} */ ({ 'scripts/test-durations.json': ['tests/test-part.test.mjs'], 'scripts/stage.mjs': [] });
/** Lab pages that load another's files. */
const USED_BY = /** @type {Record<string, string[]>} */ ({ engine: ['editor'] });
const named = (/** @type {string} */ text) => [...text.matchAll(/\/lab\/([a-z0-9-]+)\//g)].map((m) => m[1]);

/** The lab pages a list of changed paths touches, or null when any path is outside the labs. A test file that names
 * a lab page is that page's own (a change to the editor comes with its tests: without this, almost none counted as a
 * lab change, and every suite ran for it; owner, 2026-11-14), as are the files in `WITH`.
 * @param {string[]} paths @param {Record<string, string>} [sources] test file → text @returns {Set<string> | null} */
export function labPages(paths, sources = {}) {
  const pages = new Set();
  for (const p of paths) {
    const lab = /^frontend\/lab\/([^/]+)\/./.exec(p)?.[1], engine = /^engine\/([^/]+)\//.exec(p)?.[1];
    if (lab) pages.add(lab);
    else if (engine && ENGINE_PAGE[engine]) pages.add(ENGINE_PAGE[engine]);
    else if (p in WITH) continue;
    else if (/^tests\/[^/]+\.test\.mjs$/.test(p) && named(sources[p] || '').length) for (const page of named(sources[p])) pages.add(page);
    else return null;
  }
  // the editor is made of the engine: what changes the engine is checked by the editor's tests too
  for (const [page, users] of Object.entries(USED_BY)) if (pages.has(page)) for (const u of users) pages.add(u);
  return pages.size ? pages : null;
}

/** The tests for those pages: ALWAYS, every test file that names /lab/<page>/ in its source, and the tests that read
 * a changed file of `WITH`. @param {Set<string>} pages @param {Record<string, string>} sources file → text @param {string[]} [paths] what changed */
export function labTests(pages, sources, paths = []) {
  const own = Object.entries(sources).filter(([, text]) => [...pages].some((p) => text.includes(`/lab/${p}/`))).map(([f]) => f);
  return [...new Set([...ALWAYS, ...own, ...paths.flatMap((p) => WITH[p] || [])])].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let out = 'all';
  try {
    const base = process.argv[2] || 'origin/main';
    const git = (/** @type {string[]} */ ...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
    const lines = git('diff', '--name-status', `${git('merge-base', base, 'HEAD')}..HEAD`).split('\n').filter(Boolean);
    // a deleted or renamed file could be one another page loads: run everything
    const files = readdirSync(`${ROOT}tests`).filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/${f}`);
    const sources = Object.fromEntries(files.filter((f) => !ALWAYS.includes(f)).map((f) => [f, readFileSync(`${ROOT}${f}`, 'utf8')]));
    const paths = lines.map((l) => l.slice(2)), pages = lines.every((l) => /^[AM]\t/.test(l)) ? labPages(paths, sources) : null;
    if (pages) out = `lab ${labTests(pages, sources, paths).join(' ')}`;
  } catch (err) { console.error(`lab-scope: ${err}`); }
  console.log(out);
}
